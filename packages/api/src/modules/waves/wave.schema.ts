import { z } from "zod";

export const createWaveSchema = z.object({
  code: z.string().min(1),
  criteria: z.record(z.any()).optional(),
  orderIds: z.array(z.string().min(1)).min(1),
});
