import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { createUserSchema, updateUserSchema } from "@/modules/users/users.schema";
import * as usersService from "@/modules/users/users.service";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get(
  "/",
  requirePermission(PERMISSIONS.USERS_MANAGE, PERMISSIONS.TASK_ASSIGN),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    res.json(await usersService.list(req.query as never));
  })
);

usersRouter.get(
  "/:id/productivity",
  requirePermission(PERMISSIONS.USERS_MANAGE, PERMISSIONS.TASK_ASSIGN, PERMISSIONS.DASHBOARD_READ),
  asyncHandler(async (req, res) => {
    res.json(await usersService.productivity(req.params.id));
  })
);

usersRouter.post(
  "/",
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await usersService.create(req.user!, req.body));
  })
);

usersRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validateBody(updateUserSchema),
  asyncHandler(async (req, res) => {
    res.json(await usersService.update(req.user!, req.params.id, req.body));
  })
);

usersRouter.patch(
  "/:id/status",
  requirePermission(PERMISSIONS.TASK_ASSIGN, PERMISSIONS.USERS_MANAGE),
  validateBody(z.object({ operatorStatus: z.enum(["AVAILABLE", "BUSY", "PAUSED", "OFFLINE"]) })),
  asyncHandler(async (req, res) => {
    res.json(await usersService.update(req.user!, req.params.id, req.body));
  })
);
