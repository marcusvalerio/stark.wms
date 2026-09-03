import { MovementType, Prisma, PrismaClient } from "@prisma/client";
import { InsufficientStockError } from "@/common/errors";

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
// Note on (productId, locationId, lotId) uniqueness: lotId is nullable for
// products without lot control. Postgres unique indexes treat NULL as
// distinct from NULL, so ON CONFLICT upserts silently fail to merge rows
// when lotId is null. We therefore resolve the balance row with an explicit
// findFirst + create instead of relying on a DB-level upsert.
async function findBalance(tx: Tx, key: BalanceKey) {
  return tx.inventoryBalance.findFirst({
    where: { productId: key.productId, locationId: key.locationId, lotId: key.lotId ?? null },
  });
}

async function getOrCreateBalance(tx: Tx, key: BalanceKey) {
  const existing = await findBalance(tx, key);
  if (existing) return existing;
  return tx.inventoryBalance.create({
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

/** Goods entering trackable inventory for the first time (put-away completion). */
export async function increaseAvailable(tx: Tx, params: MovementParams & { intoQuarantine?: boolean }) {
  if (params.qty <= 0) throw new InsufficientStockError("Quantidade deve ser positiva.");
  if (!params.toLocationId) throw new InsufficientStockError("Localização de destino obrigatória.");
  const balance = await getOrCreateBalance(tx, { productId: params.productId, locationId: params.toLocationId, lotId: params.lotId });
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: params.intoQuarantine
      ? { qtyPhysical: { increment: params.qty }, qtyQuarantine: { increment: params.qty } }
      : { qtyPhysical: { increment: params.qty }, qtyAvailable: { increment: params.qty } },
  });
  await tx.location.update({ where: { id: params.toLocationId }, data: { occupiedQty: { increment: params.qty } } });
  return recordMovement(tx, params);
}

/** Moves physical + available stock between two locations (put-away, replenishment, transfer). */
export async function transferStock(tx: Tx, params: MovementParams) {
  if (params.qty <= 0) throw new InsufficientStockError("Quantidade deve ser positiva.");
  if (!params.fromLocationId || !params.toLocationId) {
    throw new InsufficientStockError("Localização de origem e destino são obrigatórias para transferência.");
  }
  const source = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId, lotId: params.lotId });
  if (!source || source.qtyAvailable < params.qty) {
    throw new InsufficientStockError(`Estoque disponível insuficiente na origem para transferir ${params.qty} unidade(s).`);
  }
  await tx.inventoryBalance.update({
    where: { id: source.id },
    data: { qtyPhysical: { decrement: params.qty }, qtyAvailable: { decrement: params.qty } },
  });
  await tx.location.update({ where: { id: params.fromLocationId }, data: { occupiedQty: { decrement: params.qty } } });

  const dest = await getOrCreateBalance(tx, { productId: params.productId, locationId: params.toLocationId, lotId: params.lotId });
  await tx.inventoryBalance.update({
    where: { id: dest.id },
    data: { qtyPhysical: { increment: params.qty }, qtyAvailable: { increment: params.qty } },
  });
  await tx.location.update({ where: { id: params.toLocationId }, data: { occupiedQty: { increment: params.qty } } });

  return recordMovement(tx, params);
}

/** Reserves available stock for an order item (section 14). Never lets two orders reserve the same units. */
export async function reserveStock(tx: Tx, params: { productId: string; locationId: string; lotId?: string | null; qty: number; orderItemId: string }) {
  if (params.qty <= 0) throw new InsufficientStockError("Quantidade de reserva deve ser positiva.");
  const balance = await findBalance(tx, params);
  if (!balance || balance.qtyAvailable < params.qty) {
    throw new InsufficientStockError(`Estoque disponível insuficiente para reservar ${params.qty} unidade(s).`);
  }
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { qtyAvailable: { decrement: params.qty }, qtyReserved: { increment: params.qty } },
  });
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
  const balance = await findBalance(tx, { productId: reservation.productId, locationId: reservation.locationId, lotId: reservation.lotId });
  if (!balance || balance.qtyReserved < params.qty || balance.qtyPhysical < params.qty) {
    throw new InsufficientStockError("Saldo reservado/físico insuficiente para concluir a separação.");
  }
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { qtyPhysical: { decrement: params.qty }, qtyReserved: { decrement: params.qty } },
  });
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
  if (!balance || balance.qtyAvailable < params.qty) throw new InsufficientStockError("Estoque disponível insuficiente para bloqueio.");
  await tx.inventoryBalance.update({ where: { id: balance.id }, data: { qtyAvailable: { decrement: params.qty }, qtyBlocked: { increment: params.qty } } });
  return recordMovement(tx, { ...params, type: "BLOCK" });
}

export async function unblockStock(tx: Tx, params: MovementParams) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance || balance.qtyBlocked < params.qty) throw new InsufficientStockError("Estoque bloqueado insuficiente para desbloqueio.");
  await tx.inventoryBalance.update({ where: { id: balance.id }, data: { qtyAvailable: { increment: params.qty }, qtyBlocked: { decrement: params.qty } } });
  return recordMovement(tx, { ...params, type: "UNBLOCK" });
}

export async function quarantineStock(tx: Tx, params: MovementParams) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance || balance.qtyAvailable < params.qty) throw new InsufficientStockError("Estoque disponível insuficiente para enviar à quarentena.");
  await tx.inventoryBalance.update({ where: { id: balance.id }, data: { qtyAvailable: { decrement: params.qty }, qtyQuarantine: { increment: params.qty } } });
  return recordMovement(tx, { ...params, type: "QUARANTINE" });
}

export async function releaseFromQuarantine(tx: Tx, params: MovementParams & { toBlocked?: boolean }) {
  const balance = await findBalance(tx, { productId: params.productId, locationId: params.fromLocationId!, lotId: params.lotId });
  if (!balance || balance.qtyQuarantine < params.qty) throw new InsufficientStockError("Estoque em quarentena insuficiente.");
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: params.toBlocked
      ? { qtyQuarantine: { decrement: params.qty }, qtyBlocked: { increment: params.qty } }
      : { qtyQuarantine: { decrement: params.qty }, qtyAvailable: { increment: params.qty } },
  });
  return recordMovement(tx, { ...params, type: "RELEASE" });
}

/** Applies a count-driven correction, moving physical/available to the counted value. */
export async function applyCountAdjustment(tx: Tx, params: { productId: string; locationId: string; lotId?: string | null; finalQty: number; userId: string; refType: string; refId: string; reason: string }) {
  const balance = await getOrCreateBalance(tx, params);
  const delta = params.finalQty - balance.qtyPhysical;
  if (delta === 0) return null;
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { qtyPhysical: { increment: delta }, qtyAvailable: { increment: delta } },
  });
  await tx.location.update({ where: { id: params.locationId }, data: { occupiedQty: { increment: delta } } });
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
