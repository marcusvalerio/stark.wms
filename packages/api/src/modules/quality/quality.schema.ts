import { z } from "zod";

export const openInspectionSchema = z.object({
  refType: z.string().min(1),
  refId: z.string().min(1),
  productId: z.string().min(1),
  lotId: z.string().optional(),
  locationId: z.string().min(1),
  qty: z.number().int().positive(),
  notes: z.string().optional(),
});

export const decideInspectionSchema = z.object({
  result: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().min(1),
});
