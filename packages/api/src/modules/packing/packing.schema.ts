import { z } from "zod";

export const createPackageSchema = z.object({ orderId: z.string().min(1), code: z.string().min(1) });

export const addPackageItemSchema = z.object({ orderItemId: z.string().min(1), qty: z.number().int().positive() });

export const closePackageSchema = z.object({
  weightKg: z.number().positive(),
  lengthCm: z.number().positive(),
  widthCm: z.number().positive(),
  heightCm: z.number().positive(),
});
