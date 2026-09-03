import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import * as engine from "@/modules/inventory/inventory.engine";
import * as taskService from "@/modules/tasks/task.service";
import { orderStateMachine } from "@/modules/orders/order.service";

export async function listPickingTasks(query: PaginationQuery & { status?: string; operatorId?: string; waveId?: string; orderId?: string }) {
  const where = {
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.operatorId ? { operatorId: query.operatorId } : {}),
    ...(query.waveId ? { waveId: query.waveId } : {}),
    ...(query.orderId ? { orderItem: { orderId: query.orderId } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.pickingTask.findMany({
      where,
      include: {
        product: { select: { sku: true, description: true, barcode: true } },
        location: { select: { fullCode: true } },
        orderItem: { include: { order: { select: { number: true, priority: true } } } },
      },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
      ...toSkipTake(query),
    }),
    prisma.pickingTask.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

/**
 * Executes one picking task (mobile scan flow: address -> scan product ->
 * qty -> confirm). Section 38's integrity chain runs in a single
 * transaction: consume reservation (drops physical + reserved), advance the
 * PickingTask, complete the orchestration Task, bump OrderItem.qtyPicked,
 * and — once every item of the order is fully picked — advance the order to
 * PICKED. Audit trail closes the loop.
 */
export async function executePickingTask(actor: AuthUser, pickingTaskId: string, qtyPicked: number) {
  return prisma.$transaction(async (tx) => {
    const pickingTask = await tx.pickingTask.findUnique({ where: { id: pickingTaskId }, include: { orderItem: { include: { order: true } } } });
    if (!pickingTask) throw new NotFoundError("Tarefa de picking", pickingTaskId);
    if (pickingTask.status === "COMPLETED") throw new ConflictError("Tarefa já concluída.");
    if (pickingTask.status === "CANCELLED") throw new ConflictError("Tarefa cancelada.");
    if (pickingTask.operatorId && pickingTask.operatorId !== actor.id) throw new ConflictError("Tarefa atribuída a outro operador.");

    const remainingOnTask = pickingTask.qtySuggested - pickingTask.qtyPicked;
    if (qtyPicked <= 0 || qtyPicked > remainingOnTask) {
      throw new ValidationError(`Quantidade superior ao saldo sugerido para esta tarefa (restam ${remainingOnTask}).`);
    }

    const reservation = await tx.inventoryReservation.findFirst({
      where: { orderItemId: pickingTask.orderItemId, locationId: pickingTask.locationId, lotId: pickingTask.lotId, status: "ACTIVE" },
    });
    if (!reservation || reservation.qty < qtyPicked) {
      throw new ValidationError("Reserva de estoque insuficiente para concluir a separação.");
    }

    await engine.consumeReservation(tx, { reservationId: reservation.id, qty: qtyPicked, userId: actor.id, refType: "PickingTask", refId: pickingTask.id });

    const newQtyPicked = pickingTask.qtyPicked + qtyPicked;
    const taskDone = newQtyPicked >= pickingTask.qtySuggested;
    await tx.pickingTask.update({
      where: { id: pickingTaskId },
      data: { qtyPicked: newQtyPicked, operatorId: actor.id, status: taskDone ? "COMPLETED" : "IN_PROGRESS", completedAt: taskDone ? new Date() : undefined },
    });

    const genericTask = await tx.task.findFirst({ where: { refType: "PickingTask", refId: pickingTaskId, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } } });
    if (genericTask) {
      if (genericTask.status !== "IN_PROGRESS") {
        await tx.task.update({ where: { id: genericTask.id }, data: { status: "IN_PROGRESS", assignedToId: actor.id, startedAt: genericTask.startedAt ?? new Date() } });
      }
      if (taskDone) {
        await taskService.completeTaskTx(tx, genericTask.id);
      }
    }

    await tx.orderItem.update({ where: { id: pickingTask.orderItemId }, data: { qtyPicked: { increment: qtyPicked } } });

    await writeAudit(tx, actor, { action: "PICK", entityType: "PickingTask", entityId: pickingTaskId, newValue: { qtyPicked } });

    let orderAdvanced = false;
    if (taskDone) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: pickingTask.orderItem.orderId }, include: { items: true } });
      const allPicked = order.items.every((i) => i.qtyPicked >= i.qtyAllocated);
      if (allPicked && order.status === "PICKING") {
        orderStateMachine.assertCanTransition(order.status, "PICKED");
        await tx.order.update({ where: { id: order.id }, data: { status: "PICKED" } });
        await writeAudit(tx, actor, { action: "ALL_ITEMS_PICKED", entityType: "Order", entityId: order.id, newValue: { status: "PICKED" } });
        orderAdvanced = true;
      }
    }

    return { pickingTaskId, qtyPicked, taskCompleted: taskDone, orderAdvancedToPicked: orderAdvanced };
  });
}
