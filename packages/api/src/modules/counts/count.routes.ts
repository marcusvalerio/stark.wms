import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { createCountSchema, recordCountSchema } from "@/modules/counts/count.schema";
import * as countService from "@/modules/counts/count.service";

export const countRouter = Router();
countRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.COUNT_READ, PERMISSIONS.COUNT_MANAGE);
const managePerm = requirePermission(PERMISSIONS.COUNT_MANAGE);
const approvePerm = requirePermission(PERMISSIONS.COUNT_APPROVE);

countRouter.get("/", readPerm, validateQuery(paginationSchema.extend({ status: z.string().optional() })), asyncHandler(async (req, res) => res.json(await countService.list(req.query as never))));
countRouter.get("/:id", readPerm, asyncHandler(async (req, res) => res.json(await countService.get(req.params.id))));
countRouter.post("/", managePerm, validateBody(createCountSchema), asyncHandler(async (req, res) => res.status(201).json(await countService.create(req.user!, req.body))));
countRouter.post("/:id/start", managePerm, asyncHandler(async (req, res) => res.json(await countService.startCounting(req.user!, req.params.id))));
countRouter.post("/:id/items/:itemId/count", managePerm, validateBody(recordCountSchema), asyncHandler(async (req, res) => res.json(await countService.recordCount(req.user!, req.params.id, req.params.itemId, req.body.countedQty, false))));
countRouter.post("/:id/items/:itemId/recount", managePerm, validateBody(recordCountSchema), asyncHandler(async (req, res) => res.json(await countService.recordCount(req.user!, req.params.id, req.params.itemId, req.body.countedQty, true))));
countRouter.post("/:id/complete-counting", managePerm, asyncHandler(async (req, res) => res.json(await countService.completeCounting(req.user!, req.params.id))));
countRouter.post("/:id/start-recount", managePerm, asyncHandler(async (req, res) => res.json(await countService.startRecount(req.user!, req.params.id))));
countRouter.post("/:id/complete-recount", managePerm, asyncHandler(async (req, res) => res.json(await countService.completeRecount(req.user!, req.params.id))));
countRouter.post("/:id/approve", approvePerm, asyncHandler(async (req, res) => res.json(await countService.approve(req.user!, req.params.id))));
countRouter.post("/:id/apply-adjustments", approvePerm, asyncHandler(async (req, res) => res.json(await countService.applyAdjustments(req.user!, req.params.id))));
countRouter.post("/:id/cancel", managePerm, asyncHandler(async (req, res) => res.json(await countService.cancel(req.user!, req.params.id))));
