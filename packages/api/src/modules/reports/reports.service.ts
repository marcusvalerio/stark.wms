import { prisma } from "@/db/prisma";

export async function occupancyReport() {
  const zones = await prisma.zone.findMany({
    include: { locations: { select: { capacityQty: true, occupiedQty: true, type: true, status: true } }, warehouse: { select: { code: true } } },
  });
  return zones.map((z) => {
    const capacity = z.locations.reduce((s, l) => s + l.capacityQty, 0);
    const occupied = z.locations.reduce((s, l) => s + l.occupiedQty, 0);
    return {
      zoneId: z.id,
      warehouse: z.warehouse.code,
      code: z.code,
      name: z.name,
      type: z.type,
      locations: z.locations.length,
      capacity,
      occupied,
      occupancyPct: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0,
    };
  });
}

export async function accuracyReport() {
  const items = await prisma.inventoryCountItem.findMany({
    where: { status: "ADJUSTED", finalQty: { not: null } },
    select: { systemQty: true, finalQty: true, count: { select: { code: true, closedAt: true } } },
  });
  const total = items.length;
  const accurate = items.filter((i) => i.systemQty === i.finalQty).length;
  return {
    countedItems: total,
    accurateItems: accurate,
    accuracyPct: total > 0 ? Math.round((accurate / total) * 10000) / 100 : 100,
  };
}

export async function productivityReport() {
  const operators = await prisma.user.findMany({
    where: { role: { code: { in: ["OPERATOR", "CHECKER", "SHIPPING"] } } },
    select: {
      id: true,
      name: true,
      matricula: true,
      _count: { select: { assignedTasks: { where: { status: "COMPLETED" } } } },
    },
  });
  return operators
    .map((o) => ({ id: o.id, name: o.name, matricula: o.matricula, tasksCompleted: o._count.assignedTasks }))
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted);
}

export async function discrepancyReport() {
  const byType = await prisma.discrepancy.groupBy({ by: ["type", "status"], _count: true });
  return byType.map((d) => ({ type: d.type, status: d.status, count: d._count }));
}
