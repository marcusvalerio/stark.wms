import { z } from "zod";

const contactSchema = z.object({ name: z.string(), phone: z.string().optional(), email: z.string().optional() });
const addressSchema = z.object({
  street: z.string().optional(),
  number: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
});

export const supplierSchema = z.object({
  code: z.string().min(1),
  legalName: z.string().min(1),
  cnpj: z.string().min(1),
  contacts: z.array(contactSchema).optional(),
  address: addressSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const supplierUpdateSchema = supplierSchema.partial();

export const customerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  document: z.string().min(1),
  contacts: z.array(contactSchema).optional(),
  address: addressSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const customerUpdateSchema = customerSchema.partial();

export const carrierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  document: z.string().min(1),
  contacts: z.array(contactSchema).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
export const carrierUpdateSchema = carrierSchema.partial();
