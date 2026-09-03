import { z } from "zod";

export const createCountSchema = z.object({
  code: z.string().min(1),
  type: z.enum(["GENERAL", "PARTIAL", "CYCLE"]),
  locationIds: z.array(z.string()).optional(),
  productIds: z.array(z.string()).optional(),
});

export const recordCountSchema = z.object({ countedQty: z.number().int().nonnegative() });
