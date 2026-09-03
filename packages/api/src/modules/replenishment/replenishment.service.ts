import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import * as engine from "@/modules/inventory/inventory.engine";
import * as taskService from "@/modules/tasks/task.service";

/**
 * Section 19 — scans every picking location with a configured min/max
 * against its current available balance; where it has fallen at/below the
 * minimum, recommends pulling the shortfall from the best reserve location
 * of the same product and opens a ReplenishmentTask (+ orchestration Task).
 */
export async function scanReplenishmentNeeds(actor: AuthUser) {
  const pickingLocations = await prisma.location.findMany({
    where: { type: "PICKING", status: "ACTIVE", pickingMin: { not: null } },
    include: { balances: { where: { qtyAvailable: { gt: -1 } } } },
  });

  const created = [];
  for (const location of pickingLocations) {
    const byProduct = new Map<string, number>();
    for (const balance of location.balances) {
      byProduct.set(balance.productId, (byProduct.get(balance.productId) ?? 0) + balance.qtyAvailable);
    }
    for (const [productId, currentQty] of byProduct) {
      if (currentQty > (location.pickingMin ?? 0)) continue;

      const alreadyPending = await prisma.replenishmentTask.findFirst({
        where: { productId, toLocationId: location.id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } },
      });
      if (alreadyPending) continue;

      const reserveBalance = await prisma.inventoryBalance.findFirst({
        where: { productId, qtyAvailable: { gt: 0 }, location: { type: "RESERVE", status: "ACTIVE" } },
        include: { lot: true },
        orderBy: { createdAt: "asc" },
      });
      if (!reserveBalance) continue;

      const target = location.pickingMax ?? location.pickingMin ?? currentQty;
      const desiredQty = Math.max(target - currentQty, 0);
      const qty = Math.min(desiredQty, reserveBalance.qtyAvailable);
      if (qty <= 0) continue;

      const task = await prisma.$transaction(async (tx) => {
        const replenishment = await tx.replenishmentTask.create({
          data: { productId, fromLocationId: reserveBalance.locationId, toLocationId: location.id, qty, status: "PENDING" },
        });
        await taskService.createTask(tx, {
          type: "REPLENISHMENT",
          priority: "NORMAL",
          refType: "ReplenishmentTask",
          refId: replenishment.id,
          originLocationId: reserveBalance.locationId,
          destLocationId: location.id,
          productId,
          qty,
        });
        await writeAudit(tx, actor, { action: "SCAN_CREATE", entityType: "ReplenishmentTask", entityId: replenishment.id, newValue: { productId, qty, toLocation: location.fullCode } });
        return replenishment;
      });
      created.push(task);
    }
  }
  return { created: created.length, tasks: created };
}

export async function list(query: PaginationQuery & { status?: string }) {
  const where = query.status ? { status: query.status as never } : {};
  const [items, total] = await Promise.all([
    prisma.replenishmentTask.findMany({
      where,
      include: { product: { select: { sku: true, description: true } }, fromLocation: { select: { fullCode: true } }, toLocation: { select: { fullCode: true } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(query),
    }),
    prisma.replenishmentTask.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function execute(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.replenishmentTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundError("Tarefa de reabastecimento", id);
    if (task.status === "COMPLETED") throw new ConflictError("Tarefa já concluída.");
    if (task.status === "CANCELLED") throw new ConflictError("Tarefa cancelada.");
    if (task.operatorId && task.operatorId !== actor.id) throw new ConflictError("Tarefa atribuída a outro operador.");

    await engine.transferStock(tx, {
      type: "REPLENISH",
      productId: task.productId,
      qty: task.qty,
      fromLocationId: task.fromLocationId,
      toLocationId: task.toLocationId,
      userId: actor.id,
      refType: "ReplenishmentTask",
      refId: id,
    });

    const updated = await tx.replenishmentTask.update({ where: { id }, data: { status: "COMPLETED", operatorId: actor.id, completedAt: new Date() } });

    const genericTask = await tx.task.findFirst({ where: { refType: "ReplenishmentTask", refId: id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } } });
    if (genericTask) {
      if (genericTask.status === "PENDING") {
        await tx.task.update({ where: { id: genericTask.id }, data: { status: "IN_PROGRESS", assignedToId: actor.id, startedAt: new Date() } });
      }
      await taskService.completeTaskTx(tx, genericTask.id);
    }

    await writeAudit(tx, actor, { action: "EXECUTE", entityType: "ReplenishmentTask", entityId: id, newValue: { status: "COMPLETED" } });
    return updated;
  });
}

export async function cancel(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.replenishmentTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundError("Tarefa de reabastecimento", id);
    if (["COMPLETED", "CANCELLED"].includes(task.status)) throw new ValidationError("Tarefa já finalizada.");
    const updated = await tx.replenishmentTask.update({ where: { id }, data: { status: "CANCELLED" } });
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "ReplenishmentTask", entityId: id, newValue: { status: "CANCELLED" } });
    return updated;
  });
}
