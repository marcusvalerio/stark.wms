import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { categorySchema, categoryUpdateSchema, productSchema, productUpdateSchema, uomSchema, uomUpdateSchema } from "@/modules/catalog/catalog.schema";

// --- Categories -------------------------------------------------------

export async function listCategories(query: PaginationQuery) {
  const where = query.q
    ? { OR: [{ name: { contains: query.q, mode: "insensitive" as const } }, { code: { contains: query.q, mode: "insensitive" as const } }] }
    : {};
  const [items, total] = await Promise.all([
    prisma.category.findMany({ where, orderBy: { code: "asc" }, ...toSkipTake(query) }),
    prisma.category.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function createCategory(actor: AuthUser, data: z.infer<typeof categorySchema>) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.category.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Category", entityId: created.id, newValue: data });
    return created;
  });
}

export async function updateCategory(actor: AuthUser, id: string, data: z.infer<typeof categoryUpdateSchema>) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Categoria", id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "UPDATE", entityType: "Category", entityId: id, previousValue: existing, newValue: updated });
    return updated;
  });
}

// --- Units of measure ---------------------------------------------------

export async function listUoms(query: PaginationQuery) {
  const where = query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" as const } }, { code: { contains: query.q, mode: "insensitive" as const } }] } : {};
  const [items, total] = await Promise.all([
    prisma.unitOfMeasure.findMany({ where, orderBy: { code: "asc" }, ...toSkipTake(query) }),
    prisma.unitOfMeasure.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function createUom(actor: AuthUser, data: z.infer<typeof uomSchema>) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.unitOfMeasure.create({ data });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "UnitOfMeasure", entityId: created.id, newValue: data });
    return created;
  });
}

export async function updateUom(actor: AuthUser, id: string, data: z.infer<typeof uomUpdateSchema>) {
  const existing = await prisma.unitOfMeasure.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Unidade de medida", id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.unitOfMeasure.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "UPDATE", entityType: "UnitOfMeasure", entityId: id, previousValue: existing, newValue: updated });
    return updated;
  });
}

// --- Products -------------------------------------------------------------

const productInclude = {
  category: true,
  baseUom: true,
  conversions: { include: { toUom: true, fromUom: true } },
} as const;

export async function listProducts(query: PaginationQuery & { categoryId?: string; status?: string }) {
  const where = {
    ...(query.q
      ? {
          OR: [
            { sku: { contains: query.q, mode: "insensitive" as const } },
            { internalCode: { contains: query.q, mode: "insensitive" as const } },
            { barcode: { contains: query.q, mode: "insensitive" as const } },
            { description: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.status ? { status: query.status as "ACTIVE" | "INACTIVE" } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, include: productInclude, orderBy: { sku: "asc" }, ...toSkipTake(query) }),
    prisma.product.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include: productInclude });
  if (!product) throw new NotFoundError("Produto", id);
  return product;
}

export async function createProduct(actor: AuthUser, data: z.infer<typeof productSchema>) {
  const [sameSku, sameCode] = await Promise.all([
    prisma.product.findUnique({ where: { sku: data.sku } }),
    prisma.product.findUnique({ where: { internalCode: data.internalCode } }),
  ]);
  if (sameSku) throw new ConflictError(`SKU já cadastrado: ${data.sku}`);
  if (sameCode) throw new ConflictError(`Código interno já cadastrado: ${data.internalCode}`);

  const volumeM3 = data.volumeM3 ?? (data.lengthCm * data.widthCm * data.heightCm) / 1_000_000;
  const { conversions, ...rest } = data;

  return prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        ...rest,
        volumeM3,
        conversions: conversions
          ? { create: conversions.map((c) => ({ fromUomId: data.baseUomId, toUomId: c.toUomId, factor: c.factor })) }
          : undefined,
      },
      include: productInclude,
    });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Product", entityId: created.id, newValue: { sku: created.sku, description: created.description } });
    return created;
  });
}

export async function updateProduct(actor: AuthUser, id: string, data: z.infer<typeof productUpdateSchema>) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Produto", id);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id }, data, include: productInclude });
    await writeAudit(tx, actor, {
      action: "UPDATE",
      entityType: "Product",
      entityId: id,
      previousValue: { status: existing.status, minStock: existing.minStock, maxStock: existing.maxStock },
      newValue: { status: updated.status, minStock: updated.minStock, maxStock: updated.maxStock },
    });
    return updated;
  });
}
