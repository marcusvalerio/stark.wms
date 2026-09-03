import { Router } from "express";
import { prisma } from "@/db/prisma";
import { asyncHandler } from "@/common/asyncHandler";
import { requireAuth, requirePermission } from "@/common/auth-middleware";
import { PERMISSIONS } from "@/common/permissions";

export const rolesRouter = Router();

rolesRouter.use(requireAuth);

rolesRouter.get(
  "/",
  requirePermission(PERMISSIONS.ROLES_READ, PERMISSIONS.USERS_MANAGE),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    });
    res.json(
      roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: r.permissions.map((p) => p.permission.code),
      }))
    );
  })
);
