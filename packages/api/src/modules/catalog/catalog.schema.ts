import { z } from "zod";

export const categorySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const categoryUpdateSchema = categorySchema.partial();

export const uomSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isBase: z.boolean().default(false),
});
export const uomUpdateSchema = uomSchema.partial();

export const productSchema = z.object({
  sku: z.string().min(1),
  internalCode: z.string().min(1),
  barcode: z.string().optional(),
  description: z.string().min(1),
  categoryId: z.string().min(1),
  baseUomId: z.string().min(1),
  weightKg: z.number().nonnegative(),
  lengthCm: z.number().nonnegative(),
  widthCm: z.number().nonnegative(),
  heightCm: z.number().nonnegative(),
  volumeM3: z.number().nonnegative().optional(),
  type: z.enum(["STANDARD", "KIT", "BULK", "FRAGILE", "PERISHABLE"]).default("STANDARD"),
  lotControl: z.boolean().default(false),
  expiryControl: z.boolean().default(false),
  serialControl: z.boolean().default(false),
  minStock: z.number().int().nonnegative().default(0),
  maxStock: z.number().int().nonnegative().default(0),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  conversions: z
    .array(z.object({ toUomId: z.string().min(1), factor: z.number().positive() }))
    .optional(),
});
export const productUpdateSchema = productSchema.partial().omit({ conversions: true });
