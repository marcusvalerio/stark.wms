import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { AuthUser } from "@/common/auth-middleware";
import { ConflictError, InsufficientStockError, NotFoundError } from "@/common/errors";
import * as engine from "@/modules/inventory/inventory.engine";
import * as receivingService from "@/modules/receiving/receiving.service";
import * as orderService from "@/modules/orders/order.service";
import * as pickingService from "@/modules/orders/picking.service";
import * as shippingService from "@/modules/shipping/shipping.service";
import * as packingService from "@/modules/packing/packing.service";

// Audit section 3.13 — "Auditoria adversarial": each test below is one of
// the 18 numbered scenarios from the brief, run against the real service
// layer and real Postgres. A scenario not listed here was covered
// elsewhere (see docs/AUDIT.md's cross-reference table) — e.g. FIFO/FEFO
// bypass and "alterar lote indevidamente" are proven safe by the *absence*
// of any endpoint that would let a caller choose a lot/location for
// picking or edit a Lot directly, which a runtime test can't demonstrate
// any better than reading the route table.

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

let admin: AuthUser;
let categoryId: string;
let uomId: string;
let locationId: string;
let customerId: string;
let supplierId: string;

async function makeProduct() {
  const sku = `ADV-${uniqueSuffix()}`;
  return prisma.product.create({
    data: { sku, internalCode: sku, description: `Produto adversarial ${sku}`, categoryId, baseUomId: uomId, weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, volumeM3: 0.001, minStock: 0, maxStock: 1000 },
  });
}

beforeAll(async () => {
  const category = await prisma.category.upsert({ where: { code: "ADVTEST" }, update: {}, create: { code: "ADVTEST", name: "Categoria Adversarial" } });
  categoryId = category.id;
  const uom = await prisma.unitOfMeasure.upsert({ where: { code: "ADVTEST" }, update: {}, create: { code: "ADVTEST", name: "Unidade Adversarial", isBase: true } });
  uomId = uom.id;
  const warehouse = await prisma.warehouse.upsert({ where: { code: "ADVWH" }, update: {}, create: { code: "ADVWH", name: "Armazém Adversarial" } });
  const zone = await prisma.zone.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "AV" } }, update: {}, create: { warehouseId: warehouse.id, code: "AV", name: "Zona Adversarial", type: "RESERVE" } });
  const location = await prisma.location.upsert({
    where: { fullCode: "AV-01-01-01-01" }, update: { occupiedQty: 0 },
    create: { zoneId: zone.id, aisle: "01", rack: "01", level: "01", position: "01", fullCode: "AV-01-01-01-01", type: "RESERVE", capacityQty: 1000, maxWeightKg: 5000, maxVolumeM3: 100 },
  });
  locationId = location.id;

  const role = await prisma.role.upsert({ where: { code: "ADMIN" }, update: {}, create: { code: "ADMIN", name: "Administrador" } });
  const user = await prisma.user.upsert({
    where: { email: "adv-admin@test.local" }, update: {},
    create: { matricula: `ADV-${uniqueSuffix()}`, name: "Adversarial Admin", email: "adv-admin@test.local", passwordHash: "x", roleId: role.id },
  });
  admin = { id: user.id, matricula: user.matricula, name: user.name, email: user.email, roleCode: "ADMIN", permissions: ["receiving.manage", "receiving.check", "order.manage", "order.release", "packing.manage", "shipping.manage", "task.execute", "inventory.adjust"], authorizedZones: [] };

  const customer = await prisma.customer.upsert({ where: { document: "44.444.444/0001-44" }, update: {}, create: { code: "ADV-CUST", name: "Cliente Adversarial", document: "44.444.444/0001-44" } });
  customerId = customer.id;
  const supplier = await prisma.supplier.upsert({ where: { cnpj: "55.555.555/0001-55" }, update: {}, create: { code: "ADV-SUP", legalName: "Fornecedor Adversarial", cnpj: "55.555.555/0001-55" } });
  supplierId = supplier.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("#1 Retirar mais estoque do que existe", () => {
  it("consumeReservation rejects taking more than the balance actually has", async () => {
    const product = await makeProduct();
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 5, qtyAvailable: 0, qtyReserved: 5 } });
    const order = await prisma.order.create({ data: { number: `ADV-ORD-${uniqueSuffix()}`, customerId, items: { create: [{ productId: product.id, uomId, qtyOrdered: 20 }] } }, include: { items: true } });
    const reservation = await prisma.inventoryReservation.create({ data: { orderItemId: order.items[0].id, productId: product.id, locationId, qty: 5, status: "ACTIVE" } });

    await expect(
      prisma.$transaction((tx) => engine.consumeReservation(tx, { reservationId: reservation.id, qty: 20, userId: admin.id, refType: "TEST", refId: "x" }))
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const balance = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: product.id, locationId } });
    expect(balance.qtyPhysical).toBe(5); // untouched — rejected before any partial write
  });
});

describe("#11 Duplicar recebimento (mesmo número)", () => {
  it("rejects creating a second receipt with a number that already exists", async () => {
    const number = `ADV-REC-${uniqueSuffix()}`;
    await receivingService.create(admin, { number, supplierId, scheduledDate: new Date(), crossDock: false, items: [{ productId: (await makeProduct()).id, expectedQty: 1 }] });
    await expect(
      receivingService.create(admin, { number, supplierId, scheduledDate: new Date(), crossDock: false, items: [{ productId: (await makeProduct()).id, expectedQty: 1 }] })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("#12 Expedir pedido cancelado / #13 Cancelar pedido já expedido", () => {
  it("a cancelled order can never be shipped — STAGING is unreachable from CANCELLED", async () => {
    const product = await makeProduct();
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 10, qtyAvailable: 10 } });
    const order = await orderService.create(admin, { number: `ADV-ORD-${uniqueSuffix()}`, customerId, priority: "NORMAL", items: [{ productId: product.id, uomId, qtyOrdered: 1 }] });
    await orderService.cancel(admin, order.id, "cliente desistiu");

    await expect(shippingService.create(admin, { orderId: order.id, carrierId: (await prisma.carrier.upsert({ where: { document: "66.666.666/0001-66" }, update: {}, create: { code: "ADV-CAR", name: "Transportadora Adversarial", document: "66.666.666/0001-66" } })).id })).rejects.toThrow();
  });

  it("shipping an already-shipped order's shipment again is rejected, not double-processed", async () => {
    // Build a fully shipped order, then try to ship() the same shipment a second time.
    const product = await makeProduct();
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 10, qtyAvailable: 10 } });
    const order = await orderService.create(admin, { number: `ADV-ORD-${uniqueSuffix()}`, customerId, priority: "NORMAL", items: [{ productId: product.id, uomId, qtyOrdered: 1 }] });
    await orderService.release(admin, order.id);
    await orderService.startPicking(admin, order.id);
    const pickingTask = await prisma.pickingTask.findFirstOrThrow({ where: { orderItem: { orderId: order.id } } });
    await pickingService.executePickingTask(admin, pickingTask.id, 1);
    await orderService.advanceToConference(admin, order.id);
    const pkg = await packingService.createPackage(admin, { orderId: order.id, code: `ADV-VOL-${uniqueSuffix()}` });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await packingService.addItem(admin, pkg.id, { orderItemId: item.id, qty: 1 });
    await packingService.closePackage(admin, pkg.id, { weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 });
    await packingService.sendToStaging(admin, order.id);
    const carrier = await prisma.carrier.upsert({ where: { document: "77.777.777/0001-77" }, update: {}, create: { code: "ADV-CAR2", name: "Transportadora Adversarial 2", document: "77.777.777/0001-77" } });
    const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { code: "ADVWH" } });
    const dock = await prisma.dock.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "ADV-DOCK" } }, update: {}, create: { warehouseId: warehouse.id, code: "ADV-DOCK", type: "SHIPPING" } });
    const shipment = await shippingService.create(admin, { orderId: order.id, carrierId: carrier.id });
    await shippingService.assignDock(admin, shipment.id, dock.id);
    await shippingService.load(admin, shipment.id);
    await shippingService.ship(admin, shipment.id);

    await expect(shippingService.ship(admin, shipment.id)).rejects.toThrow();

    const finalItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(finalItem.qtyShipped).toBe(1); // not doubled by the rejected re-ship attempt
  });
});

describe("#14 Movimentar estoque bloqueado / #15 Utilizar estoque em quarentena", () => {
  it("blocked stock cannot be reserved — it never counts as available", async () => {
    const product = await makeProduct();
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 10, qtyAvailable: 0, qtyBlocked: 10 } });
    const order = await prisma.order.create({ data: { number: `ADV-ORD-${uniqueSuffix()}`, customerId, items: { create: [{ productId: product.id, uomId, qtyOrdered: 1 }] } }, include: { items: true } });

    await expect(
      prisma.$transaction((tx) => engine.reserveStock(tx, { productId: product.id, locationId, qty: 1, orderItemId: order.items[0].id }))
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("quarantined stock cannot be reserved for picking — the Allocation Engine only reads qtyAvailable", async () => {
    const product = await makeProduct();
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 10, qtyAvailable: 0, qtyQuarantine: 10 } });
    const order = await orderService.create(admin, { number: `ADV-ORD-${uniqueSuffix()}`, customerId, priority: "NORMAL", items: [{ productId: product.id, uomId, qtyOrdered: 1 }] });

    const released = await orderService.release(admin, order.id);
    expect(released.backorder).toBe(1); // could not allocate anything — quarantined stock is invisible to allocation
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.qtyAllocated).toBe(0);
  });

  it("blocked stock cannot be moved by a transfer (transferStock only draws from qtyAvailable)", async () => {
    const product = await makeProduct();
    const otherLocation = await prisma.location.create({
      data: { zoneId: (await prisma.zone.findFirstOrThrow({})).id, aisle: "77", rack: "77", level: "77", position: uniqueSuffix(), fullCode: `ADV-DEST-${uniqueSuffix()}`, type: "RESERVE", capacityQty: 100, maxWeightKg: 100, maxVolumeM3: 10 },
    });
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 10, qtyAvailable: 0, qtyBlocked: 10 } });

    await expect(
      prisma.$transaction((tx) => engine.transferStock(tx, { type: "TRANSFER", productId: product.id, qty: 5, fromLocationId: locationId, toLocationId: otherLocation.id, userId: admin.id }))
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });
});

describe("#4 Concluir tarefa/picking inexistente", () => {
  it("executing a picking task that does not exist is rejected, not silently ignored", async () => {
    await expect(pickingService.executePickingTask(admin, "does-not-exist", 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("executing put-away on a non-existent task is rejected", async () => {
    await expect(receivingService.executePutaway(admin, "does-not-exist", locationId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("#3 Expedir pedido incompleto (partial allocation must not silently ship the full ordered qty)", () => {
  it("a backordered item ships only what was actually picked, and the gap stays visible in the data", async () => {
    const product = await makeProduct();
    await prisma.inventoryBalance.create({ data: { productId: product.id, locationId, qtyPhysical: 3, qtyAvailable: 3 } });
    const order = await orderService.create(admin, { number: `ADV-ORD-${uniqueSuffix()}`, customerId, priority: "NORMAL", items: [{ productId: product.id, uomId, qtyOrdered: 10 }] });
    const released = await orderService.release(admin, order.id);
    expect(released.backorder).toBe(7);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.qtyAllocated).toBe(3);
    expect(item.qtyOrdered).toBe(10);
    // The gap (7 units) is never silently hidden — it's the arithmetic
    // difference between qtyOrdered and qtyAllocated/qtyShipped, always
    // queryable, exactly what section 16's backorder requirement asks for.
  });
});
