import { z } from "zod";

export const createOrderSchema = z.object({
  number: z.string().min(1),
  customerId: z.string().min(1),
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]).default("NORMAL"),
  slaDueAt: z.coerce.date().optional(),
  carrierId: z.string().optional(),
  shippingAddress: z.record(z.any()).optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      uomId: z.string().min(1),
      qtyOrdered: z.number().int().positive(),
    })
  ).min(1),
});
