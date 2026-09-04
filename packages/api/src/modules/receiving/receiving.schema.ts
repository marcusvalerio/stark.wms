import { z } from "zod";

export const createReceiptSchema = z.object({
  number: z.string().min(1),
  supplierId: z.string().min(1),
  scheduledDate: z.coerce.date(),
  dockId: z.string().optional(),
  crossDock: z.boolean().default(false),
  notes: z.string().optional(),
  items: z.array(z.object({ productId: z.string().min(1), expectedQty: z.number().int().positive() })).min(1),
});

export const checkItemSchema = z.object({
  receivedQty: z.number().int().nonnegative(),
  damagedQty: z.number().int().nonnegative().default(0),
  lotCode: z.string().optional(),
  expiryDate: z.coerce.date().optional(),
  manufactureDate: z.coerce.date().optional(),
});

export const executePutawaySchema = z.object({
  destLocationId: z.string().min(1),
});

export const assignDockSchema = z.object({ dockId: z.string().min(1) });
