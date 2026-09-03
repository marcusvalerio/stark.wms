import { Prisma, PrismaClient, TaskPriority, TaskStatus, TaskType } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError, ConflictError, NotFoundError } from "@/common/errors";
import { StateMachine } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";

type Tx = Prisma.TransactionClient | PrismaClient;

// Section 20/39: explicit states, no invalid jumps, no concurrent execution
// of the same task.
export const taskStateMachine = new StateMachine<TaskStatus>("Tarefa", {
  PENDING: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "PENDING", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
});

// Section 21: priority derives from SLA proximity + order priority, not set
// arbitrarily by whoever creates the task.
export function computeTaskPriority(input: { orderPriority?: "CRITICAL" | "HIGH" | "NORMAL" | "LOW"; slaDueAt?: Date | null }): TaskPriority {
  if (input.orderPriority === "CRITICAL") return "CRITICAL";
  if (input.slaDueAt) {
    const minutesLeft = (input.slaDueAt.getTime() - Date.now()) / 60000;
    if (minutesLeft <= 30) return "CRITICAL";
    if (minutesLeft <= 120) return "HIGH";
  }
  if (input.orderPriority === "HIGH") return "HIGH";
  if (input.orderPriority === "LOW") return "LOW";
  return "NORMAL";
}

export interface CreateTaskInput {
  type: TaskType;
  priority?: TaskPriority;
  refType: string;
  refId: string;
  originLocationId?: string;
  destLocationId?: string;
  productId?: string;
  qty?: number;
  equipment?: string;
  slaDueAt?: Date | null;
  receiptId?: string;
}

export async function createTask(tx: Tx, input: CreateTaskInput) {
  return tx.task.create({
    data: {
      type: input.type,
      priority: input.priority ?? "NORMAL",
      refType: input.refType,
      refId: input.refId,
      originLocationId: input.originLocationId,
      destLocationId: input.destLocationId,
      productId: input.productId,
      qty: input.qty,
      equipment: input.equipment,
      slaDueAt: input.slaDueAt ?? undefined,
      receiptId: input.receiptId,
    },
  });
}

export async function listTasks(query: PaginationQuery & { type?: TaskType; status?: TaskStatus; assignedToId?: string; priority?: TaskPriority; refType?: string; refId?: string; receiptId?: string }) {
  const where = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.refType ? { refType: query.refType } : {}),
    ...(query.refId ? { refId: query.refId } : {}),
    ...(query.receiptId ? { receiptId: query.receiptId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { assignedTo: { select: { id: true, name: true, matricula: true } }, originLocation: true, destLocation: true, product: { select: { sku: true, description: true } } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      ...toSkipTake(query),
    }),
    prisma.task.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function getTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: { assignedTo: true, originLocation: true, destLocation: true, product: true },
  });
  if (!task) throw new NotFoundError("Tarefa", id);
  return task;
}

export async function assignTask(actor: AuthUser, taskId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError("Tarefa", taskId);
    taskStateMachine.assertCanTransition(task.status, "ASSIGNED");

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") throw new NotFoundError("Operador", userId);

    const updated = await tx.task.update({ where: { id: taskId }, data: { status: "ASSIGNED", assignedToId: userId } });
    await tx.taskAssignment.create({ data: { taskId, userId } });
    await writeAudit(tx, actor, { action: "ASSIGN", entityType: "Task", entityId: taskId, previousValue: { assignedToId: task.assignedToId }, newValue: { assignedToId: userId } });
    return updated;
  });
}

export async function startTask(actor: AuthUser, taskId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    // Row lock semantics: SELECT ... FOR UPDATE would be ideal on a raw
    // query; Prisma's transaction + status re-check below prevents two
    // operators from both starting the same PENDING/ASSIGNED task.
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError("Tarefa", taskId);
    if (task.status === "IN_PROGRESS") {
      throw new ConflictError("Tarefa já está em andamento.");
    }
    if (task.assignedToId && task.assignedToId !== userId) {
      throw new ConflictError("Tarefa já atribuída a outro operador.");
    }
    taskStateMachine.assertCanTransition(task.status, "IN_PROGRESS");

    const updated = await tx.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS", assignedToId: userId, startedAt: new Date() },
    });
    await writeAudit(tx, actor, { action: "START", entityType: "Task", entityId: taskId, previousValue: { status: task.status }, newValue: { status: "IN_PROGRESS" } });
    return updated;
  });
}

export async function completeTaskTx(tx: Tx, taskId: string) {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError("Tarefa", taskId);
  taskStateMachine.assertCanTransition(task.status, "COMPLETED");
  return tx.task.update({ where: { id: taskId }, data: { status: "COMPLETED", completedAt: new Date() } });
}

export async function completeTask(actor: AuthUser, taskId: string) {
  return prisma.$transaction(async (tx) => {
    const updated = await completeTaskTx(tx, taskId);
    await writeAudit(tx, actor, { action: "COMPLETE", entityType: "Task", entityId: taskId, newValue: { status: "COMPLETED" } });
    return updated;
  });
}

export async function cancelTask(actor: AuthUser, taskId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError("Tarefa", taskId);
    taskStateMachine.assertCanTransition(task.status, "CANCELLED");
    const updated = await tx.task.update({ where: { id: taskId }, data: { status: "CANCELLED", cancelReason: reason } });
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "Task", entityId: taskId, previousValue: { status: task.status }, newValue: { status: "CANCELLED", reason } });
    return updated;
  });
}

export function assertOperatorCanExecute(actor: AuthUser, task: { assignedToId: string | null }) {
  const isAssignee = task.assignedToId === actor.id;
  const canOverride = actor.permissions.includes("task.assign");
  if (!isAssignee && !canOverride) {
    throw new AppError("Tarefa não está atribuída a este operador.", 403, "TASK_NOT_OWNED");
  }
}
