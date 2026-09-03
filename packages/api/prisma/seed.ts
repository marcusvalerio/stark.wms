/* eslint-disable no-console */
import bcrypt from "bcryptjs";
import { prisma } from "@/db/prisma";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from "@/common/permissions";
import { AuthUser } from "@/common/auth-middleware";
import * as engine from "@/modules/inventory/inventory.engine";
import * as taskService from "@/modules/tasks/task.service";
import * as receivingService from "@/modules/receiving/receiving.service";
import * as discrepancyService from "@/modules/discrepancy/discrepancy.service";
import * as orderService from "@/modules/orders/order.service";
import * as pickingService from "@/modules/orders/picking.service";
import * as waveService from "@/modules/waves/wave.service";
import * as replenishmentService from "@/modules/replenishment/replenishment.service";
import * as countService from "@/modules/counts/count.service";
import * as qualityService from "@/modules/quality/quality.service";
import * as packingService from "@/modules/packing/packing.service";
import * as shippingService from "@/modules/shipping/shipping.service";

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}
function pad(n: number, len: number) {
  return String(n).padStart(len, "0");
}

async function main() {
  console.log("Seeding STARK.WMS demo data...");

  // -------------------------------------------------------------------
  // 1. Permissions, roles, users
  // -------------------------------------------------------------------
  const permissionRecords = await Promise.all(
    ALL_PERMISSIONS.map((p) => prisma.permission.upsert({ where: { code: p.code }, update: {}, create: p }))
  );
  const permissionByCode = new Map(permissionRecords.map((p) => [p.code, p]));

  const roleDefs = [
    { code: "ADMIN" as const, name: "Administrador", description: "Acesso completo ao sistema." },
    { code: "MANAGER" as const, name: "Gestor", description: "Gestão operacional e aprovações." },
    { code: "SUPERVISOR" as const, name: "Supervisor", description: "Supervisão de operações e equipes." },
    { code: "OPERATOR" as const, name: "Operador", description: "Execução de tarefas operacionais." },
    { code: "CHECKER" as const, name: "Conferente", description: "Conferência de recebimento e qualidade." },
    { code: "SHIPPING" as const, name: "Expedição", description: "Packing, staging e expedição." },
  ];

  const roles = new Map<string, { id: string; code: string; name: string }>();
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({ where: { code: def.code }, update: { name: def.name, description: def.description }, create: def });
    roles.set(def.code, role);
    const codes = ROLE_PERMISSIONS[def.code];
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: codes.map((c) => ({ roleId: role.id, permissionId: permissionByCode.get(c)!.id })),
    });
  }

  const passwordHash = await bcrypt.hash("stark@123", 10);
  const userDefs = [
    { matricula: "0001", name: "Ana Ferreira", email: "admin@starkwms.com", role: "ADMIN", shift: "COMERCIAL" },
    { matricula: "0002", name: "Bruno Castro", email: "gestor@starkwms.com", role: "MANAGER", shift: "COMERCIAL" },
    { matricula: "0003", name: "Carla Nunes", email: "supervisor@starkwms.com", role: "SUPERVISOR", shift: "MANHA" },
    { matricula: "0101", name: "Diego Souza", email: "diego.souza@starkwms.com", role: "OPERATOR", shift: "MANHA" },
    { matricula: "0102", name: "Elisa Ramos", email: "elisa.ramos@starkwms.com", role: "OPERATOR", shift: "MANHA" },
    { matricula: "0103", name: "Fabio Lima", email: "fabio.lima@starkwms.com", role: "OPERATOR", shift: "TARDE" },
    { matricula: "0104", name: "Gabriela Alves", email: "gabriela.alves@starkwms.com", role: "OPERATOR", shift: "TARDE" },
    { matricula: "0201", name: "Heitor Prado", email: "heitor.prado@starkwms.com", role: "CHECKER", shift: "MANHA" },
    { matricula: "0202", name: "Isabela Rocha", email: "isabela.rocha@starkwms.com", role: "CHECKER", shift: "TARDE" },
    { matricula: "0301", name: "Joao Martins", email: "joao.martins@starkwms.com", role: "SHIPPING", shift: "TARDE" },
  ];

  const users = new Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>();
  for (const def of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {},
      create: {
        matricula: def.matricula,
        name: def.name,
        email: def.email,
        passwordHash,
        roleId: roles.get(def.role)!.id,
        shift: def.shift,
        operatorStatus: "AVAILABLE",
      },
    });
    users.set(def.email, user);
  }

  function actorFor(email: string): AuthUser {
    const user = users.get(email)!;
    const roleDef = roleDefs.find((r) => roles.get(r.code)!.id === user.roleId)!;
    return {
      id: user.id,
      matricula: user.matricula,
      name: user.name,
      email: user.email,
      roleCode: roleDef.code,
      permissions: ROLE_PERMISSIONS[roleDef.code],
      authorizedZones: [],
    };
  }

  const admin = actorFor("admin@starkwms.com");
  const supervisor = actorFor("supervisor@starkwms.com");
  const checkers = ["heitor.prado@starkwms.com", "isabela.rocha@starkwms.com"].map(actorFor);
  const operators = ["diego.souza@starkwms.com", "elisa.ramos@starkwms.com", "fabio.lima@starkwms.com", "gabriela.alves@starkwms.com"].map(actorFor);
  const shippingUser = actorFor("joao.martins@starkwms.com");

  // -------------------------------------------------------------------
  // 2. Units of measure, categories
  // -------------------------------------------------------------------
  const uomDefs = [
    { code: "UN", name: "Unidade", isBase: true },
    { code: "CX", name: "Caixa", isBase: false },
    { code: "PC", name: "Pacote", isBase: false },
    { code: "PL", name: "Pallet", isBase: false },
    { code: "KG", name: "Quilograma", isBase: false },
  ];
  const uoms = new Map<string, Awaited<ReturnType<typeof prisma.unitOfMeasure.upsert>>>();
  for (const def of uomDefs) {
    uoms.set(def.code, await prisma.unitOfMeasure.upsert({ where: { code: def.code }, update: {}, create: def }));
  }
  const UN = uoms.get("UN")!;

  const categoryDefs = [
    { code: "LIMP", name: "Limpeza" },
    { code: "ALIM", name: "Alimentos" },
    { code: "BEBI", name: "Bebidas" },
    { code: "ELET", name: "Eletrônicos" },
    { code: "PAPE", name: "Papelaria" },
    { code: "HIGI", name: "Higiene Pessoal" },
    { code: "BRINQ", name: "Brinquedos" },
    { code: "FERR", name: "Ferramentas" },
  ];
  const categories = new Map<string, Awaited<ReturnType<typeof prisma.category.upsert>>>();
  for (const def of categoryDefs) {
    categories.set(def.code, await prisma.category.upsert({ where: { code: def.code }, update: {}, create: { ...def, description: `Categoria ${def.name}` } }));
  }

  // -------------------------------------------------------------------
  // 3. Partners
  // -------------------------------------------------------------------
  const supplierDefs = [
    { code: "FOR001", legalName: "Distribuidora Horizonte Ltda", cnpj: "12.345.678/0001-01" },
    { code: "FOR002", legalName: "Industria Vale Verde S.A.", cnpj: "23.456.789/0001-02" },
    { code: "FOR003", legalName: "Comercial Atlas Ltda", cnpj: "34.567.890/0001-03" },
    { code: "FOR004", legalName: "Grupo Nortex Distribuicao", cnpj: "45.678.901/0001-04" },
    { code: "FOR005", legalName: "Uniao Fabril Ltda", cnpj: "56.789.012/0001-05" },
    { code: "FOR006", legalName: "Prisma Importacao e Exportacao", cnpj: "67.890.123/0001-06" },
  ];
  const suppliers: Awaited<ReturnType<typeof prisma.supplier.upsert>>[] = [];
  for (const def of supplierDefs) {
    suppliers.push(await prisma.supplier.upsert({ where: { cnpj: def.cnpj }, update: {}, create: { ...def, contacts: [{ name: "Comercial", phone: "(11) 4000-0000" }] } }));
  }

  const customerDefs = [
    { code: "CLI001", name: "Mercado Sao Jorge", document: "11.222.333/0001-11" },
    { code: "CLI002", name: "Farmacia Bem Estar", document: "22.333.444/0001-22" },
    { code: "CLI003", name: "Loja Casa & Cia", document: "33.444.555/0001-33" },
    { code: "CLI004", name: "Papelaria Escreva Bem", document: "44.555.666/0001-44" },
    { code: "CLI005", name: "Eletro Center", document: "55.666.777/0001-55" },
    { code: "CLI006", name: "Supermercado Boa Compra", document: "66.777.888/0001-66" },
    { code: "CLI007", name: "Brinquedos Alegria", document: "77.888.999/0001-77" },
    { code: "CLI008", name: "Ferragens Sao Paulo", document: "88.999.000/0001-88" },
    { code: "CLI009", name: "Distribuidora Regional Sul", document: "99.000.111/0001-99" },
    { code: "CLI010", name: "Atacado Central", document: "10.111.222/0001-10" },
  ];
  const customers: Awaited<ReturnType<typeof prisma.customer.upsert>>[] = [];
  for (const def of customerDefs) {
    customers.push(await prisma.customer.upsert({ where: { document: def.document }, update: {}, create: { ...def, contacts: [{ name: "Compras", phone: "(11) 3000-0000" }] } }));
  }

  const carrierDefs = [
    { code: "TRA001", name: "Rapida Transportes", document: "10.101.010/0001-10" },
    { code: "TRA002", name: "Logimax Cargas", document: "20.202.020/0001-20" },
    { code: "TRA003", name: "Expresso Sul", document: "30.303.030/0001-30" },
    { code: "TRA004", name: "TransBrasil Logistica", document: "40.404.040/0001-40" },
  ];
  const carriers: Awaited<ReturnType<typeof prisma.carrier.upsert>>[] = [];
  for (const def of carrierDefs) {
    carriers.push(await prisma.carrier.upsert({ where: { document: def.document }, update: {}, create: def }));
  }

  // -------------------------------------------------------------------
  // 4. Products (56 SKUs across 8 categories)
  // -------------------------------------------------------------------
  const productCatalog: { category: string; items: string[]; perishable?: boolean; serial?: boolean }[] = [
    { category: "LIMP", items: ["Detergente 500ml", "Sabao em Po 1kg", "Agua Sanitaria 1L", "Desinfetante 500ml", "Amaciante 2L", "Multiuso 500ml", "Esponja de Aco (pack)", "Vassoura Domestica"] },
    { category: "ALIM", items: ["Arroz 5kg", "Feijao 1kg", "Acucar 1kg", "Cafe 500g", "Macarrao 500g", "Oleo de Soja 900ml", "Farinha de Trigo 1kg", "Sal Refinado 1kg"], perishable: true },
    { category: "BEBI", items: ["Refrigerante 2L", "Suco de Laranja 1L", "Agua Mineral 500ml", "Cerveja Lata 350ml", "Energetico 250ml", "Cha Gelado 1L"], perishable: true },
    { category: "ELET", items: ["Fone de Ouvido Bluetooth", "Carregador USB-C", "Mouse sem Fio", "Teclado USB", "Power Bank 10000mAh", "Cabo HDMI 2m", "Caixa de Som Bluetooth"], serial: true },
    { category: "PAPE", items: ["Caderno 96 folhas", "Caneta Esferografica (cx)", "Lapis Grafite (cx)", "Papel A4 (resma)", "Bloco Post-it", "Pasta Plastica", "Grampeador"] },
    { category: "HIGI", items: ["Sabonete 90g", "Shampoo 350ml", "Condicionador 350ml", "Creme Dental 90g", "Papel Higienico (pack 4)", "Absorvente (pack)", "Desodorante Aerosol"], perishable: true },
    { category: "BRINQ", items: ["Boneca Articulada", "Carrinho de Brinquedo", "Quebra-cabeca 500 pecas", "Bola de Futebol", "Jogo de Tabuleiro", "Ursinho de Pelucia"] },
    { category: "FERR", items: ["Martelo Unha", "Chave de Fenda", "Alicate Universal", "Trena 5m", "Furadeira Eletrica", "Chave Inglesa", "Kit Ferramentas 20pc"] },
  ];

  const products: Awaited<ReturnType<typeof prisma.product.upsert>>[] = [];
  let skuCounter = 1;
  for (const group of productCatalog) {
    for (const name of group.items) {
      const sku = `SKU-${pad(skuCounter, 5)}`;
      const internalCode = `INT-${pad(skuCounter, 4)}`;
      const weight = Number((Math.random() * 4 + 0.1).toFixed(2));
      const length = rand(8, 40);
      const width = rand(6, 30);
      const height = rand(4, 25);
      const product = await prisma.product.upsert({
        where: { sku },
        update: {},
        create: {
          sku,
          internalCode,
          barcode: `789${pad(skuCounter, 10)}`,
          description: name,
          categoryId: categories.get(group.category)!.id,
          baseUomId: UN.id,
          weightKg: weight,
          lengthCm: length,
          widthCm: width,
          heightCm: height,
          volumeM3: Number(((length * width * height) / 1_000_000).toFixed(4)),
          type: group.serial ? "STANDARD" : "STANDARD",
          lotControl: Boolean(group.perishable),
          expiryControl: Boolean(group.perishable),
          serialControl: Boolean(group.serial),
          minStock: rand(15, 40),
          maxStock: rand(150, 400),
        },
      });
      products.push(product);
      skuCounter += 1;
    }
  }
  console.log(`Products: ${products.length}`);

  // -------------------------------------------------------------------
  // 5. Warehouse structure
  // -------------------------------------------------------------------
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "CD01" },
    update: {},
    create: { code: "CD01", name: "Centro de Distribuicao 01", address: { city: "Sao Paulo", state: "SP" } },
  });

  async function ensureZone(code: string, name: string, type: "PICKING" | "RESERVE" | "RECEIVING" | "STAGING" | "SHIPPING" | "QUARANTINE" | "CROSS_DOCK") {
    return prisma.zone.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code } }, update: {}, create: { warehouseId: warehouse.id, code, name, type } });
  }

  async function ensureLocation(zoneId: string, zoneCode: string, aisle: string, rack: string, level: string, position: string, type: "PICKING" | "RESERVE" | "RECEIVING" | "STAGING" | "SHIPPING" | "QUARANTINE" | "CROSS_DOCK", opts: { capacityQty: number; maxWeightKg: number; maxVolumeM3: number; pickingMin?: number; pickingMax?: number }) {
    const fullCode = `${zoneCode}-${aisle}-${rack}-${level}-${position}`;
    return prisma.location.upsert({
      where: { fullCode },
      update: {},
      create: { zoneId, aisle, rack, level, position, fullCode, type, capacityQty: opts.capacityQty, maxWeightKg: opts.maxWeightKg, maxVolumeM3: opts.maxVolumeM3, pickingMin: opts.pickingMin, pickingMax: opts.pickingMax },
    });
  }

  const zoneA = await ensureZone("A", "Picking Principal", "PICKING");
  const zoneB = await ensureZone("B", "Reserva Geral", "RESERVE");
  const zoneC = await ensureZone("C", "Doca de Recebimento", "RECEIVING");
  const zoneD = await ensureZone("D", "Staging de Separacao", "STAGING");
  const zoneE = await ensureZone("E", "Staging de Expedicao", "SHIPPING");
  const zoneQ = await ensureZone("Q", "Quarentena", "QUARANTINE");
  const zoneX = await ensureZone("X", "Cross-Docking", "CROSS_DOCK");

  const pickingLocations = [];
  for (const aisle of ["01", "02"]) {
    for (const rk of ["01", "02", "03"]) {
      for (const level of ["01", "02"]) {
        for (const position of ["01", "02"]) {
          pickingLocations.push(await ensureLocation(zoneA.id, "A", aisle, rk, level, position, "PICKING", { capacityQty: 60, maxWeightKg: 300, maxVolumeM3: 2, pickingMin: 10, pickingMax: 50 }));
        }
      }
    }
  }

  const reserveLocations = [];
  for (const aisle of ["01", "02", "03"]) {
    for (const rk of ["01", "02", "03", "04"]) {
      for (const level of ["01", "02", "03"]) {
        reserveLocations.push(await ensureLocation(zoneB.id, "B", aisle, rk, level, "01", "RESERVE", { capacityQty: 500, maxWeightKg: 1500, maxVolumeM3: 8 }));
      }
    }
  }

  const receivingLocations = [];
  for (const position of ["01", "02", "03", "04"]) {
    receivingLocations.push(await ensureLocation(zoneC.id, "C", "01", "01", "01", position, "RECEIVING", { capacityQty: 2000, maxWeightKg: 5000, maxVolumeM3: 40 }));
  }
  const stagingLocations = [];
  for (const position of ["01", "02", "03", "04"]) {
    stagingLocations.push(await ensureLocation(zoneD.id, "D", "01", "01", "01", position, "STAGING", { capacityQty: 500, maxWeightKg: 2000, maxVolumeM3: 20 }));
  }
  const shippingLocations = [];
  for (const position of ["01", "02", "03", "04"]) {
    shippingLocations.push(await ensureLocation(zoneE.id, "E", "01", "01", "01", position, "SHIPPING", { capacityQty: 500, maxWeightKg: 2000, maxVolumeM3: 20 }));
  }
  const quarantineLocations = [];
  for (const position of ["01", "02", "03"]) {
    quarantineLocations.push(await ensureLocation(zoneQ.id, "Q", "01", "01", "01", position, "QUARANTINE", { capacityQty: 200, maxWeightKg: 800, maxVolumeM3: 10 }));
  }
  const crossDockLocations = [];
  for (const position of ["01", "02", "03"]) {
    crossDockLocations.push(await ensureLocation(zoneX.id, "X", "01", "01", "01", position, "CROSS_DOCK", { capacityQty: 300, maxWeightKg: 1000, maxVolumeM3: 10 }));
  }

  console.log(`Locations: ${pickingLocations.length + reserveLocations.length + receivingLocations.length + stagingLocations.length + shippingLocations.length + quarantineLocations.length + crossDockLocations.length}`);

  for (let i = 1; i <= 3; i++) {
    await prisma.dock.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: `DOCK-R${i}` } }, update: {}, create: { warehouseId: warehouse.id, code: `DOCK-R${i}`, type: "RECEIVING" } });
  }
  for (let i = 1; i <= 3; i++) {
    await prisma.dock.upsert({ where: { warehouseId_code: { warehouseId: warehouse.id, code: `DOCK-S${i}` } }, update: {}, create: { warehouseId: warehouse.id, code: `DOCK-S${i}`, type: "SHIPPING" } });
  }
  const docks = await prisma.dock.findMany({ where: { warehouseId: warehouse.id } });
  const receivingDocks = docks.filter((d) => d.type === "RECEIVING");
  const shippingDocks = docks.filter((d) => d.type === "SHIPPING");

  // If demo transactional data already exists, stop here (idempotent re-run for master data only).
  const existingReceipts = await prisma.receipt.count();
  if (existingReceipts > 0) {
    console.log("Transactional demo data already present — skipping receipts/orders/tasks generation.");
    console.log("Seed complete.");
    return;
  }

  // -------------------------------------------------------------------
  // 6. Receiving -> conference -> put-away (also seeds real inventory)
  // -------------------------------------------------------------------
  let receiptCounter = 1;
  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  async function makeReceiptForProducts(items: typeof products) {
    const supplier = pick(suppliers);
    const number = `REC-${pad(receiptCounter++, 4)}`;
    return receivingService.create(admin, {
      number,
      supplierId: supplier.id,
      scheduledDate: new Date(),
      crossDock: false,
      items: items.map((p) => ({ productId: p.id, expectedQty: rand(30, 150) })),
    });
  }
  async function makeReceipt(itemCount: number) {
    const items = [...products].sort(() => Math.random() - 0.5).slice(0, itemCount);
    return makeReceiptForProducts(items);
  }

  // Fully completed receipts covering every SKU at least once (becomes the
  // bulk of on-hand inventory — every product ends up with real stock so
  // orders can be built against any of them).
  const productChunks = chunk(products, 5);
  for (let i = 0; i < productChunks.length; i++) {
    const receipt = await makeReceiptForProducts(productChunks[i]);
    await receivingService.markArrived(admin, receipt.id);
    await receivingService.assignDock(admin, receipt.id, pick(receivingDocks).id);
    const checker = pick(checkers);
    await receivingService.startConference(checker, receipt.id);
    const full = await receivingService.get(receipt.id);
    for (const item of full.items) {
      const introduceDivergence = i === 1 && item === full.items[0];
      const receivedQty = introduceDivergence ? Math.max(item.expectedQty - rand(1, 5), 0) : item.expectedQty;
      const damagedQty = i === 3 && item === full.items[full.items.length - 1] ? rand(1, 3) : 0;
      await receivingService.checkItem(checker, receipt.id, item.id, {
        receivedQty,
        damagedQty,
        lotCode: item.product.lotControl ? `LT${pad(i, 2)}${pad(products.indexOf(products.find((p) => p.id === item.productId)!) + 1, 3)}` : undefined,
        expiryDate: item.product.expiryControl ? new Date(Date.now() + rand(30, 365) * 86400000) : undefined,
        manufactureDate: item.product.expiryControl ? new Date(Date.now() - rand(10, 60) * 86400000) : undefined,
      });
    }
    await receivingService.completeConference(checker, receipt.id);

    const openTasks = await prisma.task.findMany({ where: { receiptId: receipt.id, type: "PUTAWAY", status: "PENDING" } });
    for (const task of openTasks) {
      const dest = pick(reserveLocations);
      const operator = pick(operators);
      await receivingService.executePutaway(operator, task.id, dest.id);
    }
  }

  // One receipt sitting in AT_DOCK (waiting conference) and one still SCHEDULED, to show pipeline diversity.
  const partial = await makeReceipt(3);
  await receivingService.markArrived(admin, partial.id);
  await receivingService.assignDock(admin, partial.id, pick(receivingDocks).id);
  await makeReceipt(2);

  // -------------------------------------------------------------------
  // 7. Seed a little picking-face stock deliberately below minimum
  //    (drives the replenishment recommendation demo).
  // -------------------------------------------------------------------
  const lowStockProducts = [...products].sort(() => Math.random() - 0.5).slice(0, 8);
  for (let i = 0; i < lowStockProducts.length; i++) {
    const location = pickingLocations[i % pickingLocations.length];
    await prisma.$transaction(async (tx) => {
      await engine.increaseAvailable(tx, {
        type: "PUTAWAY",
        productId: lowStockProducts[i].id,
        qty: rand(2, 8),
        toLocationId: location.id,
        userId: admin.id,
        refType: "SEED_INIT",
        refId: "seed",
        reason: "Carga inicial de demonstracao",
      });
    });
  }

  // -------------------------------------------------------------------
  // 8. Orders -> release -> allocate -> pick -> conference -> pack -> ship
  // -------------------------------------------------------------------
  let orderCounter = 1;
  async function makeOrder(itemCount: number, priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW") {
    const customer = pick(customers);
    const carrier = pick(carriers);
    const items = [...products].sort(() => Math.random() - 0.5).slice(0, itemCount);
    const number = `PED-${pad(orderCounter++, 4)}`;
    return orderService.create(admin, {
      number,
      customerId: customer.id,
      priority,
      slaDueAt: new Date(Date.now() + rand(2, 48) * 3600000),
      carrierId: carrier.id,
      items: items.map((p) => ({ productId: p.id, uomId: UN.id, qtyOrdered: rand(1, 10) })),
    });
  }

  const shippedOrders = [];
  for (let i = 0; i < 3; i++) {
    const order = await makeOrder(rand(1, 3), i === 0 ? "CRITICAL" : "NORMAL");
    await orderService.release(admin, order.id);
    await orderService.startPicking(admin, order.id);
    let tasks = await prisma.pickingTask.findMany({ where: { orderItem: { orderId: order.id } }, include: { orderItem: true } });
    for (const t of tasks) {
      const operator = pick(operators);
      await pickingService.executePickingTask(operator, t.id, t.qtySuggested);
    }
    await orderService.advanceToConference(pick(checkers), order.id);
    const pkg = await packingService.createPackage(shippingUser, { orderId: order.id, code: `${order.number}-VOL01` });
    const freshOrder = await orderService.get(order.id);
    for (const item of freshOrder.items) {
      if (item.qtyPicked > 0) await packingService.addItem(shippingUser, pkg.id, { orderItemId: item.id, qty: item.qtyPicked });
    }
    await packingService.closePackage(shippingUser, pkg.id, { weightKg: rand(1, 20), lengthCm: 40, widthCm: 30, heightCm: 25 });
    await packingService.sendToStaging(shippingUser, order.id);
    const shipment = await shippingService.create(shippingUser, { orderId: order.id, carrierId: freshOrder.carrierId!, dockId: pick(shippingDocks).id });
    await shippingService.assignDock(shippingUser, shipment.id, pick(shippingDocks).id);
    await shippingService.load(shippingUser, shipment.id);
    await shippingService.ship(shippingUser, shipment.id);
    shippedOrders.push(order);
  }

  // A couple orders parked mid-pipeline at different stages.
  const pickedOrder = await makeOrder(2, "HIGH");
  await orderService.release(admin, pickedOrder.id);
  await orderService.startPicking(admin, pickedOrder.id);

  const allocatedOrders = [];
  for (let i = 0; i < 2; i++) {
    const order = await makeOrder(rand(1, 2), "NORMAL");
    await orderService.release(admin, order.id);
    allocatedOrders.push(order);
  }

  for (let i = 0; i < 3; i++) {
    await makeOrder(rand(1, 3), pick(["NORMAL", "LOW"] as const));
  }

  // -------------------------------------------------------------------
  // 9. Wave grouping the allocated orders
  // -------------------------------------------------------------------
  if (allocatedOrders.length >= 2) {
    const wave = await waveService.create(supervisor, { code: "ONDA-0001", orderIds: allocatedOrders.map((o) => o.id) });
    await waveService.release(supervisor, wave.id);
  }

  // -------------------------------------------------------------------
  // 10. Replenishment
  // -------------------------------------------------------------------
  const scan = await replenishmentService.scanReplenishmentNeeds(supervisor);
  if (scan.tasks.length > 0) {
    await replenishmentService.execute(pick(operators), scan.tasks[0].id);
  }

  // -------------------------------------------------------------------
  // 11. Discrepancy resolution demo (resolve the first, leave rest open)
  // -------------------------------------------------------------------
  const openDiscrepancies = await discrepancyService.list({ page: 1, pageSize: 5, status: "OPEN" });
  if (openDiscrepancies.items.length > 0) {
    const first = openDiscrepancies.items[0];
    await discrepancyService.review(supervisor, first.id);
    await discrepancyService.resolve(supervisor, first.id, { action: "AJUSTE_ACEITO", notes: "Divergencia validada com o fornecedor; estoque ajustado conforme quantidade recebida." });
  }

  // -------------------------------------------------------------------
  // 12. Quality: quarantine + release one lot, quarantine another and leave pending
  // -------------------------------------------------------------------
  const lotBalance = await prisma.inventoryBalance.findFirst({ where: { lotId: { not: null }, qtyAvailable: { gt: 5 } }, include: { lot: true } });
  if (lotBalance) {
    const inspection = await qualityService.open(pick(checkers), {
      refType: "ROTINA",
      refId: "seed",
      productId: lotBalance.productId,
      lotId: lotBalance.lotId ?? undefined,
      locationId: lotBalance.locationId,
      qty: Math.min(5, lotBalance.qtyAvailable),
      notes: "Inspecao de rotina de qualidade.",
    });
    await qualityService.startInspection(pick(checkers), inspection.id);
    await qualityService.decide(pick(checkers), inspection.id, { result: "APPROVED", notes: "Produto dentro dos padroes de qualidade." });
  }

  // -------------------------------------------------------------------
  // 13. Cycle count with a deliberate divergence, taken to completion
  // -------------------------------------------------------------------
  const stockedReserveLocations = await prisma.inventoryBalance.findMany({
    where: { locationId: { in: reserveLocations.map((l) => l.id) }, qtyPhysical: { gt: 0 } },
    select: { locationId: true },
    distinct: ["locationId"],
    take: 5,
  });
  const countLocations = stockedReserveLocations.map((b) => b.locationId);
  const count = await countService.create(supervisor, { code: "INV-0001", type: "CYCLE", locationIds: countLocations });
  await countService.startCounting(supervisor, count.id);
  const countDetail = await countService.get(count.id);
  for (const [idx, item] of countDetail.items.entries()) {
    const countedQty = idx === 0 ? Math.max(item.systemQty - rand(1, 4), 0) : item.systemQty;
    await countService.recordCount(supervisor, count.id, item.id, countedQty, false);
  }
  const afterReview = await countService.completeCounting(supervisor, count.id);
  if (afterReview.status === "DISCREPANCY") {
    await countService.startRecount(supervisor, count.id);
    const detail = await countService.get(count.id);
    for (const item of detail.items.filter((i) => i.status === "DIVERGENT")) {
      await countService.recordCount(supervisor, count.id, item.id, item.countedQty1 ?? item.systemQty, true);
    }
    await countService.completeRecount(supervisor, count.id);
  }
  await countService.approve(admin, count.id);
  await countService.applyAdjustments(admin, count.id);

  // A second, still-open count to show an in-progress inventory in the UI.
  const moreStockedLocations = await prisma.inventoryBalance.findMany({
    where: { locationId: { in: reserveLocations.map((l) => l.id), notIn: countLocations }, qtyPhysical: { gt: 0 } },
    select: { locationId: true },
    distinct: ["locationId"],
    take: 3,
  });
  if (moreStockedLocations.length > 0) {
    await countService.create(supervisor, { code: "INV-0002", type: "PARTIAL", locationIds: moreStockedLocations.map((b) => b.locationId) });
  }

  // -------------------------------------------------------------------
  // 14. Assign a few pending tasks to operators
  // -------------------------------------------------------------------
  const pendingTasks = await prisma.task.findMany({ where: { status: "PENDING" }, take: 6 });
  for (const task of pendingTasks) {
    await taskService.assignTask(supervisor, task.id, pick(operators).id);
  }

  console.log("Seed complete.");
  console.log("Demo logins (password 'stark@123'):");
  for (const def of userDefs) console.log(`  ${def.email}  [${def.role}]`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
