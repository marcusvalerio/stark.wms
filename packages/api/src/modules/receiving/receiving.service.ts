import { ReceiptStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/common/errors";
import { StateMachine, guardedTransition } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { checkItemSchema, createReceiptSchema } from "@/modules/receiving/receiving.schema";
import * as taskService from "@/modules/tasks/task.service";
import * as engine from "@/modules/inventory/inventory.engine";
import { raiseDiscrepancy } from "@/modules/discrepancy/discrepancy.service";

// Section 8: AGENDADO -> CHEGADA -> NA DOCA -> CONFERÊNCIA -> CONFERIDO -> PUT-AWAY -> FINALIZADO
export const receiptStateMachine = new StateMachine<ReceiptStatus>("Recebimento", {
  SCHEDULED: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["AT_DOCK", "CANCELLED"],
  AT_DOCK: ["IN_CONFERENCE", "CANCELLED"],
  IN_CONFERENCE: ["CONFERRED", "CANCELLED"],
  CONFERRED: ["PUTAWAY", "CANCELLED"],
  PUTAWAY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
});

const receiptInclude = {
  supplier: true,
  dock: true,
  operator: { select: { id: true, name: true } },
  items: { include: { product: { select: { sku: true, description: true, lotControl: true, expiryControl: true } }, lot: true } },
} as const;

export async function list(query: PaginationQuery & { status?: ReceiptStatus; supplierId?: string }) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.q ? { number: { contains: query.q, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.receipt.findMany({ where, include: receiptInclude, orderBy: { scheduledDate: "desc" }, ...toSkipTake(query) }),
    prisma.receipt.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function get(id: string) {
  const receipt = await prisma.receipt.findUnique({ where: { id }, include: receiptInclude });
  if (!receipt) throw new NotFoundError("Recebimento", id);
  return receipt;
}

export async function create(actor: AuthUser, data: z.infer<typeof createReceiptSchema>) {
  const dup = await prisma.receipt.findUnique({ where: { number: data.number } });
  if (dup) throw new ConflictError(`Número de recebimento já existe: ${data.number}`);

  return prisma.$transaction(async (tx) => {
    const created = await tx.receipt.create({
      data: {
        number: data.number,
        supplierId: data.supplierId,
        scheduledDate: data.scheduledDate,
        dockId: data.dockId,
        crossDock: data.crossDock,
        notes: data.notes,
        items: { create: data.items.map((i) => ({ productId: i.productId, expectedQty: i.expectedQty })) },
      },
      include: receiptInclude,
    });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Receipt", entityId: created.id, newValue: { number: created.number, items: data.items.length } });
    return created;
  });
}

async function transition(actor: AuthUser, id: string, to: ReceiptStatus, extra: Record<string, unknown> = {}) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundError("Recebimento", id);
    receiptStateMachine.assertCanTransition(receipt.status, to);
    await guardedTransition(tx.receipt, id, receipt.status, { status: to, ...extra });
    const updated = await tx.receipt.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: `TRANSITION_${to}`, entityType: "Receipt", entityId: id, previousValue: { status: receipt.status }, newValue: { status: to } });
    return updated;
  });
}

export const markArrived = (actor: AuthUser, id: string) => transition(actor, id, "ARRIVED", { arrivalDate: new Date() });

export async function assignDock(actor: AuthUser, id: string, dockId: string) {
  return transition(actor, id, "AT_DOCK", { dockId });
}

export async function startConference(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundError("Recebimento", id);
    receiptStateMachine.assertCanTransition(receipt.status, "IN_CONFERENCE");
    await guardedTransition(tx.receipt, id, receipt.status, { status: "IN_CONFERENCE", operatorId: actor.id });
    const updated = await tx.receipt.findUniqueOrThrow({ where: { id } });
    await taskService.createTask(tx, {
      type: "CONFERENCE",
      priority: "NORMAL",
      refType: "Receipt",
      refId: id,
      receiptId: id,
    });
    await writeAudit(tx, actor, { action: "START_CONFERENCE", entityType: "Receipt", entityId: id, newValue: { operator: actor.name } });
    return updated;
  });
}

/**
 * Records checked quantity/lot/damage for one receipt item (section 9).
 * Divergences are never silently corrected: any mismatch against the
 * expected quantity, or any damage, raises a Discrepancy instead of
 * quietly adjusting numbers (section 10).
 */
export async function checkItem(actor: AuthUser, receiptId: string, itemId: string, data: z.infer<typeof checkItemSchema>) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id: receiptId } });
    if (!receipt) throw new NotFoundError("Recebimento", receiptId);
    if (receipt.status !== "IN_CONFERENCE") {
      throw new ValidationError("Recebimento precisa estar em conferência para registrar itens.");
    }
    const item = await tx.receiptItem.findUnique({ where: { id: itemId }, include: { product: true } });
    if (!item || item.receiptId !== receiptId) throw new NotFoundError("Item de recebimento", itemId);
    if (item.status !== "PENDING") {
      // Without this, a double-click or a retried request would silently
      // raise a second Discrepancy for the same item on every resubmission
      // instead of being rejected — section 10's "never silently corrected"
      // cuts both ways: it also means never silently re-processed.
      throw new ConflictError(`Item já conferido (status atual: ${item.status}).`);
    }

    let lotId: string | undefined;
    if (item.product.lotControl) {
      if (!data.lotCode) throw new ValidationError(`Produto ${item.product.sku} exige informação de lote.`);
      const existingLot = await tx.lot.findUnique({ where: { productId_code: { productId: item.productId, code: data.lotCode } } });
      lotId = existingLot
        ? existingLot.id
        : (
            await tx.lot.create({
              data: {
                productId: item.productId,
                code: data.lotCode,
                supplierId: receipt.supplierId,
                manufactureDate: data.manufactureDate,
                expiryDate: data.expiryDate,
              },
            })
          ).id;
    }

    const hasDivergence = data.receivedQty !== item.expectedQty || data.damagedQty > 0;
    // CAS on status: "PENDING" — closes the true-concurrency version of the
    // double-submit race the guard above only catches sequentially (two
    // requests both reading PENDING before either commits would otherwise
    // both pass that check and both raise a discrepancy).
    const guarded = await tx.receiptItem.updateMany({
      where: { id: itemId, status: "PENDING" },
      data: {
        receivedQty: data.receivedQty,
        damagedQty: data.damagedQty,
        lotId,
        status: hasDivergence ? "DIVERGENT" : "CHECKED",
      },
    });
    if (guarded.count === 0) throw new ConflictError("Item já foi conferido por outra operação nesse meio tempo.");
    const updated = await tx.receiptItem.findUniqueOrThrow({ where: { id: itemId } });

    if (data.receivedQty !== item.expectedQty) {
      await raiseDiscrepancy(tx, {
        type: data.receivedQty < item.expectedQty ? "SHORTAGE" : "OVERAGE",
        refType: "ReceiptItem",
        refId: itemId,
        productId: item.productId,
        expectedQty: item.expectedQty,
        actualQty: data.receivedQty,
        description: `Divergência de quantidade no recebimento ${receipt.number}: esperado ${item.expectedQty}, recebido ${data.receivedQty}.`,
        createdById: actor.id,
      });
    }
    if (data.damagedQty > 0) {
      await raiseDiscrepancy(tx, {
        type: "DAMAGE",
        refType: "ReceiptItem",
        refId: itemId,
        productId: item.productId,
        expectedQty: item.expectedQty,
        actualQty: data.damagedQty,
        description: `${data.damagedQty} unidade(s) avariada(s) no recebimento ${receipt.number}.`,
        createdById: actor.id,
      });
    }

    await writeAudit(tx, actor, {
      action: "CHECK_ITEM",
      entityType: "ReceiptItem",
      entityId: itemId,
      previousValue: { expectedQty: item.expectedQty },
      newValue: { receivedQty: data.receivedQty, damagedQty: data.damagedQty, divergent: hasDivergence },
    });

    return updated;
  });
}

/** Closes conference and generates one PUT-AWAY task per checked item (section 11: stock only updates once put-away completes). */
export async function completeConference(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id }, include: { items: true } });
    if (!receipt) throw new NotFoundError("Recebimento", id);
    receiptStateMachine.assertCanTransition(receipt.status, "CONFERRED");

    const pending = receipt.items.filter((i) => i.status === "PENDING");
    if (pending.length > 0) throw new ValidationError(`Existem ${pending.length} item(ns) ainda não conferido(s).`);

    // Guarded: without this, two concurrent "concluir conferência" calls
    // (e.g. a double-click) would both pass the checks above and both go on
    // to generate a full duplicate set of PUTAWAY tasks below.
    await guardedTransition(tx.receipt, id, receipt.status, { status: "CONFERRED" });

    const conferenceTask = await tx.task.findFirst({ where: { refType: "Receipt", refId: id, type: "CONFERENCE", status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } } });
    if (conferenceTask) {
      if (conferenceTask.status !== "IN_PROGRESS") {
        await taskService.startTaskTx(tx, conferenceTask.id, actor.id);
      }
      await taskService.completeTaskTx(tx, conferenceTask.id);
    }

    const goodItems = receipt.items.filter((i) => i.status !== "PENDING" && i.receivedQty - i.damagedQty > 0);
    for (const item of goodItems) {
      await taskService.createTask(tx, {
        type: "PUTAWAY",
        priority: "NORMAL",
        refType: "ReceiptItem",
        refId: item.id,
        productId: item.productId,
        qty: item.receivedQty - item.damagedQty,
        receiptId: id,
      });
    }

    await tx.receipt.update({ where: { id }, data: { status: "PUTAWAY" } });
    const updated = await tx.receipt.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "COMPLETE_CONFERENCE", entityType: "Receipt", entityId: id, newValue: { putawayTasks: goodItems.length } });
    return updated;
  });
}

/** Executes one put-away task: moves stock into InventoryBalance for the first time (mobile scan flow). */
export async function executePutaway(actor: AuthUser, taskId: string, destLocationId: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError("Tarefa", taskId);
    if (task.type !== "PUTAWAY") throw new ValidationError("Tarefa não é do tipo PUTAWAY.");
    if (task.status === "COMPLETED") throw new ConflictError("Tarefa já concluída.");
    if (task.status === "CANCELLED") throw new ConflictError("Tarefa cancelada.");
    if (task.assignedToId && task.assignedToId !== actor.id) throw new ConflictError("Tarefa atribuída a outro operador.");

    if (task.status !== "IN_PROGRESS") {
      // Covers both PENDING (nobody claimed it yet) and ASSIGNED (a
      // supervisor pre-assigned it via /tasks/:id/assign) — the task state
      // machine only allows IN_PROGRESS -> COMPLETED, so skipping this step
      // whenever status was ASSIGNED (as an earlier version of this
      // function did, checking `=== "PENDING"` only) would leave the task
      // stuck ASSIGNED and make completeTaskTx below reject the transition
      // outright. Guarded compare-and-swap, not a plain unconditional
      // update: two operators racing to execute the same put-away task must
      // not both proceed to double-add the received stock to InventoryBalance.
      await taskService.startTaskTx(tx, taskId, actor.id);
    }

    const item = await tx.receiptItem.findUniqueOrThrow({ where: { id: task.refId } });

    await engine.increaseAvailable(tx, {
      type: "PUTAWAY",
      productId: task.productId!,
      lotId: item.lotId,
      qty: task.qty!,
      toLocationId: destLocationId,
      userId: actor.id,
      refType: "ReceiptItem",
      refId: item.id,
    });

    await tx.receiptItem.update({ where: { id: item.id }, data: { status: "PUT_AWAY" } });
    await taskService.completeTaskTx(tx, taskId);
    await tx.task.update({ where: { id: taskId }, data: { destLocationId } });

    const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: item.receiptId }, include: { items: true } });
    const allDone = receipt.items.every((i) => i.status === "PUT_AWAY" || (i.status !== "PENDING" && i.receivedQty - i.damagedQty === 0));
    if (allDone) {
      await tx.receipt.update({ where: { id: receipt.id }, data: { status: "COMPLETED" } });
    }

    await writeAudit(tx, actor, { action: "EXECUTE_PUTAWAY", entityType: "Task", entityId: taskId, newValue: { destLocationId, qty: task.qty } });
    return { taskId, destLocationId, receiptCompleted: allDone };
  });
}

export async function cancel(actor: AuthUser, id: string, reason: string) {
  return transition(actor, id, "CANCELLED", { notes: reason });
}
