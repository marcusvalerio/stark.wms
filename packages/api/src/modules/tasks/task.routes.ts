import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import * as taskService from "@/modules/tasks/task.service";

export const taskRouter = Router();
taskRouter.use(requireAuth);

const taskQuerySchema = paginationSchema.extend({
  type: z.enum(["RECEIVING", "CONFERENCE", "PUTAWAY", "PICKING", "REPLENISHMENT", "TRANSFER", "COUNT", "SHIPPING"]).optional(),
  status: z.enum(["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  assignedToId: z.string().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]).optional(),
  refType: z.string().optional(),
  refId: z.string().optional(),
  receiptId: z.string().optional(),
});

taskRouter.get(
  "/",
  requirePermission(PERMISSIONS.TASK_READ),
  validateQuery(taskQuerySchema),
  asyncHandler(async (req, res) => res.json(await taskService.listTasks(req.query as never)))
);

taskRouter.get(
  "/my",
  requirePermission(PERMISSIONS.TASK_EXECUTE),
  validateQuery(taskQuerySchema),
  asyncHandler(async (req, res) => res.json(await taskService.listTasks({ ...(req.query as Record<string, unknown>), assignedToId: req.user!.id } as never)))
);

taskRouter.get("/:id", requirePermission(PERMISSIONS.TASK_READ), asyncHandler(async (req, res) => {
  res.json(await taskService.getTask(req.params.id));
}));

taskRouter.post(
  "/:id/assign",
  requirePermission(PERMISSIONS.TASK_ASSIGN),
  validateBody(z.object({ userId: z.string().min(1) })),
  asyncHandler(async (req, res) => res.json(await taskService.assignTask(req.user!, req.params.id, req.body.userId)))
);

taskRouter.post(
  "/:id/start",
  requirePermission(PERMISSIONS.TASK_EXECUTE),
  asyncHandler(async (req, res) => res.json(await taskService.startTask(req.user!, req.params.id, req.user!.id)))
);

taskRouter.post(
  "/:id/cancel",
  requirePermission(PERMISSIONS.TASK_ASSIGN),
  validateBody(z.object({ reason: z.string().min(1) })),
  asyncHandler(async (req, res) => res.json(await taskService.cancelTask(req.user!, req.params.id, req.body.reason)))
);
