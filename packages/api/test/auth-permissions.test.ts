import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "@/app";
import { prisma } from "@/db/prisma";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from "@/common/permissions";

// Audit section 3.8/3.9: authorization must be enforced by the backend
// itself, not by the frontend hiding a button. These tests hit the real
// Express app (in-process, via supertest) with real JWTs issued by the real
// login endpoint for users of each role, and check the HTTP status code —
// not internal function behavior — because that's what actually protects
// the system from a client that skips the UI and calls the API directly.

const app = createApp();

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const tokens: Record<string, string> = {};
let productId: string;
let locationId: string;

beforeAll(async () => {
  // Self-sufficient: seeds real Permission + RolePermission rows itself
  // rather than assuming prisma/seed.ts already ran, so this test proves
  // what the permission matrix in common/permissions.ts actually enforces
  // end-to-end, independent of demo-data state.
  const permissionRows = await Promise.all(ALL_PERMISSIONS.map((p) => prisma.permission.upsert({ where: { code: p.code }, update: {}, create: p })));
  const permissionByCode = new Map(permissionRows.map((p) => [p.code, p]));

  const passwordHash = await bcrypt.hash("test-pass-123", 10);
  for (const roleCode of Object.keys(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({ where: { code: roleCode as never }, update: {}, create: { code: roleCode as never, name: roleCode } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSIONS[roleCode].map((code) => ({ roleId: role.id, permissionId: permissionByCode.get(code)!.id })),
    });
    const email = `auth-test-${roleCode.toLowerCase()}@test.local`;
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, status: "ACTIVE" },
      create: { matricula: `AT-${roleCode}-${uniqueSuffix()}`, name: `Auth Test ${roleCode}`, email, passwordHash, roleId: role.id },
    });
    const res = await request(app).post("/api/auth/login").send({ email, password: "test-pass-123" });
    if (res.status !== 200) throw new Error(`Setup failed to log in ${roleCode}: ${res.status} ${JSON.stringify(res.body)}`);
    tokens[roleCode] = res.body.token;
  }

  const category = await prisma.category.upsert({ where: { code: "AUTHTEST" }, update: {}, create: { code: "AUTHTEST", name: "Auth Test Category" } });
  const uom = await prisma.unitOfMeasure.upsert({ where: { code: "AUTHTEST" }, update: {}, create: { code: "AUTHTEST", name: "Auth Test Uom", isBase: true } });
  const product = await prisma.product.create({
    data: { sku: `AUTH-${uniqueSuffix()}`, internalCode: `AUTH-${uniqueSuffix()}`, description: "Produto teste auth", categoryId: category.id, baseUomId: uom.id, weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, volumeM3: 0.001 },
  });
  productId = product.id;

  const warehouse = await prisma.warehouse.upsert({ where: { code: "AUTHWH" }, update: {}, create: { code: "AUTHWH", name: "Auth Test WH" } });
  const zone = await prisma.zone.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: "AZ" } }, update: {}, create: { warehouseId: warehouse.id, code: "AZ", name: "Auth Zone", type: "RESERVE" } });
  const location = await prisma.location.upsert({
    where: { fullCode: "AZ-AUTH-01" },
    update: {},
    create: { zoneId: zone.id, aisle: "01", rack: "01", level: "01", position: "01", fullCode: "AZ-AUTH-01", type: "RESERVE", capacityQty: 1000, maxWeightKg: 1000, maxVolumeM3: 100 },
  });
  locationId = location.id;

  await prisma.inventoryBalance.create({ data: { productId, locationId, qtyPhysical: 100, qtyAvailable: 100 } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function auth(role: string) {
  return { Authorization: `Bearer ${tokens[role]}` };
}

describe("Unauthenticated access", () => {
  it("rejects requests with no token", async () => {
    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(401);
  });

  it("rejects requests with a garbage token", async () => {
    const res = await request(app).get("/api/orders").set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });
});

describe("OPERATOR cannot perform administrative or manager-only actions (audit 3.8)", () => {
  it("cannot manually adjust inventory", async () => {
    const res = await request(app).post("/api/inventory/adjust").set(auth("OPERATOR")).send({ productId, locationId, finalQty: 999, reason: "tentativa indevida" });
    expect(res.status).toBe(403);
  });

  it("cannot block/unblock/quarantine stock", async () => {
    const res = await request(app).post("/api/inventory/block").set(auth("OPERATOR")).send({ productId, locationId, qty: 1, reason: "tentativa indevida" });
    expect(res.status).toBe(403);
  });

  it("cannot manage users", async () => {
    const res = await request(app).get("/api/users").set(auth("OPERATOR"));
    expect(res.status).toBe(403);
  });

  it("cannot create a new user", async () => {
    const res = await request(app).post("/api/users").set(auth("OPERATOR")).send({ matricula: "X", name: "X", email: "x@x.com", password: "123456", roleCode: "ADMIN" });
    expect(res.status).toBe(403);
  });

  it("cannot approve inventory count adjustments", async () => {
    const count = await prisma.inventoryCount.create({ data: { code: `AUTH-CNT-${uniqueSuffix()}`, type: "CYCLE", status: "ADJUSTMENT" } });
    const res = await request(app).post(`/api/counts/${count.id}/apply-adjustments`).set(auth("OPERATOR"));
    expect(res.status).toBe(403);
  });

  it("cannot manage master data (create product)", async () => {
    const res = await request(app).post("/api/catalog/products").set(auth("OPERATOR")).send({ sku: "X", internalCode: "X", description: "X", categoryId: "x", baseUomId: "x", weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 });
    expect(res.status).toBe(403);
  });

  it("cannot release/manage orders", async () => {
    const order = await prisma.order.findFirst();
    const res = await request(app).post(`/api/orders/${order?.id ?? "nonexistent"}/release`).set(auth("OPERATOR"));
    expect(res.status).toBe(403);
  });

  it("can read its own task list (has task.execute)", async () => {
    const res = await request(app).get("/api/tasks/my").set(auth("OPERATOR"));
    expect(res.status).toBe(200);
  });
});

describe("MANAGER cannot manage users (create/edit reserved for ADMIN) (audit 3.8)", () => {
  // GET /users intentionally accepts users.manage OR task.assign — a
  // manager/supervisor who assigns tasks needs the operator roster to pick
  // an assignee from, and the response never includes passwordHash (see the
  // "secrets are never exposed" suite below), so this is a deliberate
  // least-privilege read exception, not a hole. Creating/editing users
  // stays USERS_MANAGE-only, which is the actual authorization boundary.
  it("can list users read-only (needed to populate task-assignment pickers)", async () => {
    const res = await request(app).get("/api/users").set(auth("MANAGER"));
    expect(res.status).toBe(200);
  });

  it("cannot create a user", async () => {
    const res = await request(app).post("/api/users").set(auth("MANAGER")).send({ matricula: "X", name: "X", email: "x2@x.com", password: "123456", roleCode: "OPERATOR" });
    expect(res.status).toBe(403);
  });

  it("cannot edit an existing user", async () => {
    const target = await prisma.user.findFirstOrThrow({ where: { email: "auth-test-operator@test.local" } });
    const res = await request(app).patch(`/api/users/${target.id}`).set(auth("MANAGER")).send({ name: "Nome Alterado Indevidamente" });
    expect(res.status).toBe(403);
  });
});

describe("CHECKER (Conferente) is scoped to conference/quality, not order/wave management (audit 3.8)", () => {
  it("cannot release an order", async () => {
    const order = await prisma.order.findFirst();
    const res = await request(app).post(`/api/orders/${order?.id ?? "nonexistent"}/release`).set(auth("CHECKER"));
    expect(res.status).toBe(403);
  });

  it("cannot manage waves", async () => {
    const res = await request(app).get("/api/waves").set(auth("CHECKER"));
    expect(res.status).toBe(403);
  });

  it("can perform receiving checks (has receiving.check)", async () => {
    const res = await request(app).get("/api/receiving").set(auth("CHECKER"));
    expect(res.status).toBe(200);
  });
});

describe("SHIPPING is scoped to packing/shipping, not inventory adjustment (audit 3.8)", () => {
  it("cannot adjust inventory", async () => {
    const res = await request(app).post("/api/inventory/adjust").set(auth("SHIPPING")).send({ productId, locationId, finalQty: 1, reason: "x" });
    expect(res.status).toBe(403);
  });

  it("can access packing endpoints", async () => {
    const res = await request(app).get(`/api/packing/orders/${(await prisma.order.findFirstOrThrow()).id}/packages`).set(auth("SHIPPING"));
    expect(res.status).toBe(200);
  });
});

describe("ADMIN has full access (audit 3.8 baseline)", () => {
  it("can list users", async () => {
    const res = await request(app).get("/api/users").set(auth("ADMIN"));
    expect(res.status).toBe(200);
  });

  it("can adjust inventory", async () => {
    const res = await request(app).post("/api/inventory/adjust").set(auth("ADMIN")).send({ productId, locationId, finalQty: 100, reason: "reconciliação de teste" });
    expect(res.status).toBe(201);
  });
});

describe("A user cannot act on a task assigned to someone else (audit 3.4/3.8 'modificar tarefa de outro operador')", () => {
  it("rejects starting a task already assigned to a different operator", async () => {
    const otherUser = await prisma.user.findFirstOrThrow({ where: { email: "auth-test-checker@test.local" } });
    const task = await prisma.task.create({ data: { type: "PICKING", refType: "TEST", refId: "test", status: "ASSIGNED", assignedToId: otherUser.id } });

    const res = await request(app).post(`/api/tasks/${task.id}/start`).set(auth("OPERATOR"));
    expect(res.status).toBe(409);
  });
});

describe("Password and secrets are never exposed in API responses (audit 3.9)", () => {
  it("/api/auth/me does not leak the password hash", async () => {
    const res = await request(app).get("/api/auth/me").set(auth("ADMIN"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it("user list does not leak password hashes", async () => {
    const res = await request(app).get("/api/users").set(auth("ADMIN"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});
