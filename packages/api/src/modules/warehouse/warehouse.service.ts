import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { dockSchema, locationSchema, warehouseSchema, zoneSchema } from "@/modules/warehouse/warehouse.schema";

// --- Warehouses -------------------------------------------------------

export async function listWarehouses() {
  return prisma.warehouse.findMany({ orderBy: { code: "asc" }, include: { zones: true, docks: true } });
}

export async function createWarehouse(actor: AuthUser, data: z.infer<typeof warehouseSchema>) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.warehouse.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Warehouse", entityId: created.id, newValue: data });
    return created;
  });
}

// --- Zones ----------------------------------------------------------------

export async function listZones(warehouseId?: string) {
  return prisma.zone.findMany({ where: warehouseId ? { warehouseId } : {}, orderBy: { code: "asc" }, include: { _count: { select: { locations: true } } } });
}

export async function createZone(actor: AuthUser, data: z.infer<typeof zoneSchema>) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.zone.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Zone", entityId: created.id, newValue: data });
    return created;
  });
}

// --- Locations --------------------------------------------------------

export async function listLocations(query: PaginationQuery & { zoneId?: string; type?: string; status?: string }) {
  const where = {
    ...(query.zoneId ? { zoneId: query.zoneId } : {}),
    ...(query.type ? { type: query.type as never } : {}),
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.q ? { fullCode: { contains: query.q, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.location.findMany({ where, include: { zone: true }, orderBy: { fullCode: "asc" }, ...toSkipTake(query) }),
    prisma.location.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function getLocationDetail(id: string) {
  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      zone: { include: { warehouse: true } },
      balances: { include: { product: true, lot: true } },
    },
  });
  if (!location) throw new NotFoundError("Localização", id);

  const openTasks = await prisma.task.findMany({
    where: { OR: [{ originLocationId: id }, { destLocationId: id }], status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } },
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  return { ...location, openTasks };
}

export async function createLocation(actor: AuthUser, data: z.infer<typeof locationSchema>) {
  const zone = await prisma.zone.findUnique({ where: { id: data.zoneId }, include: { warehouse: true } });
  if (!zone) throw new NotFoundError("Área", data.zoneId);
  const fullCode = `${zone.code}-${data.aisle}-${data.rack}-${data.level}-${data.position}`;
  const dup = await prisma.location.findUnique({ where: { fullCode } });
  if (dup) throw new ConflictError(`Endereço já existe: ${fullCode}`);

  return prisma.$transaction(async (tx) => {
    const created = await tx.location.create({ data: { ...data, fullCode } });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Location", entityId: created.id, newValue: { fullCode } });
    return created;
  });
}

export async function updateLocation(actor: AuthUser, id: string, data: Partial<z.infer<typeof locationSchema>>) {
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Localização", id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.location.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "UPDATE", entityType: "Location", entityId: id, previousValue: { status: existing.status }, newValue: { status: updated.status } });
    return updated;
  });
}

// --- Docks ----------------------------------------------------------------

export async function listDocks(warehouseId?: string) {
  return prisma.dock.findMany({ where: warehouseId ? { warehouseId } : {}, orderBy: { code: "asc" } });
}

export async function createDock(actor: AuthUser, data: z.infer<typeof dockSchema>) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.dock.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Dock", entityId: created.id, newValue: data });
    return created;
  });
}

// --- Map --------------------------------------------------------------

export async function warehouseMap(warehouseId: string) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    include: {
      zones: {
        include: {
          locations: {
            select: { id: true, fullCode: true, type: true, status: true, capacityQty: true, occupiedQty: true, aisle: true, rack: true, level: true, position: true },
          },
        },
      },
    },
  });
  if (!warehouse) throw new NotFoundError("Armazém", warehouseId);

  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    zones: warehouse.zones.map((zone) => ({
      id: zone.id,
      code: zone.code,
      name: zone.name,
      type: zone.type,
      locations: zone.locations.map((loc) => ({
        ...loc,
        occupancyPct: loc.capacityQty > 0 ? Math.round((loc.occupiedQty / loc.capacityQty) * 100) : 0,
      })),
    })),
  };
}
