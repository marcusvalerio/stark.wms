import { Prisma, PrismaClient } from "@prisma/client";
import * as engine from "@/modules/inventory/inventory.engine";
import * as taskService from "@/modules/tasks/task.service";

type Tx = Prisma.TransactionClient | PrismaClient;

// Section 16 — Allocation Engine: for each order item, walks candidate
// balances honoring FIFO/FEFO (section 17: expiry-controlled products
// always prioritize FEFO), reserves what's available, and records how much
// could not be covered (backorder / partial shortage per section 16).
export async function allocateOrderItem(tx: Tx, orderItemId: string) {
  const orderItem = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: { product: true, order: true } });
  const remainingNeeded = orderItem.qtyOrdered - orderItem.qtyAllocated;
  if (remainingNeeded <= 0) return { allocated: 0, backorder: 0 };

  const balances = await tx.inventoryBalance.findMany({
    where: {
      productId: orderItem.productId,
      qtyAvailable: { gt: 0 },
      location: { type: { in: ["PICKING", "RESERVE", "CROSS_DOCK"] }, status: "ACTIVE" },
    },
    include: { lot: true, location: true },
  });

  const strategy = orderItem.product.expiryControl ? "FEFO" : "FIFO";
  balances.sort((a, b) => {
    if (strategy === "FEFO") {
      const ea = a.lot?.expiryDate?.getTime() ?? Infinity;
      const eb = b.lot?.expiryDate?.getTime() ?? Infinity;
      if (ea !== eb) return ea - eb;
    }
    // FIFO fallback / tiebreaker: oldest stock (by when it entered inventory) first.
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  // Picking-face locations are drawn down before reserve stock.
  balances.sort((a, b) => (a.location.type === b.location.type ? 0 : a.location.type === "PICKING" ? -1 : 1));

  let remaining = remainingNeeded;
  let sequence = 0;
  for (const balance of balances) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, balance.qtyAvailable);
    if (take <= 0) continue;

    await engine.reserveStock(tx, {
      productId: orderItem.productId,
      locationId: balance.locationId,
      lotId: balance.lotId,
      qty: take,
      orderItemId,
    });

    await tx.allocation.create({
      data: {
        orderItemId,
        productId: orderItem.productId,
        lotId: balance.lotId,
        locationId: balance.locationId,
        qty: take,
        status: "PENDING",
      },
    });

    remaining -= take;
    sequence += 1;
  }

  const allocated = remainingNeeded - remaining;
  if (allocated > 0) {
    await tx.orderItem.update({ where: { id: orderItemId }, data: { qtyAllocated: { increment: allocated } } });
  }

  return { allocated, backorder: remaining };
}

export async function allocateOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  let totalBackorder = 0;
  for (const item of order.items) {
    const result = await allocateOrderItem(tx, item.id);
    totalBackorder += result.backorder;
  }
  return { totalBackorder };
}

/** Generates one PickingTask + orchestration Task per pending Allocation (section 16/17). */
export async function generatePickingTasks(tx: Tx, orderId: string, waveId?: string) {
  const pendingAllocations = await tx.allocation.findMany({
    where: { orderItem: { orderId }, status: "PENDING" },
    include: { location: true, orderItem: { include: { product: true, order: true } } },
    orderBy: { location: { fullCode: "asc" } },
  });

  const created = [];
  for (let i = 0; i < pendingAllocations.length; i++) {
    const allocation = pendingAllocations[i];
    const existingTask = await tx.pickingTask.findFirst({ where: { orderItemId: allocation.orderItemId, locationId: allocation.locationId, lotId: allocation.lotId ?? undefined, status: { not: "CANCELLED" } } });
    if (existingTask) continue;

    const pickingTask = await tx.pickingTask.create({
      data: {
        waveId,
        orderItemId: allocation.orderItemId,
        productId: allocation.productId,
        lotId: allocation.lotId,
        locationId: allocation.locationId,
        qtySuggested: allocation.qty,
        sequence: i + 1,
        strategy: allocation.orderItem.product.expiryControl ? "FEFO" : "FIFO",
        status: "PENDING",
      },
    });

    await taskService.createTask(tx, {
      type: "PICKING",
      priority: taskService.computeTaskPriority({ orderPriority: allocation.orderItem.order?.priority, slaDueAt: allocation.orderItem.order?.slaDueAt }),
      refType: "PickingTask",
      refId: pickingTask.id,
      originLocationId: allocation.locationId,
      productId: allocation.productId,
      qty: allocation.qty,
      slaDueAt: allocation.orderItem.order?.slaDueAt ?? undefined,
    });

    created.push(pickingTask);
  }
  return created;
}
