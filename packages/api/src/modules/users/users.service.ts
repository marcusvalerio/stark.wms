import bcrypt from "bcryptjs";
import { prisma } from "@/db/prisma";
import { NotFoundError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { createUserSchema, updateUserSchema } from "@/modules/users/users.schema";

function serialize(user: Awaited<ReturnType<typeof prisma.user.findFirstOrThrow>> & { role: { code: string; name: string } }) {
  return {
    id: user.id,
    matricula: user.matricula,
    name: user.name,
    email: user.email,
    role: user.role.code,
    roleName: user.role.name,
    shift: user.shift,
    status: user.status,
    operatorStatus: user.operatorStatus,
    authorizedZones: user.authorizedZones,
    createdAt: user.createdAt,
  };
}

export async function list(query: PaginationQuery) {
  const where = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" as const } },
          { email: { contains: query.q, mode: "insensitive" as const } },
          { matricula: { contains: query.q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, include: { role: true }, orderBy: { name: "asc" }, ...toSkipTake(query) }),
    prisma.user.count({ where }),
  ]);
  return paginatedResult(items.map(serialize), total, query);
}

export async function create(actor: AuthUser, data: z.infer<typeof createUserSchema>) {
  const role = await prisma.role.findUnique({ where: { code: data.roleCode } });
  if (!role) throw new NotFoundError("Perfil", data.roleCode);
  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        matricula: data.matricula,
        name: data.name,
        email: data.email,
        passwordHash,
        roleId: role.id,
        shift: data.shift,
        authorizedZones: data.authorizedZones,
      },
      include: { role: true },
    });
    await writeAudit(tx, actor, {
      action: "CREATE",
      entityType: "User",
      entityId: created.id,
      newValue: { matricula: created.matricula, name: created.name, role: role.code },
    });
    return created;
  });

  return serialize(user);
}

export async function update(actor: AuthUser, id: string, data: z.infer<typeof updateUserSchema>) {
  const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!existing) throw new NotFoundError("Usuário", id);

  let roleId: string | undefined;
  if (data.roleCode) {
    const role = await prisma.role.findUnique({ where: { code: data.roleCode } });
    if (!role) throw new NotFoundError("Perfil", data.roleCode);
    roleId = role.id;
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.password ? await bcrypt.hash(data.password, 10) : undefined,
        roleId,
        shift: data.shift ?? undefined,
        status: data.status,
        operatorStatus: data.operatorStatus,
        authorizedZones: data.authorizedZones,
      },
      include: { role: true },
    });
    await writeAudit(tx, actor, {
      action: "UPDATE",
      entityType: "User",
      entityId: id,
      previousValue: { name: existing.name, status: existing.status, role: existing.role.code },
      newValue: { name: updated.name, status: updated.status, role: updated.role.code },
    });
    return updated;
  });

  return serialize(user);
}

export async function productivity(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("Usuário", id);

  const [completed, inProgress, delayed] = await Promise.all([
    prisma.task.count({ where: { assignedToId: id, status: "COMPLETED" } }),
    prisma.task.count({ where: { assignedToId: id, status: "IN_PROGRESS" } }),
    prisma.task.count({
      where: { assignedToId: id, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] }, slaDueAt: { lt: new Date() } },
    }),
  ]);

  const completedTasks = await prisma.task.findMany({
    where: { assignedToId: id, status: "COMPLETED", startedAt: { not: null }, completedAt: { not: null } },
    select: { startedAt: true, completedAt: true },
    take: 200,
    orderBy: { completedAt: "desc" },
  });
  const durations = completedTasks
    .filter((t) => t.startedAt && t.completedAt)
    .map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60000);
  const avgMinutes = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return {
    userId: id,
    tasksCompleted: completed,
    tasksInProgress: inProgress,
    tasksDelayed: delayed,
    averageDurationMinutes: Math.round(avgMinutes * 10) / 10,
  };
}
