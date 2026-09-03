import { Router } from "express";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody } from "@/common/validate";
import { addPackageItemSchema, closePackageSchema, createPackageSchema } from "@/modules/packing/packing.schema";
import * as packingService from "@/modules/packing/packing.service";

export const packingRouter = Router();
packingRouter.use(requireAuth, requirePermission(PERMISSIONS.PACKING_MANAGE));

packingRouter.get("/orders/:orderId/packages", asyncHandler(async (req, res) => res.json(await packingService.listByOrder(req.params.orderId))));
packingRouter.post("/packages", validateBody(createPackageSchema), asyncHandler(async (req, res) => res.status(201).json(await packingService.createPackage(req.user!, req.body))));
packingRouter.post("/packages/:id/items", validateBody(addPackageItemSchema), asyncHandler(async (req, res) => res.status(201).json(await packingService.addItem(req.user!, req.params.id, req.body))));
packingRouter.post("/packages/:id/close", validateBody(closePackageSchema), asyncHandler(async (req, res) => res.json(await packingService.closePackage(req.user!, req.params.id, req.body))));
packingRouter.post("/orders/:orderId/send-to-staging", asyncHandler(async (req, res) => res.json(await packingService.sendToStaging(req.user!, req.params.orderId))));
