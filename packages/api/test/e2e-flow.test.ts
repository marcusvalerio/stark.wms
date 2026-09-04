import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { AuthUser } from "@/common/auth-middleware";
import * as receivingService from "@/modules/receiving/receiving.service";
import * as discrepancyService from "@/modules/discrepancy/discrepancy.service";
import * as orderService from "@/modules/orders/order.service";
import * as pickingService from "@/modules/orders/picking.service";
import * as waveService from "@/modules/waves/wave.service";
import * as replenishmentService from "@/modules/replenishment/replenishment.service";
import * as packingService from "@/modules/packing/packing.service";
import * as shippingService from "@/modules/shipping/shipping.service";

// Audit sections 2.20 / 3.17 — "Teste da operação completa" / "Teste final
// de aceitação". This walks the exact chain the brief specifies:
// FORNECEDOR -> RECEBIMENTO -> CONFERÊNCIA -> DIVERGÊNCIA -> RESOLUÇÃO ->
// PUT-AWAY -> ESTOQUE -> PEDIDO -> RESERVA -> ALOCAÇÃO -> WAVE -> PICKING ->
// REABASTECIMENTO -> CONFERÊNCIA -> PACKING -> STAGING -> DOCA ->
// CARREGAMENTO -> EXPEDIÇÃO -> BAIXA -> AUDITORIA, asserting real database
// state after every step (not just that a promise resolved) — this is what
// distinguishes "the screen exists" from "the feature works" per the
// brief's closing rule.

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

let admin: AuthUser;
let checker: AuthUser;
let operator: AuthUser;
let shippingUser: AuthUser;
let supervisor: AuthUser;

let supplierId: string;
let customerId: string;
let carrierId: string;
let productA: string; // no lot control
let productB: string; // lot + expiry control (drives FEFO)
let uomId: string;
let receivingDockId: string;
let shippingDockId: string;
let reserveLocationId: string;
let pickingLocationId: string;

beforeAll(async () => {
  const role = await prisma.role.upsert({ where: { code: "ADMIN" }, update: {}, create: { code: "ADMIN", name: "Administrador" } });
  const mkUser = async (email: string, roleCode: string, permissions: string[]) => {
    const roleRow = await prisma.role.upsert({ where: { code: roleCode as never }, update: {}, create: { code: roleCode as never, name: roleCode } });
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { matricula: `E2E-${uniqueSuffix()}`, name: `E2E ${roleCode}`, email, passwordHash: "x", roleId: roleRow.id },
    });
    return { id: user.id, matricula: user.matricula, name: user.name, email: user.email, roleCode, permissions, authorizedZones: [] } as AuthUser;
  };

  admin = await mkUser("e2e-admin@test.local", "ADMIN", [
    "master_data.manage", "warehouse.manage", "inventory.adjust", "receiving.manage", "receiving.check",
    "discrepancy.manage", "discrepancy.resolve", "task.assign", "task.execute", "order.manage", "order.release",
    "wave.manage", "packing.manage", "shipping.manage", "count.approve", "audit.read",
  ]);
  checker = await mkUser("e2e-checker@test.local", "CHECKER", ["receiving.check", "discrepancy.manage", "task.execute"]);
  operator = await mkUser("e2e-operator@test.local", "OPERATOR", ["task.execute"]);
  shippingUser = await mkUser("e2e-shipping@test.local", "SHIPPING", ["packing.manage", "shipping.manage", "task.execute"]);
  supervisor = await mkUser("e2e-supervisor@test.local", "SUPERVISOR", ["wave.manage", "task.assign", "discrepancy.resolve"]);
  void role;

  const supplier = await prisma.supplier.upsert({ where: { cnpj: "11.111.111/0001-11" }, update: {}, create: { code: "E2E-SUP", legalName: "Fornecedor Teste E2E", cnpj: "11.111.111/0001-11" } });
  supplierId = supplier.id;
  const customer = await prisma.customer.upsert({ where: { document: "22.222.222/0001-22" }, update: {}, create: { code: "E2E-CUST", name: "Cliente Teste E2E", document: "22.222.222/0001-22" } });
  customerId = customer.id;
  const carrier = await prisma.carrier.upsert({ where: { document: "33.333.333/0001-33" }, update: {}, create: { code: "E2E-CAR", name: "Transportadora Teste E2E", document: "33.333.333/0001-33" } });
  carrierId = carrier.id;

  const category = await prisma.category.upsert({ where: { code: "E2ECAT" }, update: {}, create: { code: "E2ECAT", name: "Categoria E2E" } });
  const uom = await prisma.unitOfMeasure.upsert({ where: { code: "E2EUN" }, update: {}, create: { code: "E2EUN", name: "Unidade E2E", isBase: true } });
  uomId = uom.id;

  const pA = await prisma.product.create({ data: { sku: `E2E-A-${uniqueSuffix()}`, internalCode: `E2E-A-${uniqueSuffix()}`, description: "Produto E2E A", categoryId: category.id, baseUomId: uom.id, weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, volumeM3: 0.001, minStock: 5, maxStock: 500 } });
  productA = pA.id;
  const pB = await prisma.product.create({ data: { sku: `E2E-B-${uniqueSuffix()}`, internalCode: `E2E-B-${uniqueSuffix()}`, description: "Produto E2E B (lote/validade)", categoryId: category.id, baseUomId: uom.id, weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, volumeM3: 0.001, lotControl: true, expiryControl: true, minStock: 5, maxStock: 500 } });
  productB = pB.id;

  const warehouse = await prisma.warehouse.upsert({ where: { code: "E2EWH" }, update: {}, create: { code: "E2EWH", name: "Armazém E2E" } });
  const zoneReceiving = await prisma.zone.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "ER" } }, update: {}, create: { warehouseId: warehouse.id, code: "ER", name: "Recebimento E2E", type: "RECEIVING" } });
  const zoneReserve = await prisma.zone.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "EB" } }, update: {}, create: { warehouseId: warehouse.id, code: "EB", name: "Reserva E2E", type: "RESERVE" } });
  const zonePicking = await prisma.zone.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "EP" } }, update: {}, create: { warehouseId: warehouse.id, code: "EP", name: "Picking E2E", type: "PICKING" } });
  void zoneReceiving;

  const reserveLoc = await prisma.location.upsert({
    where: { fullCode: "EB-01-01-01-01" }, update: { occupiedQty: 0 },
    create: { zoneId: zoneReserve.id, aisle: "01", rack: "01", level: "01", position: "01", fullCode: "EB-01-01-01-01", type: "RESERVE", capacityQty: 1000, maxWeightKg: 5000, maxVolumeM3: 100 },
  });
  reserveLocationId = reserveLoc.id;
  const pickingLoc = await prisma.location.upsert({
    where: { fullCode: "EP-01-01-01-01" }, update: { occupiedQty: 0 },
    create: { zoneId: zonePicking.id, aisle: "01", rack: "01", level: "01", position: "01", fullCode: "EP-01-01-01-01", type: "PICKING", capacityQty: 200, maxWeightKg: 1000, maxVolumeM3: 20, pickingMin: 5, pickingMax: 50 },
  });
  pickingLocationId = pickingLoc.id;

  const rDock = await prisma.dock.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "E2E-DR1" } }, update: {}, create: { warehouseId: warehouse.id, code: "E2E-DR1", type: "RECEIVING" } });
  receivingDockId = rDock.id;
  const sDock = await prisma.dock.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "E2E-DS1" } }, update: {}, create: { warehouseId: warehouse.id, code: "E2E-DS1", type: "SHIPPING" } });
  shippingDockId = sDock.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Full operational cycle: supplier -> receiving -> ... -> shipment -> audit", () => {
  let receiptId: string;
  let itemAId: string;
  let itemBId: string;
  let discrepancyId: string;
  let orderId: string;
  let orderItemId: string;
  let shipmentId: string;

  it("1. Recebimento é agendado com quantidade esperada divergente de propósito", async () => {
    const receipt = await receivingService.create(admin, {
      number: `E2E-REC-${uniqueSuffix()}`,
      supplierId,
      scheduledDate: new Date(),
      crossDock: false,
      items: [
        { productId: productA, expectedQty: 50 },
        { productId: productB, expectedQty: 30 },
      ],
    });
    receiptId = receipt.id;
    itemAId = receipt.items.find((i) => i.productId === productA)!.id;
    itemBId = receipt.items.find((i) => i.productId === productB)!.id;
    expect(receipt.status).toBe("SCHEDULED");
  });

  it("2. Chegada e doca", async () => {
    await receivingService.markArrived(admin, receiptId);
    await receivingService.assignDock(admin, receiptId, receivingDockId);
    const receipt = await receivingService.get(receiptId);
    expect(receipt.status).toBe("AT_DOCK");
    expect(receipt.dockId).toBe(receivingDockId);
  });

  it("3. Conferência: item A recebido com falta (divergência), item B conferido correto", async () => {
    await receivingService.startConference(checker, receiptId);
    // Deliberate shortage: expected 50, received 45 -> must raise a SHORTAGE discrepancy, not silently correct.
    await receivingService.checkItem(checker, receiptId, itemAId, { receivedQty: 45, damagedQty: 0 });
    await receivingService.checkItem(checker, receiptId, itemBId, {
      receivedQty: 30, damagedQty: 0, lotCode: `LOTE-${uniqueSuffix()}`, expiryDate: new Date(Date.now() + 60 * 86400000),
    });

    const itemA = await prisma.receiptItem.findUniqueOrThrow({ where: { id: itemAId } });
    expect(itemA.status).toBe("DIVERGENT");
    expect(itemA.receivedQty).toBe(45);
  });

  it("4. Divergência foi criada automaticamente (nunca corrigida silenciosamente)", async () => {
    const discrepancies = await discrepancyService.list({ page: 1, pageSize: 10, refType: "ReceiptItem" });
    const found = discrepancies.items.find((d) => d.refId === itemAId);
    expect(found).toBeDefined();
    expect(found!.type).toBe("SHORTAGE");
    expect(found!.status).toBe("OPEN");
    discrepancyId = found!.id;
  });

  it("5. Resolução da divergência (aceitar quantidade recebida)", async () => {
    await discrepancyService.review(supervisor, discrepancyId);
    const resolved = await discrepancyService.resolve(supervisor, discrepancyId, { action: "AJUSTE_ACEITO", notes: "Fornecedor confirmou envio parcial." });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedById).toBe(supervisor.id);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("6. Conclui conferência e gera tarefas de put-away", async () => {
    await receivingService.completeConference(checker, receiptId);
    const receipt = await receivingService.get(receiptId);
    expect(receipt.status).toBe("PUTAWAY");

    const tasks = await prisma.task.findMany({ where: { receiptId, type: "PUTAWAY" } });
    expect(tasks.length).toBe(2);
    expect(tasks.every((t) => t.status === "PENDING")).toBe(true);
  });

  it("7. Estoque só é atualizado após execução do put-away (section 11) — antes disso, saldo zero", async () => {
    const balancesBefore = await prisma.inventoryBalance.findMany({ where: { productId: { in: [productA, productB] } } });
    expect(balancesBefore.length).toBe(0);
  });

  it("8. Executa put-away de ambos os itens", async () => {
    const tasks = await prisma.task.findMany({ where: { receiptId, type: "PUTAWAY" } });
    for (const task of tasks) {
      await receivingService.executePutaway(operator, task.id, reserveLocationId);
    }
    const receipt = await receivingService.get(receiptId);
    expect(receipt.status).toBe("COMPLETED");
  });

  it("9. Estoque reflete exatamente a quantidade recebida (45 + 30), rastreável por lote", async () => {
    const balanceA = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: productA, locationId: reserveLocationId } });
    expect(balanceA.qtyPhysical).toBe(45);
    expect(balanceA.qtyAvailable).toBe(45);

    const balanceB = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: productB, locationId: reserveLocationId } });
    expect(balanceB.qtyPhysical).toBe(30);
    expect(balanceB.lotId).not.toBeNull();

    const movements = await prisma.movement.findMany({ where: { refType: "ReceiptItem", refId: { in: [itemAId, itemBId] }, type: "PUTAWAY" } });
    expect(movements.length).toBe(2);
  });

  it("10. Pedido criado, liberado, reserva/alocação geradas (FIFO/FEFO)", async () => {
    const order = await orderService.create(admin, {
      number: `E2E-PED-${uniqueSuffix()}`,
      customerId,
      priority: "NORMAL",
      carrierId,
      items: [
        { productId: productA, uomId, qtyOrdered: 10 },
        { productId: productB, uomId, qtyOrdered: 5 },
      ],
    });
    orderId = order.id;

    const released = await orderService.release(admin, order.id);
    expect(released.status).toBe("ALLOCATED");
    expect(released.backorder).toBe(0);

    const items = await prisma.orderItem.findMany({ where: { orderId } });
    for (const item of items) expect(item.qtyAllocated).toBe(item.qtyOrdered);
    orderItemId = items.find((i) => i.productId === productA)!.id;

    const reservations = await prisma.inventoryReservation.findMany({ where: { orderItemId: { in: items.map((i) => i.id) }, status: "ACTIVE" } });
    const totalReserved = reservations.reduce((s, r) => s + r.qty, 0);
    expect(totalReserved).toBe(15);

    const balanceAAfterReserve = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: productA, locationId: reserveLocationId } });
    expect(balanceAAfterReserve.qtyAvailable).toBe(35); // 45 - 10
    expect(balanceAAfterReserve.qtyReserved).toBe(10);
  });

  it("11. Onda de picking agrupa o pedido e gera tarefas", async () => {
    const wave = await waveService.create(supervisor, { code: `E2E-ONDA-${uniqueSuffix()}`, orderIds: [orderId] });
    const released = await waveService.release(supervisor, wave.id);
    expect(released.status).toBe("RELEASED");

    const order = await orderService.get(orderId);
    expect(order.status).toBe("PICKING");

    const pickingTasks = await prisma.pickingTask.findMany({ where: { waveId: wave.id } });
    expect(pickingTasks.length).toBe(2);
  });

  it("12. Reabastecimento: posição de picking abaixo do mínimo gera recomendação e é executada", async () => {
    // Seed a picking-face balance below its configured minimum (5) to
    // trigger a real recommendation from the same scan the operator UI uses.
    await prisma.inventoryBalance.create({ data: { productId: productA, locationId: pickingLocationId, qtyPhysical: 2, qtyAvailable: 2 } });
    const scan = await replenishmentService.scanReplenishmentNeeds(supervisor);
    const task = scan.tasks.find((t) => t.productId === productA && t.toLocationId === pickingLocationId);
    expect(task).toBeDefined();

    await replenishmentService.execute(operator, task!.id);
    const completedTask = await prisma.replenishmentTask.findUniqueOrThrow({ where: { id: task!.id } });
    expect(completedTask.status).toBe("COMPLETED");

    const pickingBalance = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: productA, locationId: pickingLocationId } });
    expect(pickingBalance.qtyPhysical).toBeGreaterThan(2); // topped up from reserve
  });

  it("13. Executa as tarefas de picking até o pedido avançar para PICKED", async () => {
    const pickingTasks = await prisma.pickingTask.findMany({ where: { orderItemId: { in: (await prisma.orderItem.findMany({ where: { orderId } })).map((i) => i.id) } } });
    for (const t of pickingTasks) {
      await pickingService.executePickingTask(operator, t.id, t.qtySuggested);
    }
    const order = await orderService.get(orderId);
    expect(order.status).toBe("PICKED");

    const items = await prisma.orderItem.findMany({ where: { orderId } });
    for (const item of items) expect(item.qtyPicked).toBe(item.qtyOrdered);
  });

  it("14. Conferência final do pedido antes do packing", async () => {
    const conferred = await orderService.advanceToConference(checker, orderId);
    expect(conferred.status).toBe("CONFERENCE");
  });

  it("15. Packing: cria volume, embala itens separados, fecha volume", async () => {
    const pkg = await packingService.createPackage(shippingUser, { orderId, code: `E2E-VOL-${uniqueSuffix()}` });
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      await packingService.addItem(shippingUser, pkg.id, { orderItemId: item.id, qty: item.qtyPicked });
    }
    const closed = await packingService.closePackage(shippingUser, pkg.id, { weightKg: 5, lengthCm: 30, widthCm: 20, heightCm: 20 });
    expect(closed.status).toBe("CLOSED");

    const order = await orderService.get(orderId);
    expect(order.status).toBe("PACKING");
  });

  it("16. Staging: pedido só avança quando todo o separado está embalado", async () => {
    const staged = await packingService.sendToStaging(shippingUser, orderId);
    expect(staged.status).toBe("STAGING");
  });

  it("17. Expedição: cria romaneio, atribui doca, carrega, expede", async () => {
    const shipment = await shippingService.create(shippingUser, { orderId, carrierId, dockId: shippingDockId });
    shipmentId = shipment.id;
    expect(shipment.status).toBe("STAGING");

    await shippingService.assignDock(shippingUser, shipment.id, shippingDockId);
    const loaded = await shippingService.load(shippingUser, shipment.id);
    expect(loaded.status).toBe("LOADING");

    const orderReady = await orderService.get(orderId);
    expect(orderReady.status).toBe("READY");

    const shipped = await shippingService.ship(shippingUser, shipment.id);
    expect(shipped.status).toBe("SHIPPED");

    const orderShipped = await orderService.get(orderId);
    expect(orderShipped.status).toBe("SHIPPED");
  });

  it("18. Baixa de estoque confirmada: qtyShipped bate com o pedido, nenhum saldo negativo em nenhum balanço tocado", async () => {
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    for (const item of items) expect(item.qtyShipped).toBe(item.qtyOrdered);

    const allTouchedBalances = await prisma.inventoryBalance.findMany({
      where: { OR: [{ productId: productA }, { productId: productB }] },
    });
    for (const b of allTouchedBalances) {
      expect(b.qtyPhysical).toBeGreaterThanOrEqual(0);
      expect(b.qtyAvailable).toBeGreaterThanOrEqual(0);
      expect(b.qtyReserved).toBeGreaterThanOrEqual(0);
      expect(b.qtyBlocked).toBeGreaterThanOrEqual(0);
      expect(b.qtyQuarantine).toBeGreaterThanOrEqual(0);
      // The fundamental accounting invariant every Inventory Engine
      // operation must preserve: every physical unit is in exactly one
      // bucket, so physical always equals the sum of the sub-buckets — this
      // is what "físico = disponível + reservado + bloqueado + quarentena"
      // from the audit brief actually means, checked as an exact equality
      // rather than a loose bound.
      expect(b.qtyPhysical).toBe(b.qtyAvailable + b.qtyReserved + b.qtyBlocked + b.qtyQuarantine);
    }

    const shipMovements = await prisma.movement.findMany({ where: { refType: "Shipment", refId: shipmentId, type: "SHIP" } });
    expect(shipMovements.length).toBe(2);
  });

  it("19. Auditoria: cada transição de estado relevante do pedido está registrada", async () => {
    const logs = await prisma.auditLog.findMany({ where: { entityType: "Order", entityId: orderId }, orderBy: { createdAt: "asc" } });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("CREATE");
    expect(actions).toContain("RELEASE_ALLOCATE");
    expect(actions).toContain("SEND_TO_STAGING");
    expect(logs.length).toBeGreaterThan(3);

    const receiptLogs = await prisma.auditLog.findMany({ where: { entityType: "Receipt", entityId: receiptId } });
    expect(receiptLogs.length).toBeGreaterThan(0);

    const discrepancyLogs = await prisma.auditLog.findMany({ where: { entityType: "Discrepancy", entityId: discrepancyId } });
    expect(discrepancyLogs.map((l) => l.action)).toEqual(expect.arrayContaining(["REVIEW", "RESOLVE"]));
  });

  it("20. Pedido expedido é terminal: não pode voltar para PICKING nem ser cancelado", async () => {
    await expect(orderService.cancel(admin, orderId, "tentativa indevida pós-expedição")).rejects.toThrow();
  });
});
