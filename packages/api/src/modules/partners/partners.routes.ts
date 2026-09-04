import { Router } from "express";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { carrierSchema, carrierUpdateSchema, customerSchema, customerUpdateSchema, supplierSchema, supplierUpdateSchema } from "@/modules/partners/partners.schema";
import * as partnersService from "@/modules/partners/partners.service";

export const partnersRouter = Router();
partnersRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.MASTER_DATA_READ, PERMISSIONS.MASTER_DATA_MANAGE);
const writePerm = requirePermission(PERMISSIONS.MASTER_DATA_MANAGE);

partnersRouter.get("/suppliers", readPerm, validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  res.json(await partnersService.listSuppliers(req.query as never));
}));
partnersRouter.post("/suppliers", writePerm, validateBody(supplierSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await partnersService.createSupplier(req.user!, req.body));
}));
partnersRouter.patch("/suppliers/:id", writePerm, validateBody(supplierUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await partnersService.updateSupplier(req.user!, req.params.id, req.body));
}));

partnersRouter.get("/customers", readPerm, validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  res.json(await partnersService.listCustomers(req.query as never));
}));
partnersRouter.post("/customers", writePerm, validateBody(customerSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await partnersService.createCustomer(req.user!, req.body));
}));
partnersRouter.patch("/customers/:id", writePerm, validateBody(customerUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await partnersService.updateCustomer(req.user!, req.params.id, req.body));
}));

partnersRouter.get("/carriers", readPerm, validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  res.json(await partnersService.listCarriers(req.query as never));
}));
partnersRouter.post("/carriers", writePerm, validateBody(carrierSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await partnersService.createCarrier(req.user!, req.body));
}));
partnersRouter.patch("/carriers/:id", writePerm, validateBody(carrierUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await partnersService.updateCarrier(req.user!, req.params.id, req.body));
}));
