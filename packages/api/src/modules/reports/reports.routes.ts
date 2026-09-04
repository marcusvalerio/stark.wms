import { Router } from "express";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import * as reportsService from "@/modules/reports/reports.service";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission(PERMISSIONS.REPORTS_READ));

reportsRouter.get("/occupancy", asyncHandler(async (_req, res) => res.json(await reportsService.occupancyReport())));
reportsRouter.get("/accuracy", asyncHandler(async (_req, res) => res.json(await reportsService.accuracyReport())));
reportsRouter.get("/productivity", asyncHandler(async (_req, res) => res.json(await reportsService.productivityReport())));
reportsRouter.get("/discrepancies", asyncHandler(async (_req, res) => res.json(await reportsService.discrepancyReport())));
