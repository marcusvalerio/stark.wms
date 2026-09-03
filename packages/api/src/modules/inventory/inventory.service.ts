import { prisma } from "@/db/prisma";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { AuthUser } from "@/common/auth-middleware";
import * as engine from "@/modules/inventory/inventory.engine";
import { writeAudit } from "@/common/audit";
import { NotFoundError } from "@/common/errors";

export async function listBalances(query: PaginationQuery & { productId?: string; locationId?: string; zoneId?: string; belowMin?: boolean }) {
  const where = {
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.zoneId ? { location: { zoneId: query.zoneId } } : {}),
    ...(query.q
      ? {
          product: {
            OR: [
              { sku: { contains: query.q, mode: "insensitive" as const } },
              { description: { contains: query.q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where,
      include: {
        product: { select: { sku: true, description: true, minStock: true, maxStock: true } },
        location: { select: { fullCode: true, type: true, zoneId: true } },
        lot: { select: { code: true, expiryDate: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
      ...toSkipTake(query),
    }),
    prisma.inventoryBalance.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function productStockSummary(productId: string) {
  const balances = await prisma.inventoryBalance.groupBy({
    by: ["productId"],
    where: { productId },
    _sum: { qtyPhysical: true, qtyAvailable: true, qtyReserved: true, qtyBlocked: true, qtyQuarantine: true },
  });
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Produto", productId);
  const totals = balances[0]?._sum ?? { qtyPhysical: 0, qtyAvailable: 0, qtyReserved: 0, qtyBlocked: 0, qtyQuarantine: 0 };
  return {
    product: { id: product.id, sku: product.sku, description: product.description, minStock: product.minStock, maxStock: product.maxStock },
    totals,
    belowMinimum: (totals.qtyPhysical ?? 0) < product.minStock,
  };
}

export async function listMovements(query: PaginationQuery & { productId?: string; type?: string; refType?: string; refId?: string }) {
  const where = {
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.type ? { type: query.type as never } : {}),
    ...(query.refType ? { refType: query.refType } : {}),
    ...(query.refId ? { refId: query.refId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.movement.findMany({
      where,
      include: {
        product: { select: { sku: true, description: true } },
        lot: { select: { code: true } },
        fromLocation: { select: { fullCode: true } },
        toLocation: { select: { fullCode: true } },
        user: { select: { name: true, matricula: true } },
      },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(query),
    }),
    prisma.movement.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function manualAdjust(actor: AuthUser, input: { productId: string; locationId: string; lotId?: string; finalQty: number; reason: string }) {
  return prisma.$transaction(async (tx) => {
    const movement = await engine.applyCountAdjustment(tx, {
      productId: input.productId,
      locationId: input.locationId,
      lotId: input.lotId,
      finalQty: input.finalQty,
      userId: actor.id,
      refType: "MANUAL_ADJUSTMENT",
      refId: actor.id,
      reason: input.reason,
    });
    await writeAudit(tx, actor, { action: "ADJUST", entityType: "InventoryBalance", entityId: `${input.productId}:${input.locationId}`, newValue: input });
    return movement;
  });
}

export async function blockUnblock(actor: AuthUser, action: "BLOCK" | "UNBLOCK" | "QUARANTINE" | "RELEASE", input: { productId: string; locationId: string; lotId?: string; qty: number; reason: string }) {
  return prisma.$transaction(async (tx) => {
    const params = { productId: input.productId, lotId: input.lotId, qty: input.qty, fromLocationId: input.locationId, userId: actor.id, reason: input.reason, refType: "MANUAL", refId: actor.id, type: "ADJUST" as const };
    let result;
    if (action === "BLOCK") result = await engine.blockStock(tx, params);
    else if (action === "UNBLOCK") result = await engine.unblockStock(tx, params);
    else if (action === "QUARANTINE") result = await engine.quarantineStock(tx, params);
    else result = await engine.releaseFromQuarantine(tx, params);
    await writeAudit(tx, actor, { action, entityType: "InventoryBalance", entityId: `${input.productId}:${input.locationId}`, newValue: input });
    return result;
  });
}
