import { CountStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { NotFoundError, ValidationError } from "@/common/errors";
import { StateMachine } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { createCountSchema } from "@/modules/counts/count.schema";
import * as engine from "@/modules/inventory/inventory.engine";
import * as taskService from "@/modules/tasks/task.service";
import { raiseDiscrepancy } from "@/modules/discrepancy/discrepancy.service";

// Section 23: ABERTO -> CONTAGEM -> CONFERÊNCIA -> DIVERGÊNCIA -> SEGUNDA
// CONTAGEM -> APROVAÇÃO -> AJUSTE -> FINALIZADO (skipping DISCREPANCY/RECOUNT
// when the first count already matches system quantities).
export const countStateMachine = new StateMachine<CountStatus>("Inventário", {
  OPEN: ["COUNTING", "CANCELLED"],
  COUNTING: ["REVIEW", "CANCELLED"],
  REVIEW: ["DISCREPANCY", "APPROVAL", "CANCELLED"],
  DISCREPANCY: ["RECOUNT", "CANCELLED"],
  RECOUNT: ["APPROVAL", "CANCELLED"],
  APPROVAL: ["ADJUSTMENT", "CANCELLED"],
  ADJUSTMENT: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
});

const countInclude = {
  items: { include: { product: { select: { sku: true, description: true } }, location: { select: { fullCode: true } }, lot: { select: { code: true } } } },
} as const;

export async function list(query: PaginationQuery & { status?: CountStatus }) {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.q ? { code: { contains: query.q, mode: "insensitive" as const } } : {}) };
  const [items, total] = await Promise.all([
    prisma.inventoryCount.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake(query) }),
    prisma.inventoryCount.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function get(id: string) {
  const count = await prisma.inventoryCount.findUnique({ where: { id }, include: countInclude });
  if (!count) throw new NotFoundError("Inventário", id);
  return count;
}

export async function create(actor: AuthUser, data: z.infer<typeof createCountSchema>) {
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      ...(data.locationIds?.length ? { locationId: { in: data.locationIds } } : {}),
      ...(data.productIds?.length ? { productId: { in: data.productIds } } : {}),
    },
  });
  if (balances.length === 0) throw new ValidationError("Nenhum saldo de estoque encontrado para o escopo informado.");

  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.create({
      data: {
        code: data.code,
        type: data.type,
        scope: { locationIds: data.locationIds ?? [], productIds: data.productIds ?? [] },
        items: {
          create: balances.map((b) => ({
            locationId: b.locationId,
            productId: b.productId,
            lotId: b.lotId,
            systemQty: b.qtyPhysical,
          })),
        },
      },
      include: countInclude,
    });

    const locationIds = [...new Set(balances.map((b) => b.locationId))];
    for (const locationId of locationIds) {
      await taskService.createTask(tx, { type: "COUNT", priority: "NORMAL", refType: "InventoryCount", refId: count.id, destLocationId: locationId });
    }

    await writeAudit(tx, actor, { action: "CREATE", entityType: "InventoryCount", entityId: count.id, newValue: { code: count.code, items: balances.length } });
    return count;
  });
}

async function transition(actor: AuthUser, id: string, to: CountStatus) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({ where: { id } });
    if (!count) throw new NotFoundError("Inventário", id);
    countStateMachine.assertCanTransition(count.status, to);
    const updated = await tx.inventoryCount.update({ where: { id }, data: { status: to, closedAt: to === "COMPLETED" || to === "CANCELLED" ? new Date() : undefined } });
    await writeAudit(tx, actor, { action: `TRANSITION_${to}`, entityType: "InventoryCount", entityId: id, previousValue: { status: count.status }, newValue: { status: to } });
    return updated;
  });
}

export const startCounting = (actor: AuthUser, id: string) => transition(actor, id, "COUNTING");

export async function recordCount(actor: AuthUser, countId: string, itemId: string, countedQty: number, isRecount: boolean) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({ where: { id: countId } });
    if (!count) throw new NotFoundError("Inventário", countId);
    if (isRecount && count.status !== "RECOUNT") throw new ValidationError("Inventário não está em segunda contagem.");
    if (!isRecount && count.status !== "COUNTING") throw new ValidationError("Inventário não está em contagem.");

    const item = await tx.inventoryCountItem.findUnique({ where: { id: itemId } });
    if (!item || item.countId !== countId) throw new NotFoundError("Item de contagem", itemId);

    const updated = await tx.inventoryCountItem.update({
      where: { id: itemId },
      data: isRecount
        ? { countedQty2: countedQty, status: countedQty === item.systemQty ? "RECOUNTED" : "DIVERGENT" }
        : { countedQty1: countedQty, status: countedQty === item.systemQty ? "COUNTED" : "DIVERGENT" },
    });
    await writeAudit(tx, actor, { action: isRecount ? "RECOUNT_ITEM" : "COUNT_ITEM", entityType: "InventoryCountItem", entityId: itemId, newValue: { countedQty } });
    return updated;
  });
}

/** Section 23: closes counting; if any item diverges from the system quantity, opens discrepancies and requires a recount, otherwise goes straight to approval. */
export async function completeCounting(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({ where: { id }, include: { items: true } });
    if (!count) throw new NotFoundError("Inventário", id);
    countStateMachine.assertCanTransition(count.status, "REVIEW");
    const uncounted = count.items.filter((i) => i.countedQty1 === null);
    if (uncounted.length > 0) throw new ValidationError(`Existem ${uncounted.length} item(ns) ainda não contado(s).`);

    await tx.inventoryCount.update({ where: { id }, data: { status: "REVIEW" } });

    const divergent = count.items.filter((i) => i.countedQty1 !== i.systemQty);
    if (divergent.length === 0) {
      const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "APPROVAL" } });
      await writeAudit(tx, actor, { action: "REVIEW_NO_DIVERGENCE", entityType: "InventoryCount", entityId: id, newValue: { status: "APPROVAL" } });
      return updated;
    }

    for (const item of divergent) {
      await raiseDiscrepancy(tx, {
        type: (item.countedQty1 ?? 0) < item.systemQty ? "SHORTAGE" : "OVERAGE",
        refType: "InventoryCountItem",
        refId: item.id,
        productId: item.productId,
        expectedQty: item.systemQty,
        actualQty: item.countedQty1 ?? 0,
        description: `Divergência na contagem ${count.code}: sistema ${item.systemQty}, contado ${item.countedQty1}.`,
        createdById: actor.id,
      });
    }
    const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "DISCREPANCY" } });
    await writeAudit(tx, actor, { action: "REVIEW_DIVERGENCE", entityType: "InventoryCount", entityId: id, newValue: { divergentItems: divergent.length } });
    return updated;
  });
}

export const startRecount = (actor: AuthUser, id: string) => transition(actor, id, "RECOUNT");

export async function completeRecount(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({ where: { id }, include: { items: true } });
    if (!count) throw new NotFoundError("Inventário", id);
    countStateMachine.assertCanTransition(count.status, "APPROVAL");
    const missing = count.items.filter((i) => i.status === "DIVERGENT" && i.countedQty2 === null);
    if (missing.length > 0) throw new ValidationError(`Existem ${missing.length} item(ns) divergente(s) sem segunda contagem.`);
    const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "APPROVAL" } });
    await writeAudit(tx, actor, { action: "COMPLETE_RECOUNT", entityType: "InventoryCount", entityId: id, newValue: { status: "APPROVAL" } });
    return updated;
  });
}

/** Requires COUNT_APPROVE — sets each item's final quantity (second count wins over first) and moves to ADJUSTMENT. */
export async function approve(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({ where: { id }, include: { items: true } });
    if (!count) throw new NotFoundError("Inventário", id);
    countStateMachine.assertCanTransition(count.status, "ADJUSTMENT");
    for (const item of count.items) {
      const finalQty = item.countedQty2 ?? item.countedQty1 ?? item.systemQty;
      await tx.inventoryCountItem.update({ where: { id: item.id }, data: { finalQty, status: "APPROVED" } });
    }
    const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "ADJUSTMENT" } });
    await writeAudit(tx, actor, { action: "APPROVE", entityType: "InventoryCount", entityId: id, newValue: { status: "ADJUSTMENT" } });
    return updated;
  });
}

/** Requires COUNT_APPROVE — posts InventoryBalance adjustments for every item whose final qty differs from system qty. */
export async function applyAdjustments(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.inventoryCount.findUnique({ where: { id }, include: { items: true } });
    if (!count) throw new NotFoundError("Inventário", id);
    countStateMachine.assertCanTransition(count.status, "COMPLETED");

    let adjustedCount = 0;
    for (const item of count.items) {
      if (item.finalQty === null || item.finalQty === item.systemQty) {
        await tx.inventoryCountItem.update({ where: { id: item.id }, data: { status: "ADJUSTED" } });
        continue;
      }
      await engine.applyCountAdjustment(tx, {
        productId: item.productId,
        locationId: item.locationId,
        lotId: item.lotId,
        finalQty: item.finalQty,
        userId: actor.id,
        refType: "InventoryCount",
        refId: count.id,
        reason: `Ajuste de inventário ${count.code}`,
      });
      await tx.inventoryCountItem.update({ where: { id: item.id }, data: { status: "ADJUSTED" } });
      adjustedCount += 1;
    }

    const tasks = await tx.task.findMany({ where: { refType: "InventoryCount", refId: id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } } });
    for (const t of tasks) {
      if (t.status === "PENDING") await tx.task.update({ where: { id: t.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
      await taskService.completeTaskTx(tx, t.id);
    }

    const updated = await tx.inventoryCount.update({ where: { id }, data: { status: "COMPLETED", closedAt: new Date() } });
    await writeAudit(tx, actor, { action: "APPLY_ADJUSTMENTS", entityType: "InventoryCount", entityId: id, newValue: { adjustedCount } });
    return updated;
  });
}

export async function cancel(actor: AuthUser, id: string) {
  return transition(actor, id, "CANCELLED");
}
