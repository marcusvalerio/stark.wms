import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import * as replenishmentService from "@/modules/replenishment/replenishment.service";

export const replenishmentRouter = Router();
replenishmentRouter.use(requireAuth);

replenishmentRouter.get(
  "/",
  requirePermission(PERMISSIONS.TASK_READ),
  validateQuery(paginationSchema.extend({ status: z.string().optional() })),
  asyncHandler(async (req, res) => res.json(await replenishmentService.list(req.query as never)))
);
replenishmentRouter.post("/scan", requirePermission(PERMISSIONS.TASK_ASSIGN), asyncHandler(async (req, res) => res.status(201).json(await replenishmentService.scanReplenishmentNeeds(req.user!))));
replenishmentRouter.post("/:id/execute", requirePermission(PERMISSIONS.TASK_EXECUTE), asyncHandler(async (req, res) => res.json(await replenishmentService.execute(req.user!, req.params.id))));
replenishmentRouter.post("/:id/cancel", requirePermission(PERMISSIONS.TASK_ASSIGN), asyncHandler(async (req, res) => res.json(await replenishmentService.cancel(req.user!, req.params.id))));
