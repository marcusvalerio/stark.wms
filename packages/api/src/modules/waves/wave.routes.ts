import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateBody, validateQuery } from "@/common/validate";
import { paginationSchema } from "@/common/pagination";
import { createWaveSchema } from "@/modules/waves/wave.schema";
import * as waveService from "@/modules/waves/wave.service";

export const waveRouter = Router();
waveRouter.use(requireAuth, requirePermission(PERMISSIONS.WAVE_MANAGE));

const queryScheme = paginationSchema.extend({ status: z.enum(["CREATED", "RELEASED", "PAUSED", "CANCELLED", "COMPLETED"]).optional() });

waveRouter.get("/", validateQuery(queryScheme), asyncHandler(async (req, res) => res.json(await waveService.list(req.query as never))));
waveRouter.get("/:id", asyncHandler(async (req, res) => res.json(await waveService.get(req.params.id))));
waveRouter.post("/", validateBody(createWaveSchema), asyncHandler(async (req, res) => res.status(201).json(await waveService.create(req.user!, req.body))));
waveRouter.post("/:id/release", asyncHandler(async (req, res) => res.json(await waveService.release(req.user!, req.params.id))));
waveRouter.post("/:id/pause", asyncHandler(async (req, res) => res.json(await waveService.pause(req.user!, req.params.id))));
waveRouter.post("/:id/resume", asyncHandler(async (req, res) => res.json(await waveService.resume(req.user!, req.params.id))));
waveRouter.post("/:id/cancel", asyncHandler(async (req, res) => res.json(await waveService.cancel(req.user!, req.params.id))));
waveRouter.post("/:id/complete", asyncHandler(async (req, res) => res.json(await waveService.complete(req.user!, req.params.id))));
