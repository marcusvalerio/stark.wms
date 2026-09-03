import { z } from "zod";

export const createUserSchema = z.object({
  matricula: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  roleCode: z.enum(["ADMIN", "MANAGER", "SUPERVISOR", "OPERATOR", "CHECKER", "SHIPPING"]),
  shift: z.string().optional(),
  authorizedZones: z.array(z.string()).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleCode: z.enum(["ADMIN", "MANAGER", "SUPERVISOR", "OPERATOR", "CHECKER", "SHIPPING"]).optional(),
  shift: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  operatorStatus: z.enum(["AVAILABLE", "BUSY", "PAUSED", "OFFLINE"]).optional(),
  authorizedZones: z.array(z.string()).optional(),
});
