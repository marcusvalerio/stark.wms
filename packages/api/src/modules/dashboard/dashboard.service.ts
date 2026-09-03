import { prisma } from "@/db/prisma";

// Section 29: real operational snapshot, not decorative charts.
export async function operationalSnapshot() {
  const [
    receiptsByStatus,
    ordersByStatus,
    tasksByStatus,
    openDiscrepancies,
    activeCounts,
    shipmentsToday,
    locations,
    lowStockProducts,
  ] = await Promise.all([
    prisma.receipt.groupBy({ by: ["status"], _count: true }),
    prisma.order.groupBy({ by: ["status"], _count: true }),
    prisma.task.groupBy({ by: ["status", "type"], _count: true }),
    prisma.discrepancy.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.inventoryCount.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.shipment.count({ where: { status: "SHIPPED", shippedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.location.aggregate({ _sum: { capacityQty: true, occupiedQty: true } }),
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint as count FROM (
         SELECT p.id, p."minStock", COALESCE(SUM(b."qtyPhysical"),0) as total
         FROM "Product" p LEFT JOIN "InventoryBalance" b ON b."productId" = p.id
         WHERE p.status = 'ACTIVE' AND p."minStock" > 0
         GROUP BY p.id, p."minStock"
         HAVING COALESCE(SUM(b."qtyPhysical"),0) < p."minStock"
       ) sub`
    ),
  ]);

  const occupancyPct = locations._sum.capacityQty
    ? Math.round(((locations._sum.occupiedQty ?? 0) / locations._sum.capacityQty!) * 100)
    : 0;

  return {
    receiving: Object.fromEntries(receiptsByStatus.map((r) => [r.status, r._count])),
    orders: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count])),
    tasks: tasksByStatus.map((t) => ({ type: t.type, status: t.status, count: t._count })),
    discrepanciesOpen: openDiscrepancies,
    countsInProgress: activeCounts,
    shipmentsToday,
    warehouseOccupancyPct: occupancyPct,
    productsBelowMinimum: Number(lowStockProducts[0]?.count ?? 0),
    generatedAt: new Date().toISOString(),
  };
}

// Section 30: Control Tower — bottlenecks, delayed tasks, occupied docks,
// critical orders, operators, so a manager can jump straight into what
// needs attention.
export async function controlTower() {
  const now = new Date();

  const [delayedTasks, occupiedDocks, criticalOrders, operators, openDiscrepancies, pendingByType] = await Promise.all([
    prisma.task.findMany({
      where: { status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] }, slaDueAt: { lt: now } },
      include: { assignedTo: { select: { name: true } }, product: { select: { sku: true } } },
      orderBy: { slaDueAt: "asc" },
      take: 25,
    }),
    prisma.dock.findMany({
      include: {
        receipts: { where: { status: { in: ["AT_DOCK", "IN_CONFERENCE"] } }, select: { id: true, number: true } },
        shipments: { where: { status: { in: ["DOCK", "LOADING"] } }, select: { id: true, romaneioNumber: true } },
      },
    }),
    prisma.order.findMany({
      where: { priority: { in: ["CRITICAL", "HIGH"] }, status: { notIn: ["SHIPPED", "CANCELLED"] } },
      include: { customer: { select: { name: true } } },
      orderBy: { slaDueAt: "asc" },
      take: 25,
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE", role: { code: { in: ["OPERATOR", "CHECKER", "SHIPPING"] } } },
      select: {
        id: true,
        name: true,
        operatorStatus: true,
        shift: true,
        _count: { select: { assignedTasks: { where: { status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } } } } },
      },
    }),
    prisma.discrepancy.count({ where: { status: "OPEN" } }),
    prisma.task.groupBy({ by: ["type"], where: { status: "PENDING" }, _count: true }),
  ]);

  const occupiedDockList = occupiedDocks
    .filter((d) => d.receipts.length > 0 || d.shipments.length > 0)
    .map((d) => ({ dockId: d.id, code: d.code, type: d.type, receipts: d.receipts.map((r) => r.number), shipments: d.shipments.map((s) => s.romaneioNumber) }));

  const alerts: { level: "CRITICAL" | "HIGH" | "NORMAL"; message: string }[] = [];
  if (delayedTasks.length > 0) alerts.push({ level: "CRITICAL", message: `${delayedTasks.length} tarefa(s) atrasada(s) além do SLA.` });
  if (openDiscrepancies > 0) alerts.push({ level: "HIGH", message: `${openDiscrepancies} divergência(s) aberta(s) aguardando análise.` });
  const idleOperators = operators.filter((o) => o.operatorStatus === "AVAILABLE" && o._count.assignedTasks === 0).length;
  const backlog = pendingByType.reduce((sum, p) => sum + p._count, 0);
  if (backlog > idleOperators * 5 && idleOperators >= 0) {
    alerts.push({ level: "NORMAL", message: `Backlog de ${backlog} tarefa(s) pendente(s) para ${idleOperators} operador(es) disponível(is).` });
  }

  return {
    delayedTasks: delayedTasks.map((t) => ({ id: t.id, type: t.type, priority: t.priority, slaDueAt: t.slaDueAt, assignedTo: t.assignedTo?.name ?? null, product: t.product?.sku ?? null })),
    occupiedDocks: occupiedDockList,
    criticalOrders: criticalOrders.map((o) => ({ id: o.id, number: o.number, priority: o.priority, status: o.status, slaDueAt: o.slaDueAt, customer: o.customer.name })),
    operators: operators.map((o) => ({ id: o.id, name: o.name, status: o.operatorStatus, shift: o.shift, activeTasks: o._count.assignedTasks })),
    pendingTasksByType: pendingByType.map((p) => ({ type: p.type, count: p._count })),
    alerts,
    generatedAt: new Date().toISOString(),
  };
}
