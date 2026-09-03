import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { carrierSchema, carrierUpdateSchema, customerSchema, customerUpdateSchema, supplierSchema, supplierUpdateSchema } from "@/modules/partners/partners.schema";

function searchWhere(q?: string, fields: string[] = ["name", "code"]) {
  if (!q) return {};
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: "insensitive" as const } })) };
}

// --- Suppliers --------------------------------------------------------

export async function listSuppliers(query: PaginationQuery) {
  const where = searchWhere(query.q, ["legalName", "code", "cnpj"]);
  const [items, total] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: { legalName: "asc" }, ...toSkipTake(query) }),
    prisma.supplier.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function createSupplier(actor: AuthUser, data: z.infer<typeof supplierSchema>) {
  const dup = await prisma.supplier.findUnique({ where: { cnpj: data.cnpj } });
  if (dup) throw new ConflictError(`CNPJ já cadastrado: ${data.cnpj}`);
  return prisma.$transaction(async (tx) => {
    const created = await tx.supplier.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Supplier", entityId: created.id, newValue: { code: created.code, legalName: created.legalName } });
    return created;
  });
}

export async function updateSupplier(actor: AuthUser, id: string, data: z.infer<typeof supplierUpdateSchema>) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Fornecedor", id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "UPDATE", entityType: "Supplier", entityId: id, previousValue: existing, newValue: updated });
    return updated;
  });
}

// --- Customers ----------------------------------------------------------

export async function listCustomers(query: PaginationQuery) {
  const where = searchWhere(query.q, ["name", "code", "document"]);
  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { name: "asc" }, ...toSkipTake(query) }),
    prisma.customer.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function createCustomer(actor: AuthUser, data: z.infer<typeof customerSchema>) {
  const dup = await prisma.customer.findUnique({ where: { document: data.document } });
  if (dup) throw new ConflictError(`Documento já cadastrado: ${data.document}`);
  return prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Customer", entityId: created.id, newValue: { code: created.code, name: created.name } });
    return created;
  });
}

export async function updateCustomer(actor: AuthUser, id: string, data: z.infer<typeof customerUpdateSchema>) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Cliente", id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "UPDATE", entityType: "Customer", entityId: id, previousValue: existing, newValue: updated });
    return updated;
  });
}

// --- Carriers -------------------------------------------------------------

export async function listCarriers(query: PaginationQuery) {
  const where = searchWhere(query.q, ["name", "code", "document"]);
  const [items, total] = await Promise.all([
    prisma.carrier.findMany({ where, orderBy: { name: "asc" }, ...toSkipTake(query) }),
    prisma.carrier.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function createCarrier(actor: AuthUser, data: z.infer<typeof carrierSchema>) {
  const dup = await prisma.carrier.findUnique({ where: { document: data.document } });
  if (dup) throw new ConflictError(`Documento já cadastrado: ${data.document}`);
  return prisma.$transaction(async (tx) => {
    const created = await tx.carrier.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Carrier", entityId: created.id, newValue: { code: created.code, name: created.name } });
    return created;
  });
}

export async function updateCarrier(actor: AuthUser, id: string, data: z.infer<typeof carrierUpdateSchema>) {
  const existing = await prisma.carrier.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Transportadora", id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.carrier.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "UPDATE", entityType: "Carrier", entityId: id, previousValue: existing, newValue: updated });
    return updated;
  });
}
