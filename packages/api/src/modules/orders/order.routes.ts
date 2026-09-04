import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { createOrderSchema } from "@/modules/orders/order.schema";
import * as orderService from "@/modules/orders/order.service";
import * as pickingService from "@/modules/orders/picking.service";

export const orderRouter = Router();
orderRouter.use(requireAuth);

const readPerm = requirePermission(PERMISSIONS.ORDER_READ, PERMISSIONS.ORDER_MANAGE);
const managePerm = requirePermission(PERMISSIONS.ORDER_MANAGE);
const releasePerm = requirePermission(PERMISSIONS.ORDER_RELEASE, PERMISSIONS.ORDER_MANAGE);
const executePerm = requirePermission(PERMISSIONS.TASK_EXECUTE);

const queryScheme = paginationSchema.extend({
  status: z.enum(["RECEIVED", "RELEASED", "ALLOCATED", "PICKING", "PICKED", "CONFERENCE", "PACKING", "STAGING", "READY", "SHIPPED", "CANCELLED"]).optional(),
  customerId: z.string().optional(),
});

orderRouter.get("/", readPerm, validateQuery(queryScheme), asyncHandler(async (req, res) => res.json(await orderService.list(req.query as never))));

orderRouter.get(
  "/picking-tasks",
  executePerm,
  validateQuery(paginationSchema.extend({ status: z.string().optional(), operatorId: z.string().optional(), waveId: z.string().optional(), orderId: z.string().optional() })),
  asyncHandler(async (req, res) => res.json(await pickingService.listPickingTasks(req.query as never)))
);
orderRouter.get(
  "/picking-tasks/my",
  executePerm,
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => res.json(await pickingService.listPickingTasks({ ...(req.query as Record<string, unknown>), operatorId: req.user!.id } as never)))
);
orderRouter.post(
  "/picking-tasks/:id/pick",
  executePerm,
  validateBody(z.object({ qtyPicked: z.number().int().positive() })),
  asyncHandler(async (req, res) => res.json(await pickingService.executePickingTask(req.user!, req.params.id, req.body.qtyPicked)))
);

orderRouter.get("/:id", readPerm, asyncHandler(async (req, res) => res.json(await orderService.get(req.params.id))));
orderRouter.post("/", managePerm, validateBody(createOrderSchema), asyncHandler(async (req, res) => res.status(201).json(await orderService.create(req.user!, req.body))));
orderRouter.post("/:id/release", releasePerm, asyncHandler(async (req, res) => res.json(await orderService.release(req.user!, req.params.id))));
orderRouter.post("/:id/start-picking", releasePerm, asyncHandler(async (req, res) => res.json(await orderService.startPicking(req.user!, req.params.id))));
orderRouter.post("/:id/advance-conference", requirePermission(PERMISSIONS.RECEIVING_CHECK, PERMISSIONS.ORDER_MANAGE), asyncHandler(async (req, res) => res.json(await orderService.advanceToConference(req.user!, req.params.id))));
orderRouter.post("/:id/cancel", managePerm, validateBody(z.object({ reason: z.string().min(1) })), asyncHandler(async (req, res) => res.json(await orderService.cancel(req.user!, req.params.id, req.body.reason))));
