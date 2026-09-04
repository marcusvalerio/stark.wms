import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { decideInspectionSchema, openInspectionSchema } from "@/modules/quality/quality.schema";
import * as qualityService from "@/modules/quality/quality.service";

export const qualityRouter = Router();
qualityRouter.use(requireAuth, requirePermission(PERMISSIONS.QUALITY_MANAGE));

qualityRouter.get("/", validateQuery(paginationSchema.extend({ status: z.string().optional() })), asyncHandler(async (req, res) => res.json(await qualityService.list(req.query as never))));
qualityRouter.post("/", validateBody(openInspectionSchema), asyncHandler(async (req, res) => res.status(201).json(await qualityService.open(req.user!, req.body))));
qualityRouter.post("/:id/start", asyncHandler(async (req, res) => res.json(await qualityService.startInspection(req.user!, req.params.id))));
qualityRouter.post("/:id/decide", validateBody(decideInspectionSchema), asyncHandler(async (req, res) => res.json(await qualityService.decide(req.user!, req.params.id, req.body))));
