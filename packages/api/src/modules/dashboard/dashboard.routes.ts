import { Router } from "express";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import * as dashboardService from "@/modules/dashboard/dashboard.service";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requirePermission(PERMISSIONS.DASHBOARD_READ));

dashboardRouter.get("/snapshot", asyncHandler(async (_req, res) => res.json(await dashboardService.operationalSnapshot())));
dashboardRouter.get("/control-tower", asyncHandler(async (_req, res) => res.json(await dashboardService.controlTower())));
