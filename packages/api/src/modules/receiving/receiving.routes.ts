import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { assignDockSchema, checkItemSchema, createReceiptSchema, executePutawaySchema } from "@/modules/receiving/receiving.schema";
import * as receivingService from "@/modules/receiving/receiving.service";

export const receivingRouter = Router();
receivingRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.RECEIVING_READ, PERMISSIONS.RECEIVING_MANAGE, PERMISSIONS.RECEIVING_CHECK);
const managePerm = requirePermission(PERMISSIONS.RECEIVING_MANAGE);
const checkPerm = requirePermission(PERMISSIONS.RECEIVING_CHECK, PERMISSIONS.RECEIVING_MANAGE);
const putawayPerm = requirePermission(PERMISSIONS.TASK_EXECUTE);

const queryScheme = paginationSchema.extend({
  status: z.enum(["SCHEDULED", "ARRIVED", "AT_DOCK", "IN_CONFERENCE", "CONFERRED", "PUTAWAY", "COMPLETED", "CANCELLED"]).optional(),
  supplierId: z.string().optional(),
});

receivingRouter.get("/", readPerm, validateQuery(queryScheme), asyncHandler(async (req, res) => res.json(await receivingService.list(req.query as never))));
receivingRouter.get("/:id", readPerm, asyncHandler(async (req, res) => res.json(await receivingService.get(req.params.id))));
receivingRouter.post("/", managePerm, validateBody(createReceiptSchema), asyncHandler(async (req, res) => res.status(201).json(await receivingService.create(req.user!, req.body))));

receivingRouter.post("/:id/arrive", managePerm, asyncHandler(async (req, res) => res.json(await receivingService.markArrived(req.user!, req.params.id))));
receivingRouter.post("/:id/assign-dock", managePerm, validateBody(assignDockSchema), asyncHandler(async (req, res) => res.json(await receivingService.assignDock(req.user!, req.params.id, req.body.dockId))));
receivingRouter.post("/:id/start-conference", checkPerm, asyncHandler(async (req, res) => res.json(await receivingService.startConference(req.user!, req.params.id))));
receivingRouter.post(
  "/:id/items/:itemId/check",
  checkPerm,
  validateBody(checkItemSchema),
  asyncHandler(async (req, res) => res.json(await receivingService.checkItem(req.user!, req.params.id, req.params.itemId, req.body)))
);
receivingRouter.post("/:id/complete-conference", checkPerm, asyncHandler(async (req, res) => res.json(await receivingService.completeConference(req.user!, req.params.id))));
receivingRouter.post(
  "/putaway-tasks/:taskId/execute",
  putawayPerm,
  validateBody(executePutawaySchema),
  asyncHandler(async (req, res) => res.json(await receivingService.executePutaway(req.user!, req.params.taskId, req.body.destLocationId)))
);
receivingRouter.post("/:id/cancel", managePerm, validateBody(z.object({ reason: z.string().min(1) })), asyncHandler(async (req, res) => res.json(await receivingService.cancel(req.user!, req.params.id, req.body.reason))));
