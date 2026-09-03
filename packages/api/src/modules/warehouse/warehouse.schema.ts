import { z } from "zod";

export const warehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.record(z.any()).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const warehouseUpdateSchema = warehouseSchema.partial();

export const zoneSchema = z.object({
  warehouseId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["PICKING", "RESERVE", "RECEIVING", "STAGING", "SHIPPING", "QUARANTINE", "CROSS_DOCK"]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const zoneUpdateSchema = zoneSchema.partial().omit({ warehouseId: true });

export const locationSchema = z.object({
  zoneId: z.string().min(1),
  aisle: z.string().min(1),
  rack: z.string().min(1),
  level: z.string().min(1),
  position: z.string().min(1),
  type: z.enum(["PICKING", "RESERVE", "RECEIVING", "STAGING", "SHIPPING", "QUARANTINE", "CROSS_DOCK"]),
  capacityQty: z.number().int().positive(),
  maxWeightKg: z.number().positive(),
  maxVolumeM3: z.number().positive(),
  pickingMin: z.number().int().nonnegative().optional(),
  pickingMax: z.number().int().nonnegative().optional(),
  characteristics: z.record(z.any()).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "FULL", "INACTIVE"]).default("ACTIVE"),
});
export const locationUpdateSchema = locationSchema.partial().omit({ zoneId: true, aisle: true, rack: true, level: true, position: true });

export const dockSchema = z.object({
  warehouseId: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(["RECEIVING", "SHIPPING"]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const dockUpdateSchema = dockSchema.partial().omit({ warehouseId: true });

export const suggestLocationSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().positive(),
  preferredType: z.enum(["PICKING", "RESERVE", "CROSS_DOCK"]).default("RESERVE"),
});
