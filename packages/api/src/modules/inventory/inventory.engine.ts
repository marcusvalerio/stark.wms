import { MovementType, Prisma, PrismaClient } from "@prisma/client";
import { IncompatibleLocationError, InsufficientStockError, LocationCapacityError } from "@/common/errors";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface BalanceKey {
  productId: string;
  locationId: string;
  lotId?: string | null;
}

// The Inventory Engine (section 12) is the single writer of InventoryBalance.
// Every quantity mutation in the system — receiving, put-away, picking,
// replenishment, transfers, blocks, quarantine, count adjustments — funnels
// through these functions so physical/available/reserved/blocked/quarantine
// buckets never drift apart, and every change is paired with a Movement
// record (section 13/38 traceability).
//
// Concurrency note (audit section 3.3/3.7): every decrement below is a
// single atomic `updateMany` guarded by a `{ gte: qty }` condition on the
// column being drawn down, never a "read qty, check in JS, then write"
// two-step. Two concurrent requests racing to reserve/consume/block the
// same balance are serialized by Postgres' row lock on the UPDATE itself —
// the loser's guard re-evaluates against the post-first-write value and
// correctly fails with InsufficientStockError instead of driving the
// column negative. Do not "simplify" these back into find-then-update.
async function guardedDecrement(
  tx: Tx,
  balanceId: string,
  field: "qtyPhysical" | "qtyAvailable" | "qtyReserved" | "qtyBlocked" | "qtyQuarantine",
  qty: number,
  extra: Prisma.InventoryBalanceUpdateManyMutationInput = {}
): Promise<boolean> {
  const result = await tx.inventoryBalance.updateMany({
    where: { id: balanceId, [field]: { gte: qty } },
    data: { [field]: { decrement: qty }, ...extra },
  });
  return result.count === 1;
}

// Note on (productId, locationId, lotId) uniqueness: lotId is nullable for
// products without lot control. Postgres unique indexes treat NULL as
// distinct from NULL, so a plain UNIQUE(productId, locationId, lotId) would
// not stop two concurrent first-writes for a no-lot product+location from
// creating duplicate rows. The DB carries a real constraint for this — an
// expression unique index on (productId, locationId, COALESCE(lotId, ''))
// — see migration 20260904010152_replenishment_lot_and_balance_integrity.
// getOrCreateBalance relies on it: the losing concurrent transaction's
// `create` raises P2002, and we fall back to re-reading the winner's row
// instead of silently duplicating it.
async function findBalance(tx: Tx, key: BalanceKey) {
  return tx.inventoryBalance.findFirst({
    where: { productId: key.productId, locationId: key.locationId, lotId: key.lotId ?? null },
  });
}

async function getOrCreateBalance(tx: Tx, key: BalanceKey) {
  const existing = await findBalance(tx, key);
  if (existing) return existing;
  try {
    return await tx.inventoryBalance.create({
      data: {
        productId: key.productId,
        locationId: key.locationId,
        lotId: key.lotId ?? null,
        qtyPhysical: 0,
        qtyAvailable: 0,
        qtyReserved: 0,
        qtyBlocked: 0,
        qtyQuarantine: 0,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await findBalance(tx, key);
      if (winner) return winner;
    }
    throw err;
  }
}

interface MovementParams {
  type: MovementType;
  productId: string;
  lotId?: string | null;
  qty: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  userId: string;
  reason?: string;
  refType?: string;
  refId?: string;
}

async function recordMovement(tx: Tx, params: MovementParams) {
  return tx.movement.create({
    data: {
      type: params.type,
      productId: params.productId,
      lotId: params.lotId ?? null,
      qty: params.qty,
      fromLocationId: params.fromLocationId ?? null,
      toLocationId: params.toLocationId ?? null,
      userId: params.userId,
      reason: params.reason,
      refType: params.refType,
      refId: params.refId,
    },
  });
}

interface LocationCheck {
  id: string;
  capacityQty: number;
  occupiedQty: number;
  characteristics: Prisma.JsonValue;
}

/**
 * Enforces section 3.6/scenario 8-9 of the audit: a location with a
 * category allow-list rejects an incompatible product outright (not just a
 * suggestion — a hard write-time gate), and capacity is a real ceiling, not
 * a courtesy check. The occupiedQty bump is itself guarded (`lte` the
 * remaining headroom) so two concurrent put-aways racing for the last slots
 * in a location can't both succeed and blow past capacityQty.
 */
async function assertCompatibleAndReserveCapacity(tx: Tx, locationId: string, productId: string, qty: number) {
  const location = await tx.location.findUnique({
    where: { id: locationId },
    select: { id: true, capacityQty: true, occupiedQty: true, characteristics: true },
  });
  if (!location) throw new InsufficientStockError("Localização de destino não encontrada.");

  const allowedCategories = (location.characteristics as { allowedCategories?: string[] } | null)?.allowedCategories;
  if (allowedCategories && allowedCategories.length > 0) {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { categoryId: true } });
    if (!product || !allowedCategories.includes(product.categoryId)) {
      throw new IncompatibleLocationError(`Endereço restrito a categorias específicas; produto não é compatível.`);
    }
  }

  const remaining = location.capacityQty - location.occupiedQty;
  if (qty > remaining) {
    throw new LocationCapacityError(`Capacidade insuficiente no endereço (disponível: ${remaining}, solicitado: ${qty}).`);
  }

  const result = await tx.location.updateMany({
    where: { id: locationId, occupiedQty: { lte: location.capacityQty - qty } },
    data: { occupiedQty: { increment: qty } },
  });
  if (result.count === 0) {
    throw new LocationCapacityError(`Capacidade do endereço foi ocupada por outra operação simultânea.`);
  }
}

/** Goods entering trackable inventory for the first time (put-away completion). */
export async function increaseAvailable(tx: Tx, params: MovementParams & { intoQuarantine?: boolean }) {
  if (params.qty <= 0) throw new InsufficientStockError("Quantidade deve ser positiva.");
  if (!params.toLocationId) throw new InsufficientStockError("Localização de destino obrigatória.");

  await assertCompatibleAndReserveCapacity(tx, params.toLocationId, params.productId, params.qty);

  const balance = await getOrCreateBalance(tx, { productId: params.productId, locationId: params.toLocationId, lotId: params.lotId });
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: params.intoQuarantine
      ? { qtyPhysical: { increment: params.qty }, qtyQuarantine: { increment: params.qty } }
      : { qtyPhysical: { increment: params.qty }, qtyAvailable: { increment: params.qty } },
  });
  return recordMovement(tx, params);
}

/** Moves physical + available stock between two locations (put-away, replenishment, transfer). */
export async function transferStock(tx: Tx, params: MovementParams) {
  if (params.qty <= 0) throw new InsufficientStockError("Quantidade deve ser positiva.");
  if (!params.fromLocationId || !params.toLocationId) {
    throw new InsufficientStockError("Localização de origem e destino são obrigatórias para transferência.");
  }
  const source = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId, lotId: params.lotId });
  if (!source) {
    throw new InsufficientStockError(`Estoque disponível insuficiente na origem para transferir ${params.qty} unidade(s).`);
  }

  await assertCompatibleAndReserveCapacity(tx, params.toLocationId, params.productId, params.qty);

  const decremented = await guardedDecrement(tx, source.id, "qtyAvailable", params.qty, { qtyPhysical: { decrement: params.qty } });
  if (!decremented) {
    // Roll back the capacity we just reserved at the destination before failing.
    await tx.location.update({ where: { id: params.toLocationId }, data: { occupiedQty: { decrement: params.qty } } });
    throw new InsufficientStockError(`Estoque disponível insuficiente na origem para transferir ${params.qty} unidade(s).`);
  }
  await tx.location.update({ where: { id: params.fromLocationId }, data: { occupiedQty: { decrement: params.qty } } });

  const dest = await getOrCreateBalance(tx, { productId: params.productId, locationId: params.toLocationId, lotId: params.lotId });
  await tx.inventoryBalance.update({
    where: { id: dest.id },
    data: { qtyPhysical: { increment: params.qty }, qtyAvailable: { increment: params.qty } },
  });

  return recordMovement(tx, params);
}

/** Reserves available stock for an order item (section 14). Never lets two orders reserve the same units. */
export async function reserveStock(tx: Tx, params: { productId: string; locationId: string; lotId?: string | null; qty: number; orderItemId: string }) {
  if (params.qty <= 0) throw new InsufficientStockError("Quantidade de reserva deve ser positiva.");
  const balance = await findBalance(tx, params);
  if (!balance) {
    throw new InsufficientStockError(`Estoque disponível insuficiente para reservar ${params.qty} unidade(s).`);
  }
  const decremented = await guardedDecrement(tx, balance.id, "qtyAvailable", params.qty, { qtyReserved: { increment: params.qty } });
  if (!decremented) {
    throw new InsufficientStockError(`Estoque disponível insuficiente para reservar ${params.qty} unidade(s).`);
  }
  return tx.inventoryReservation.create({
    data: {
      orderItemId: params.orderItemId,
      productId: params.productId,
      locationId: params.locationId,
      lotId: params.lotId ?? null,
      qty: params.qty,
      status: "ACTIVE",
    },
  });
}

export async function releaseReservation(tx: Tx, reservationId: string) {
  const reservation = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: reservationId } });
  if (reservation.status !== "ACTIVE") return reservation;
  if (reservation.locationId) {
    const balance = await findBalance(tx, { productId: reservation.productId, locationId: reservation.locationId, lotId: reservation.lotId });
    if (balance) {
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { qtyAvailable: { increment: reservation.qty }, qtyReserved: { decrement: reservation.qty } },
      });
    }
  }
  return tx.inventoryReservation.update({ where: { id: reservationId }, data: { status: "RELEASED" } });
}

/** Consumes a reservation and removes stock physically (pick completion). */
export async function consumeReservation(tx: Tx, params: { reservationId: string; qty: number; userId: string; refType: string; refId: string }) {
  const reservation = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: params.reservationId } });
  if (reservation.status !== "ACTIVE") throw new InsufficientStockError("Reserva não está ativa.");
  if (!reservation.locationId) throw new InsufficientStockError("Reserva sem localização associada.");
  if (params.qty > reservation.qty) throw new InsufficientStockError("Quantidade a separar excede o saldo reservado.");
  const balance = await findBalance(tx, { productId: reservation.productId, locationId: reservation.locationId, lotId: reservation.lotId });
  if (!balance) {
    throw new InsufficientStockError("Saldo reservado/físico insuficiente para concluir a separação.");
  }

  // Guard on qtyReserved (the binding/smaller bucket — physical is always
  // >= reserved), not qtyPhysical: see the comment on the count-adjustment
  // decrement above for why guarding the larger bucket lets the smaller one
  // underflow under concurrent consumption of the same balance.
  const decremented = await guardedDecrement(tx, balance.id, "qtyReserved", params.qty, { qtyPhysical: { decrement: params.qty } });
  if (!decremented) {
    throw new InsufficientStockError("Saldo reservado/físico insuficiente para concluir a separação.");
  }
  await tx.location.update({ where: { id: reservation.locationId }, data: { occupiedQty: { decrement: params.qty } } });

  const remaining = reservation.qty - params.qty;
  await tx.inventoryReservation.update({
    where: { id: reservation.id },
    data: remaining <= 0 ? { status: "CONSUMED", qty: params.qty } : { qty: remaining },
  });
  if (remaining > 0) {
    await tx.inventoryReservation.create({
      data: { orderItemId: reservation.orderItemId, productId: reservation.productId, locationId: reservation.locationId, lotId: reservation.lotId, qty: params.qty, status: "CONSUMED" },
    });
  }

  return recordMovement(tx, {
    type: "PICK",
    productId: reservation.productId,
    lotId: reservation.lotId,
    qty: params.qty,
    fromLocationId: reservation.locationId,
    userId: params.userId,
    refType: params.refType,
    refId: params.refId,
  });
}

export async function blockStock(tx: Tx, params: MovementParams) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance) throw new InsufficientStockError("Estoque disponível insuficiente para bloqueio.");
  const decremented = await guardedDecrement(tx, balance.id, "qtyAvailable", params.qty, { qtyBlocked: { increment: params.qty } });
  if (!decremented) throw new InsufficientStockError("Estoque disponível insuficiente para bloqueio.");
  return recordMovement(tx, { ...params, type: "BLOCK" });
}

export async function unblockStock(tx: Tx, params: MovementParams) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance) throw new InsufficientStockError("Estoque bloqueado insuficiente para desbloqueio.");
  const decremented = await guardedDecrement(tx, balance.id, "qtyBlocked", params.qty, { qtyAvailable: { increment: params.qty } });
  if (!decremented) throw new InsufficientStockError("Estoque bloqueado insuficiente para desbloqueio.");
  return recordMovement(tx, { ...params, type: "UNBLOCK" });
}

export async function quarantineStock(tx: Tx, params: MovementParams) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance) throw new InsufficientStockError("Estoque disponível insuficiente para enviar à quarentena.");
  const decremented = await guardedDecrement(tx, balance.id, "qtyAvailable", params.qty, { qtyQuarantine: { increment: params.qty } });
  if (!decremented) throw new InsufficientStockError("Estoque disponível insuficiente para enviar à quarentena.");
  return recordMovement(tx, { ...params, type: "QUARANTINE" });
}

export async function releaseFromQuarantine(tx: Tx, params: MovementParams & { toBlocked?: boolean }) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance) throw new InsufficientStockError("Estoque em quarentena insuficiente.");
  const decremented = await guardedDecrement(
    tx,
    balance.id,
    "qtyQuarantine",
    params.qty,
    params.toBlocked ? { qtyBlocked: { increment: params.qty } } : { qtyAvailable: { increment: params.qty } }
  );
  if (!decremented) throw new InsufficientStockError("Estoque em quarentena insuficiente.");
  return recordMovement(tx, { ...params, type: "RELEASE" });
}

/**
 * Applies a count-driven correction, moving physical/available to the
 * counted value. Deliberately bypasses the capacity/compatibility gate
 * that guards normal put-away/transfer writes: a count corrects the
 * system's record to match physical reality, so if occupiedQty ends up
 * above capacityQty (e.g. reconciling stock that landed somewhere it
 * shouldn't have), that's a fact the count is reporting, not a new write
 * to block. Rejecting a count adjustment because of capacity would make
 * the count engine unable to do the one thing it exists for.
 */
export async function applyCountAdjustment(tx: Tx, params: { productId: string; locationId: string; lotId?: string | null; finalQty: number; userId: string; refType: string; refId: string; reason: string }) {
  const balance = await getOrCreateBalance(tx, params);
  const delta = params.finalQty - balance.qtyPhysical;
  if (delta === 0) return null;

  if (delta > 0) {
    await tx.inventoryBalance.update({ where: { id: balance.id }, data: { qtyPhysical: { increment: delta }, qtyAvailable: { increment: delta } } });
    await tx.location.update({ where: { id: params.locationId }, data: { occupiedQty: { increment: delta } } });
  } else {
    // Guard on qtyAvailable, not qtyPhysical: physical always equals
    // available + reserved + blocked + quarantine, so physical >= available
    // always holds. Guarding the smaller (binding) bucket is what actually
    // prevents driving qtyAvailable negative — guarding qtyPhysical instead
    // would pass this check while qtyAvailable silently underflows whenever
    // part of the balance is reserved/blocked/quarantined.
    const decremented = await guardedDecrement(tx, balance.id, "qtyAvailable", -delta, { qtyPhysical: { decrement: -delta } });
    if (!decremented) {
      throw new InsufficientStockError("Ajuste reduziria o disponível abaixo de zero — verifique reservas/bloqueios antes de ajustar.");
    }
    await tx.location.update({ where: { id: params.locationId }, data: { occupiedQty: { decrement: -delta } } });
  }

  return recordMovement(tx, {
    type: "COUNT_ADJUST",
    productId: params.productId,
    lotId: params.lotId,
    qty: delta,
    toLocationId: delta > 0 ? params.locationId : undefined,
    fromLocationId: delta < 0 ? params.locationId : undefined,
    userId: params.userId,
    reason: params.reason,
    refType: params.refType,
    refId: params.refId,
  });
}

export async function getAvailableQty(tx: Tx, params: { productId: string; locationId?: string; lotId?: string | null }) {
  const balances = await tx.inventoryBalance.findMany({
    where: { productId: params.productId, locationId: params.locationId, lotId: params.lotId },
  });
  return balances.reduce((sum, b) => sum + b.qtyAvailable, 0);
}
