import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { categorySchema, categoryUpdateSchema, productSchema, productUpdateSchema, uomSchema, uomUpdateSchema } from "@/modules/catalog/catalog.schema";
import * as catalogService from "@/modules/catalog/catalog.service";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.MASTER_DATA_READ, PERMISSIONS.MASTER_DATA_MANAGE);
const writePerm = requirePermission(PERMISSIONS.MASTER_DATA_MANAGE);

// Categories
catalogRouter.get("/categories", readPerm, validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  res.json(await catalogService.listCategories(req.query as never));
}));
catalogRouter.post("/categories", writePerm, validateBody(categorySchema), asyncHandler(async (req, res) => {
  res.status(201).json(await catalogService.createCategory(req.user!, req.body));
}));
catalogRouter.patch("/categories/:id", writePerm, validateBody(categoryUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await catalogService.updateCategory(req.user!, req.params.id, req.body));
}));

// Units of measure
catalogRouter.get("/uoms", readPerm, validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  res.json(await catalogService.listUoms(req.query as never));
}));
catalogRouter.post("/uoms", writePerm, validateBody(uomSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await catalogService.createUom(req.user!, req.body));
}));
catalogRouter.patch("/uoms/:id", writePerm, validateBody(uomUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await catalogService.updateUom(req.user!, req.params.id, req.body));
}));

// Products
const productQuerySchema = paginationSchema.extend({
  categoryId: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});
catalogRouter.get("/products", readPerm, validateQuery(productQuerySchema), asyncHandler(async (req, res) => {
  res.json(await catalogService.listProducts(req.query as never));
}));
catalogRouter.get("/products/:id", readPerm, asyncHandler(async (req, res) => {
  res.json(await catalogService.getProduct(req.params.id));
}));
catalogRouter.post("/products", writePerm, validateBody(productSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await catalogService.createProduct(req.user!, req.body));
}));
catalogRouter.patch("/products/:id", writePerm, validateBody(productUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await catalogService.updateProduct(req.user!, req.params.id, req.body));
}));
