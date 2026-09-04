import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import * as engine from "@/modules/inventory/inventory.engine";
import * as taskService from "@/modules/tasks/task.service";
import * as orderService from "@/modules/orders/order.service";
import * as pickingService from "@/modules/orders/picking.service";
import { AuthUser } from "@/common/auth-middleware";
import { InsufficientStockError, ConflictError, LocationCapacityError, IncompatibleLocationError } from "@/common/errors";

// Audit sections 3.3/3.4/3.7/3.13 — these tests fire genuinely concurrent
// requests (Promise.all, not sequential awaits) at the real Postgres
// database and assert the *final persisted state*, not just that one call
// "worked". A test that only checks one promise resolved would miss a lost
// update; these check the number that changed.

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

let categoryId: string;
let uomId: string;
let locationAId: string;
let locationBId: string;
let warehouseId: string;
let userA: AuthUser;
let userB: AuthUser;
let userAId: string;
let userBId: string;
let customerId: string;

async function makeProduct(overrides: Partial<{ lotControl: boolean; expiryControl: boolean }> = {}) {
  const sku = `CONC-${uniqueSuffix()}`;
  return prisma.product.create({
    data: {
      sku,
      internalCode: sku,
      description: `Produto de teste de concorrência ${sku}`,
      categoryId,
      baseUomId: uomId,
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      volumeM3: 0.001,
      minStock: 0,
      maxStock: 1000,
      lotControl: overrides.lotControl ?? false,
      expiryControl: overrides.expiryControl ?? false,
    },
  });
}

async function makeBalance(productId: string, locationId: string, qtyAvailable: number, qtyPhysical = qtyAvailable) {
  return prisma.inventoryBalance.create({
    data: { productId, locationId, lotId: null, qtyPhysical, qtyAvailable, qtyReserved: 0, qtyBlocked: 0, qtyQuarantine: 0 },
  });
}

beforeAll(async () => {
  const category = await prisma.category.upsert({
    where: { code: "CONC-TEST" },
    update: {},
    create: { code: "CONC-TEST", name: "Categoria Teste Concorrência" },
  });
  categoryId = category.id;

  const uom = await prisma.unitOfMeasure.upsert({ where: { code: "CONC-UN" }, update: {}, create: { code: "CONC-UN", name: "Unidade Teste", isBase: true } });
  uomId = uom.id;

  const warehouse = await prisma.warehouse.upsert({ where: { code: "CONC-WH" }, update: {}, create: { code: "CONC-WH", name: "Armazém Teste Concorrência" } });
  warehouseId = warehouse.id;
  const zone = await prisma.zone.upsert({
    where: { warehouseId_code: { warehouseId, code: "CZ" } },
    update: {},
    create: { warehouseId, code: "CZ", name: "Zona Teste", type: "RESERVE" },
  });

  const locA = await prisma.location.upsert({
    where: { fullCode: "CZ-CONC-A" },
    update: { capacityQty: 1000, occupiedQty: 0 },
    create: { zoneId: zone.id, aisle: "01", rack: "01", level: "01", position: "A", fullCode: "CZ-CONC-A", type: "RESERVE", capacityQty: 1000, maxWeightKg: 5000, maxVolumeM3: 100 },
  });
  locationAId = locA.id;
  const locB = await prisma.location.upsert({
    where: { fullCode: "CZ-CONC-B" },
    update: { capacityQty: 1000, occupiedQty: 0 },
    create: { zoneId: zone.id, aisle: "01", rack: "01", level: "01", position: "B", fullCode: "CZ-CONC-B", type: "RESERVE", capacityQty: 1000, maxWeightKg: 5000, maxVolumeM3: 100 },
  });
  locationBId = locB.id;

  const role = await prisma.role.upsert({ where: { code: "OPERATOR" }, update: {}, create: { code: "OPERATOR", name: "Operador" } });
  const passwordHash = "x";
  const opA = await prisma.user.upsert({
    where: { email: "conc-operator-a@test.local" },
    update: {},
    create: { matricula: `CA-${uniqueSuffix()}`, name: "Operador Concorrência A", email: "conc-operator-a@test.local", passwordHash, roleId: role.id },
  });
  const opB = await prisma.user.upsert({
    where: { email: "conc-operator-b@test.local" },
    update: {},
    create: { matricula: `CB-${uniqueSuffix()}`, name: "Operador Concorrência B", email: "conc-operator-b@test.local", passwordHash, roleId: role.id },
  });
  userAId = opA.id;
  userBId = opB.id;
  userA = { id: opA.id, matricula: opA.matricula, name: opA.name, email: opA.email, roleCode: "OPERATOR", permissions: ["task.execute", "order.manage", "order.release"], authorizedZones: [] };
  userB = { id: opB.id, matricula: opB.matricula, name: opB.name, email: opB.email, roleCode: "OPERATOR", permissions: ["task.execute", "order.manage", "order.release"], authorizedZones: [] };

  const customer = await prisma.customer.upsert({
    where: { document: "00.000.000/0001-00" },
    update: {},
    create: { code: "CONC-CUST", name: "Cliente Teste Concorrência", document: "00.000.000/0001-00" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Inventory Engine — concurrent reservation cannot oversell (audit P0-1)", () => {
  it("two concurrent reserveStock calls for more than available: exactly one succeeds, balance never goes negative", async () => {
    const product = await makeProduct();
    const balance = await makeBalance(product.id, locationAId, 10);

    const orderForItemA = await prisma.order.create({ data: { number: `CONC-ORD-${uniqueSuffix()}`, customerId, items: { create: [{ productId: product.id, uomId, qtyOrdered: 8 }] } }, include: { items: true } });
    const orderForItemB = await prisma.order.create({ data: { number: `CONC-ORD-${uniqueSuffix()}`, customerId, items: { create: [{ productId: product.id, uomId, qtyOrdered: 8 }] } }, include: { items: true } });

    const attempt = (orderItemId: string) =>
      prisma.$transaction((tx) => engine.reserveStock(tx, { productId: product.id, locationId: locationAId, qty: 8, orderItemId }));

    const results = await Promise.allSettled([attempt(orderForItemA.items[0].id), attempt(orderForItemB.items[0].id)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);

    const finalBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } });
    expect(finalBalance.qtyAvailable).toBe(2); // 10 - 8, never negative, never double-decremented
    expect(finalBalance.qtyReserved).toBe(8);
    expect(finalBalance.qtyAvailable).toBeGreaterThanOrEqual(0);
  });

  it("ten concurrent reserveStock calls of 3 against a balance of 10: at most 3 succeed, balance never negative", async () => {
    const product = await makeProduct();
    const balance = await makeBalance(product.id, locationAId, 10);
    const order = await prisma.order.create({
      data: { number: `CONC-ORD-${uniqueSuffix()}`, customerId, items: { create: Array.from({ length: 10 }, () => ({ productId: product.id, uomId, qtyOrdered: 3 })) } },
      include: { items: true },
    });

    const attempts = order.items.map((item) =>
      prisma.$transaction((tx) => engine.reserveStock(tx, { productId: product.id, locationId: locationAId, qty: 3, orderItemId: item.id }))
    );
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;

    expect(fulfilled).toBeLessThanOrEqual(3);
    const finalBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } });
    expect(finalBalance.qtyAvailable).toBe(10 - fulfilled * 3);
    expect(finalBalance.qtyAvailable).toBeGreaterThanOrEqual(0);
    expect(finalBalance.qtyReserved).toBe(fulfilled * 3);
  });
});

describe("Task Engine — two operators cannot both start the same task (audit P0-2 / 3.4)", () => {
  it("concurrent startTask calls: exactly one wins, the task is not reassigned out from under the winner", async () => {
    const task = await prisma.task.create({ data: { type: "PICKING", refType: "TEST", refId: "test", status: "PENDING" } });

    const results = await Promise.allSettled([taskService.startTask(userA, task.id, userAId), taskService.startTask(userB, task.id, userBId)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const winnerId = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof taskService.startTask>>>).value.assignedToId;
    const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(finalTask.status).toBe("IN_PROGRESS");
    expect(finalTask.assignedToId).toBe(winnerId);
    expect([userAId, userBId]).toContain(finalTask.assignedToId);
  });

  it("cannot complete an already-completed task (audit 3.4 'concluir tarefa duas vezes')", async () => {
    const task = await prisma.task.create({ data: { type: "PICKING", refType: "TEST", refId: "test", status: "IN_PROGRESS", assignedToId: userAId, startedAt: new Date() } });
    await taskService.completeTask(userA, task.id);
    await expect(taskService.completeTask(userA, task.id)).rejects.toThrow();
  });

  it("cannot cancel an already-completed task (audit 3.5 'CONCLUÍDO -> CANCELADO')", async () => {
    const task = await prisma.task.create({ data: { type: "PICKING", refType: "TEST", refId: "test", status: "COMPLETED", completedAt: new Date() } });
    await expect(taskService.cancelTask(userA, task.id, "tentativa indevida")).rejects.toThrow();
  });
});

describe("Location capacity is enforced at write time, not just suggested (audit 3.6 / scenario 9)", () => {
  it("rejects a put-away that would exceed capacityQty", async () => {
    const product = await makeProduct();
    const tightLocation = await prisma.location.create({
      data: { zoneId: (await prisma.zone.findFirstOrThrow({ where: { warehouseId } })).id, aisle: "99", rack: "99", level: "99", position: uniqueSuffix(), fullCode: `CZ-TIGHT-${uniqueSuffix()}`, type: "RESERVE", capacityQty: 5, maxWeightKg: 100, maxVolumeM3: 10 },
    });

    await prisma.$transaction((tx) => engine.increaseAvailable(tx, { type: "PUTAWAY", productId: product.id, qty: 5, toLocationId: tightLocation.id, userId: userAId, refType: "TEST", refId: "t1" }));

    await expect(
      prisma.$transaction((tx) => engine.increaseAvailable(tx, { type: "PUTAWAY", productId: product.id, qty: 1, toLocationId: tightLocation.id, userId: userAId, refType: "TEST", refId: "t2" }))
    ).rejects.toBeInstanceOf(LocationCapacityError);

    const loc = await prisma.location.findUniqueOrThrow({ where: { id: tightLocation.id } });
    expect(loc.occupiedQty).toBe(5); // the rejected attempt must not have partially incremented it
  });

  it("rejects put-away into a location restricted to a different category", async () => {
    const otherCategory = await prisma.category.upsert({ where: { code: "CONC-OTHER" }, update: {}, create: { code: "CONC-OTHER", name: "Outra Categoria" } });
    const restrictedLocation = await prisma.location.create({
      data: {
        zoneId: (await prisma.zone.findFirstOrThrow({ where: { warehouseId } })).id,
        aisle: "98", rack: "98", level: "98", position: uniqueSuffix(), fullCode: `CZ-RESTRICT-${uniqueSuffix()}`,
        type: "RESERVE", capacityQty: 100, maxWeightKg: 1000, maxVolumeM3: 100,
        characteristics: { allowedCategories: [otherCategory.id] },
      },
    });
    const product = await makeProduct(); // belongs to `categoryId`, not `otherCategory.id`

    await expect(
      prisma.$transaction((tx) => engine.increaseAvailable(tx, { type: "PUTAWAY", productId: product.id, qty: 1, toLocationId: restrictedLocation.id, userId: userAId, refType: "TEST", refId: "t1" }))
    ).rejects.toBeInstanceOf(IncompatibleLocationError);
  });
});

describe("Order release cannot be double-submitted into double allocation (audit P0-3)", () => {
  it("concurrent release() calls on the same order: qtyAllocated ends up exactly qtyOrdered, never doubled", async () => {
    const product = await makeProduct();
    await makeBalance(product.id, locationAId, 100);
    const order = await prisma.order.create({
      data: { number: `CONC-ORD-${uniqueSuffix()}`, customerId, items: { create: [{ productId: product.id, uomId, qtyOrdered: 10 }] } },
    });

    const results = await Promise.allSettled([orderService.release(userA, order.id), orderService.release(userB, order.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items[0].qtyAllocated).toBe(10); // not 20
    const reservations = await prisma.inventoryReservation.findMany({ where: { orderItemId: items[0].id, status: "ACTIVE" } });
    const totalReserved = reservations.reduce((s, r) => s + r.qty, 0);
    expect(totalReserved).toBe(10);
  });
});

describe("Picking cannot be double-executed past its suggested quantity (audit P0-4 / 3.4)", () => {
  it("concurrent partial picks that individually look valid but together exceed qtySuggested: only the amount that fits is picked", async () => {
    const product = await makeProduct();
    await makeBalance(product.id, locationAId, 100);
    const order = await prisma.order.create({
      data: { number: `CONC-ORD-${uniqueSuffix()}`, customerId, items: { create: [{ productId: product.id, uomId, qtyOrdered: 10 }] } },
      include: { items: true },
    });
    await orderService.release(userA, order.id);
    await orderService.startPicking(userA, order.id);

    const pickingTask = await prisma.pickingTask.findFirstOrThrow({ where: { orderItemId: order.items[0].id } });
    expect(pickingTask.qtySuggested).toBe(10);

    // Two concurrent picks of 6 each — individually <= remaining (10), but
    // together (12) exceed qtySuggested (10). Exactly one must be rejected
    // or truncated by the atomic guard; qtyPicked must never exceed 10.
    const results = await Promise.allSettled([
      pickingService.executePickingTask(userA, pickingTask.id, 6),
      pickingService.executePickingTask(userB, pickingTask.id, 6),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const finalTask = await prisma.pickingTask.findUniqueOrThrow({ where: { id: pickingTask.id } });
    expect(finalTask.qtyPicked).toBeLessThanOrEqual(10);
    expect(finalTask.qtyPicked).toBe(6);
  });
});
