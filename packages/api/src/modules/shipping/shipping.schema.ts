import { z } from "zod";

export const createShipmentSchema = z.object({
  orderId: z.string().min(1),
  carrierId: z.string().min(1),
  dockId: z.string().optional(),
});
