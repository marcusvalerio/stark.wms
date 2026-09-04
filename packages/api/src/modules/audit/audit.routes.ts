import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";
import { validateQuery } from "@/common/validate";
import { paginationSchema, paginatedResult, toSkipTake } from "@/common/pagination";

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission(PERMISSIONS.AUDIT_READ));

const auditQuerySchema = paginationSchema.extend({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().optional(),
});

auditRouter.get(
  "/",
  validateQuery(auditQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof auditQuerySchema>;
    const where = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, matricula: true } } },
        orderBy: { createdAt: "desc" },
        ...toSkipTake(query),
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json(paginatedResult(items, total, query));
  })
);
