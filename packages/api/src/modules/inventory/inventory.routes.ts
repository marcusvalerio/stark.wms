import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import * as inventoryService from "@/modules/inventory/inventory.service";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.INVENTORY_READ, PERMISSIONS.INVENTORY_ADJUST);
const adjustPerm = requirePermission(PERMISSIONS.INVENTORY_ADJUST);

const balanceQuerySchema = paginationSchema.extend({
  productId: z.string().optional(),
  locationId: z.string().optional(),
  zoneId: z.string().optional(),
});

inventoryRouter.get("/balances", readPerm, validateQuery(balanceQuerySchema), asyncHandler(async (req, res) => {
  res.json(await inventoryService.listBalances(req.query as never));
}));

inventoryRouter.get("/products/:productId/summary", readPerm, asyncHandler(async (req, res) => {
  res.json(await inventoryService.productStockSummary(req.params.productId));
}));

const movementQuerySchema = paginationSchema.extend({
  productId: z.string().optional(),
  type: z.string().optional(),
  refType: z.string().optional(),
  refId: z.string().optional(),
});
inventoryRouter.get("/movements", readPerm, validateQuery(movementQuerySchema), asyncHandler(async (req, res) => {
  res.json(await inventoryService.listMovements(req.query as never));
}));

const adjustSchema = z.object({ productId: z.string(), locationId: z.string(), lotId: z.string().optional(), finalQty: z.number().int().nonnegative(), reason: z.string().min(1) });
inventoryRouter.post("/adjust", adjustPerm, validateBody(adjustSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await inventoryService.manualAdjust(req.user!, req.body));
}));

const blockSchema = z.object({ productId: z.string(), locationId: z.string(), lotId: z.string().optional(), qty: z.number().int().positive(), reason: z.string().min(1) });
for (const action of ["block", "unblock", "quarantine", "release"] as const) {
  inventoryRouter.post(`/${action}`, adjustPerm, validateBody(blockSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await inventoryService.blockUnblock(req.user!, action.toUpperCase() as never, req.body));
  }));
}
