import { OrderStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/common/errors";
import { StateMachine } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { createOrderSchema } from "@/modules/orders/order.schema";
import { allocateOrder, generatePickingTasks } from "@/modules/orders/allocation-engine";
import * as engine from "@/modules/inventory/inventory.engine";

// Section 15/39: explicit order lifecycle. No reverse jump without an
// authorized reversal path (e.g. SHIPPED is terminal here).
export const orderStateMachine = new StateMachine<OrderStatus>("Pedido", {
  RECEIVED: ["RELEASED", "CANCELLED"],
  RELEASED: ["ALLOCATED", "CANCELLED"],
  ALLOCATED: ["PICKING", "CANCELLED"],
  PICKING: ["PICKED", "CANCELLED"],
  PICKED: ["CONFERENCE"],
  CONFERENCE: ["PACKING"],
  PACKING: ["STAGING"],
  STAGING: ["READY"],
  READY: ["SHIPPED"],
  SHIPPED: [],
  CANCELLED: [],
});

const orderInclude = {
  customer: true,
  carrier: true,
  items: { include: { product: { select: { sku: true, description: true, expiryControl: true, lotControl: true } }, uom: true } },
} as const;

export async function list(query: PaginationQuery & { status?: OrderStatus; customerId?: string }) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.q ? { number: { contains: query.q, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, include: orderInclude, orderBy: [{ priority: "asc" }, { orderDate: "desc" }], ...toSkipTake(query) }),
    prisma.order.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function get(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new NotFoundError("Pedido", id);
  return order;
}

export async function create(actor: AuthUser, data: z.infer<typeof createOrderSchema>) {
  const dup = await prisma.order.findUnique({ where: { number: data.number } });
  if (dup) throw new ConflictError(`Número de pedido já existe: ${data.number}`);

  return prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        number: data.number,
        customerId: data.customerId,
        priority: data.priority,
        slaDueAt: data.slaDueAt,
        carrierId: data.carrierId,
        shippingAddress: data.shippingAddress,
        notes: data.notes,
        items: { create: data.items.map((i) => ({ productId: i.productId, uomId: i.uomId, qtyOrdered: i.qtyOrdered })) },
      },
      include: orderInclude,
    });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Order", entityId: created.id, newValue: { number: created.number, items: data.items.length } });
    return created;
  });
}

/** Section 14/16: release verifies availability/reservations and allocates stock (FIFO/FEFO), moving RECEIVED -> RELEASED -> ALLOCATED atomically. */
export async function release(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Pedido", id);
    orderStateMachine.assertCanTransition(order.status, "RELEASED");
    await tx.order.update({ where: { id }, data: { status: "RELEASED" } });

    const { totalBackorder } = await allocateOrder(tx, id);

    orderStateMachine.assertCanTransition("RELEASED", "ALLOCATED");
    const updated = await tx.order.update({ where: { id }, data: { status: "ALLOCATED" } });

    await writeAudit(tx, actor, { action: "RELEASE_ALLOCATE", entityType: "Order", entityId: id, newValue: { backorder: totalBackorder } });
    return { ...updated, backorder: totalBackorder };
  });
}

/** Section 16/17: generates picking tasks from the order's pending allocations. */
export async function startPicking(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Pedido", id);
    orderStateMachine.assertCanTransition(order.status, "PICKING");

    const tasks = await generatePickingTasks(tx, id);
    if (tasks.length === 0) throw new ValidationError("Nenhuma alocação pendente para gerar tarefas de separação.");

    const updated = await tx.order.update({ where: { id }, data: { status: "PICKING" } });
    await writeAudit(tx, actor, { action: "START_PICKING", entityType: "Order", entityId: id, newValue: { tasksGenerated: tasks.length } });
    return updated;
  });
}

export async function advanceToConference(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundError("Pedido", id);
    orderStateMachine.assertCanTransition(order.status, "CONFERENCE");

    const incomplete = order.items.some((i) => i.qtyPicked < i.qtyAllocated);
    if (incomplete) throw new ValidationError("Pedido não pode ser conferido: existem itens ainda não separados.");

    const updated = await tx.order.update({ where: { id }, data: { status: "CONFERENCE" } });
    await writeAudit(tx, actor, { action: "ADVANCE_CONFERENCE", entityType: "Order", entityId: id, newValue: { status: "CONFERENCE" } });
    return updated;
  });
}

export async function cancel(actor: AuthUser, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: { include: { reservations: true } } } });
    if (!order) throw new NotFoundError("Pedido", id);
    orderStateMachine.assertCanTransition(order.status, "CANCELLED");

    for (const item of order.items) {
      for (const reservation of item.reservations) {
        if (reservation.status === "ACTIVE") {
          await engine.releaseReservation(tx, reservation.id);
        }
      }
    }
    await tx.allocation.updateMany({ where: { orderItem: { orderId: id }, status: "PENDING" }, data: { status: "CANCELLED" } });
    await tx.pickingTask.updateMany({ where: { orderItem: { orderId: id }, status: { in: ["PENDING", "ASSIGNED"] } }, data: { status: "CANCELLED" } });

    const updated = await tx.order.update({ where: { id }, data: { status: "CANCELLED", notes: reason } });
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "Order", entityId: id, previousValue: { status: order.status }, newValue: { status: "CANCELLED", reason } });
    return updated;
  });
}
