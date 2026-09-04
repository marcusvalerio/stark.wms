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

      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { expiryControl: true } });
      const reserveCandidates = await prisma.inventoryBalance.findMany({
        where: { productId, qtyAvailable: { gt: 0 }, location: { type: "RESERVE", status: "ACTIVE" } },
        include: { lot: true },
      });
      if (reserveCandidates.length === 0) continue;
      // FEFO for expiry-controlled products (matches the Allocation
      // Engine's rule — replenishment should not strand near-expiry stock
      // in reserve while picking faces pull from newer lots), FIFO
      // otherwise, mirroring allocation-engine.ts's ordering logic.
      reserveCandidates.sort((a, b) => {
        if (product.expiryControl) {
          const ea = a.lot?.expiryDate?.getTime() ?? Infinity;
          const eb = b.lot?.expiryDate?.getTime() ?? Infinity;
          if (ea !== eb) return ea - eb;
        }
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      const reserveBalance = reserveCandidates[0];

      const target = location.pickingMax ?? location.pickingMin ?? currentQty;
      const desiredQty = Math.max(target - currentQty, 0);
      const qty = Math.min(desiredQty, reserveBalance.qtyAvailable);
      if (qty <= 0) continue;

      const task = await prisma.$transaction(async (tx) => {
        const replenishment = await tx.replenishmentTask.create({
          data: { productId, lotId: reserveBalance.lotId, fromLocationId: reserveBalance.locationId, toLocationId: location.id, qty, status: "PENDING" },
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

    // Claim the task atomically before touching inventory: two operators
    // racing to execute the same ReplenishmentTask must not both succeed in
    // transferring stock (source has enough for two transfers of the same
    // qty, so the inventory-engine guard alone won't catch a duplicate
    // execution — this row-level compare-and-swap is what prevents it).
    const claimed = await tx.replenishmentTask.updateMany({
      where: { id, status: task.status, operatorId: task.operatorId },
      data: { status: "COMPLETED", operatorId: actor.id, completedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictError("Tarefa foi executada por outra operação nesse meio tempo.");

    await engine.transferStock(tx, {
      type: "REPLENISH",
      productId: task.productId,
      qty: task.qty,
      lotId: task.lotId,
      fromLocationId: task.fromLocationId,
      toLocationId: task.toLocationId,
      userId: actor.id,
      refType: "ReplenishmentTask",
      refId: id,
    });

    const updated = await tx.replenishmentTask.findUniqueOrThrow({ where: { id } });

    const genericTask = await tx.task.findFirst({ where: { refType: "ReplenishmentTask", refId: id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } } });
    if (genericTask) {
      if (genericTask.status !== "IN_PROGRESS") {
        await taskService.startTaskTx(tx, genericTask.id, actor.id);
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
    // Guarded: if an execute() call raced ahead and already completed this
    // task (moving real stock), a plain unconditional update here would
    // stomp COMPLETED back to CANCELLED even though the transfer happened.
    const result = await tx.replenishmentTask.updateMany({ where: { id, status: task.status }, data: { status: "CANCELLED" } });
    if (result.count === 0) throw new ConflictError("Tarefa foi alterada por outra operação nesse meio tempo.");
    const updated = await tx.replenishmentTask.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "ReplenishmentTask", entityId: id, newValue: { status: "CANCELLED" } });
    return updated;
  });
}
