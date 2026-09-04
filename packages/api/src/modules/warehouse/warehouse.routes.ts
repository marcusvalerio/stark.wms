import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { dockSchema, locationSchema, locationUpdateSchema, suggestLocationSchema, warehouseSchema, zoneSchema } from "@/modules/warehouse/warehouse.schema";
import * as warehouseService from "@/modules/warehouse/warehouse.service";
import { suggestLocations } from "@/modules/warehouse/rules-engine";

export const warehouseRouter = Router();
warehouseRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.WAREHOUSE_READ, PERMISSIONS.WAREHOUSE_MANAGE);
const writePerm = requirePermission(PERMISSIONS.WAREHOUSE_MANAGE);

warehouseRouter.get("/warehouses", readPerm, asyncHandler(async (_req, res) => res.json(await warehouseService.listWarehouses())));
warehouseRouter.post("/warehouses", writePerm, validateBody(warehouseSchema), asyncHandler(async (req, res) => res.status(201).json(await warehouseService.createWarehouse(req.user!, req.body))));
warehouseRouter.get("/warehouses/:id/map", readPerm, asyncHandler(async (req, res) => res.json(await warehouseService.warehouseMap(req.params.id))));

warehouseRouter.get("/zones", readPerm, asyncHandler(async (req, res) => res.json(await warehouseService.listZones(req.query.warehouseId as string | undefined))));
warehouseRouter.post("/zones", writePerm, validateBody(zoneSchema), asyncHandler(async (req, res) => res.status(201).json(await warehouseService.createZone(req.user!, req.body))));

const locationQuerySchema = paginationSchema.extend({
  zoneId: z.string().optional(),
  type: z.enum(["PICKING", "RESERVE", "RECEIVING", "STAGING", "SHIPPING", "QUARANTINE", "CROSS_DOCK"]).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "FULL", "INACTIVE"]).optional(),
});
warehouseRouter.get("/locations", readPerm, validateQuery(locationQuerySchema), asyncHandler(async (req, res) => res.json(await warehouseService.listLocations(req.query as never))));
warehouseRouter.get("/locations/:id", readPerm, asyncHandler(async (req, res) => res.json(await warehouseService.getLocationDetail(req.params.id))));
warehouseRouter.post("/locations", writePerm, validateBody(locationSchema), asyncHandler(async (req, res) => res.status(201).json(await warehouseService.createLocation(req.user!, req.body))));
warehouseRouter.patch("/locations/:id", writePerm, validateBody(locationUpdateSchema), asyncHandler(async (req, res) => res.json(await warehouseService.updateLocation(req.user!, req.params.id, req.body))));

warehouseRouter.get("/docks", readPerm, asyncHandler(async (req, res) => res.json(await warehouseService.listDocks(req.query.warehouseId as string | undefined))));
warehouseRouter.post("/docks", writePerm, validateBody(dockSchema), asyncHandler(async (req, res) => res.status(201).json(await warehouseService.createDock(req.user!, req.body))));

warehouseRouter.post("/suggest-location", readPerm, validateBody(suggestLocationSchema), asyncHandler(async (req, res) => res.json(await suggestLocations(req.body))));
