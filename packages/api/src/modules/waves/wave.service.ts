import { WaveStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { NotFoundError, ValidationError } from "@/common/errors";
import { StateMachine, guardedTransition } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { createWaveSchema } from "@/modules/waves/wave.schema";
import { generatePickingTasks } from "@/modules/orders/allocation-engine";
import { orderStateMachine } from "@/modules/orders/order.service";

// Section 18: criar, liberar, pausar, cancelar, concluir onda.
export const waveStateMachine = new StateMachine<WaveStatus>("Onda", {
  CREATED: ["RELEASED", "CANCELLED"],
  RELEASED: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["RELEASED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
});

const waveInclude = {
  orders: { include: { order: { select: { id: true, number: true, status: true, priority: true, customer: { select: { name: true } } } } } },
} as const;

export async function list(query: PaginationQuery & { status?: WaveStatus }) {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.q ? { code: { contains: query.q, mode: "insensitive" as const } } : {}) };
  const [items, total] = await Promise.all([
    prisma.pickWave.findMany({ where, include: waveInclude, orderBy: { createdAt: "desc" }, ...toSkipTake(query) }),
    prisma.pickWave.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function get(id: string) {
  const wave = await prisma.pickWave.findUnique({ where: { id }, include: { ...waveInclude, pickingTasks: true } });
  if (!wave) throw new NotFoundError("Onda", id);
  return wave;
}

export async function create(actor: AuthUser, data: z.infer<typeof createWaveSchema>) {
  const orders = await prisma.order.findMany({ where: { id: { in: data.orderIds } } });
  if (orders.length !== data.orderIds.length) throw new ValidationError("Um ou mais pedidos informados não foram encontrados.");
  const notAllocated = orders.filter((o) => o.status !== "ALLOCATED");
  if (notAllocated.length > 0) {
    throw new ValidationError(`Pedidos precisam estar ALOCADOS para entrar em uma onda: ${notAllocated.map((o) => o.number).join(", ")}`);
  }

  return prisma.$transaction(async (tx) => {
    const wave = await tx.pickWave.create({
      data: { code: data.code, criteria: data.criteria, orders: { create: data.orderIds.map((orderId) => ({ orderId })) } },
      include: waveInclude,
    });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "PickWave", entityId: wave.id, newValue: { code: wave.code, orders: data.orderIds.length } });
    return wave;
  });
}

export async function release(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const wave = await tx.pickWave.findUnique({ where: { id }, include: { orders: true } });
    if (!wave) throw new NotFoundError("Onda", id);
    waveStateMachine.assertCanTransition(wave.status, "RELEASED");
    // Guarded first: two concurrent "liberar onda" calls must not both
    // reach the loop below and each generate a full duplicate set of
    // picking tasks for the same orders.
    await guardedTransition(tx.pickWave, id, wave.status, { status: "RELEASED", releasedAt: new Date() });

    let totalTasks = 0;
    for (const link of wave.orders) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: link.orderId } });
      if (order.status !== "ALLOCATED") continue;
      const tasks = await generatePickingTasks(tx, order.id, id);
      totalTasks += tasks.length;
      orderStateMachine.assertCanTransition(order.status, "PICKING");
      await tx.order.update({ where: { id: order.id }, data: { status: "PICKING" } });
    }

    const updated = await tx.pickWave.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "RELEASE", entityType: "PickWave", entityId: id, newValue: { tasksGenerated: totalTasks } });
    return updated;
  });
}

async function transition(actor: AuthUser, id: string, to: WaveStatus, extra: Record<string, unknown> = {}) {
  return prisma.$transaction(async (tx) => {
    const wave = await tx.pickWave.findUnique({ where: { id } });
    if (!wave) throw new NotFoundError("Onda", id);
    waveStateMachine.assertCanTransition(wave.status, to);
    await guardedTransition(tx.pickWave, id, wave.status, { status: to, ...extra });
    const updated = await tx.pickWave.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: `TRANSITION_${to}`, entityType: "PickWave", entityId: id, previousValue: { status: wave.status }, newValue: { status: to } });
    return updated;
  });
}

export const pause = (actor: AuthUser, id: string) => transition(actor, id, "PAUSED");
export const resume = (actor: AuthUser, id: string) => transition(actor, id, "RELEASED");

export async function cancel(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const wave = await tx.pickWave.findUnique({ where: { id } });
    if (!wave) throw new NotFoundError("Onda", id);
    waveStateMachine.assertCanTransition(wave.status, "CANCELLED");
    await guardedTransition(tx.pickWave, id, wave.status, { status: "CANCELLED" });
    await tx.pickingTask.updateMany({ where: { waveId: id, status: { in: ["PENDING", "ASSIGNED"] } }, data: { status: "CANCELLED" } });
    await tx.task.updateMany({ where: { refType: "PickingTask", refId: { in: (await tx.pickingTask.findMany({ where: { waveId: id }, select: { id: true } })).map((t) => t.id) }, status: { in: ["PENDING", "ASSIGNED"] } }, data: { status: "CANCELLED", cancelReason: "Onda cancelada" } });
    const updated = await tx.pickWave.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "PickWave", entityId: id, newValue: { status: "CANCELLED" } });
    return updated;
  });
}

export async function complete(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const wave = await tx.pickWave.findUnique({ where: { id }, include: { pickingTasks: true } });
    if (!wave) throw new NotFoundError("Onda", id);
    waveStateMachine.assertCanTransition(wave.status, "COMPLETED");
    const pending = wave.pickingTasks.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status));
    if (pending.length > 0) throw new ValidationError(`Ainda existem ${pending.length} tarefa(s) de separação pendente(s) nesta onda.`);
    await guardedTransition(tx.pickWave, id, wave.status, { status: "COMPLETED", completedAt: new Date() });
    const updated = await tx.pickWave.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "COMPLETE", entityType: "PickWave", entityId: id, newValue: { status: "COMPLETED" } });
    return updated;
  });
}
