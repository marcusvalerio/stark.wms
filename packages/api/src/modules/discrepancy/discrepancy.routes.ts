import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import * as discrepancyService from "@/modules/discrepancy/discrepancy.service";

export const discrepancyRouter = Router();
discrepancyRouter.use(requireAuth);

const queryScheme = paginationSchema.extend({
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "CANCELLED"]).optional(),
  type: z.enum(["SHORTAGE", "OVERAGE", "WRONG_PRODUCT", "WRONG_LOT", "EXPIRY", "DAMAGE", "DOCUMENT", "ADDRESS"]).optional(),
  refType: z.string().optional(),
});

discrepancyRouter.get("/", requirePermission(PERMISSIONS.DISCREPANCY_READ), validateQuery(queryScheme), asyncHandler(async (req, res) => {
  res.json(await discrepancyService.list(req.query as never));
}));

discrepancyRouter.get("/:id", requirePermission(PERMISSIONS.DISCREPANCY_READ), asyncHandler(async (req, res) => {
  res.json(await discrepancyService.get(req.params.id));
}));

discrepancyRouter.post("/:id/review", requirePermission(PERMISSIONS.DISCREPANCY_RESOLVE), asyncHandler(async (req, res) => {
  res.json(await discrepancyService.review(req.user!, req.params.id));
}));

discrepancyRouter.post(
  "/:id/resolve",
  requirePermission(PERMISSIONS.DISCREPANCY_RESOLVE),
  validateBody(z.object({ action: z.string().min(1), notes: z.string().min(1) })),
  asyncHandler(async (req, res) => res.json(await discrepancyService.resolve(req.user!, req.params.id, req.body)))
);

discrepancyRouter.post(
  "/:id/cancel",
  requirePermission(PERMISSIONS.DISCREPANCY_RESOLVE),
  validateBody(z.object({ reason: z.string().min(1) })),
  asyncHandler(async (req, res) => res.json(await discrepancyService.cancel(req.user!, req.params.id, req.body.reason)))
);
