import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody } from "@/common/validate";
import { createShipmentSchema } from "@/modules/shipping/shipping.schema";
import * as shippingService from "@/modules/shipping/shipping.service";

export const shippingRouter = Router();
shippingRouter.use(requireAuth, requirePermission(PERMISSIONS.SHIPPING_MANAGE));

shippingRouter.get("/", asyncHandler(async (_req, res) => res.json(await shippingService.list())));
shippingRouter.get("/:id", asyncHandler(async (req, res) => res.json(await shippingService.get(req.params.id))));
shippingRouter.post("/", validateBody(createShipmentSchema), asyncHandler(async (req, res) => res.status(201).json(await shippingService.create(req.user!, req.body))));
shippingRouter.post("/:id/assign-dock", validateBody(z.object({ dockId: z.string().min(1) })), asyncHandler(async (req, res) => res.json(await shippingService.assignDock(req.user!, req.params.id, req.body.dockId))));
shippingRouter.post("/:id/load", asyncHandler(async (req, res) => res.json(await shippingService.load(req.user!, req.params.id))));
shippingRouter.post("/:id/ship", asyncHandler(async (req, res) => res.json(await shippingService.ship(req.user!, req.params.id))));
