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

    // Compare-and-swap on the exact status we just validated: if another
    // request mutated this task between our read and this write, the WHERE
    // no longer matches and we lose the race cleanly instead of silently
    // overwriting whatever the winner did.
    const result = await tx.task.updateMany({
      where: { id: taskId, status: task.status },
      data: { status: "ASSIGNED", assignedToId: userId },
    });
    if (result.count === 0) throw new ConflictError("Tarefa foi alterada por outra operação; recarregue e tente novamente.");
    await tx.taskAssignment.create({ data: { taskId, userId } });
    await writeAudit(tx, actor, { action: "ASSIGN", entityType: "Task", entityId: taskId, previousValue: { assignedToId: task.assignedToId }, newValue: { assignedToId: userId } });
    return tx.task.findUniqueOrThrow({ where: { id: taskId } });
  });
}

// Section 20/39 + audit 3.4: two operators must never both succeed in
// starting the same task. The guard below is a compare-and-swap on BOTH the
// status and assignedToId we just read: two concurrent callers can both
// pass the JS-level checks (assignedToId null, status PENDING), but only
// one `updateMany` WHERE clause will still match once Postgres serializes
// the two writes via the row lock — the loser gets count=0 and a
// ConflictError instead of silently reassigning the task out from under
// the winner.
//
// This is a `tx`-scoped helper (not just a thin wrapper called from
// `startTask` below) specifically so domain flows that bump a task to
// IN_PROGRESS as one step inside their own larger transaction (put-away
// execution, replenishment execution) can reuse the *guarded* version
// instead of re-implementing an unconditional `task.update` inline — an
// earlier version of this codebase did exactly that in receiving.service's
// executePutaway, which silently reopened the same race this guard exists
// to close (see docs/AUDIT.md).
export async function startTaskTx(tx: Tx, taskId: string, userId: string, actor?: AuthUser) {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError("Tarefa", taskId);
  if (task.status === "IN_PROGRESS" && task.assignedToId !== userId) {
    throw new ConflictError("Tarefa já está em andamento com outro operador.");
  }
  if (task.assignedToId && task.assignedToId !== userId) {
    throw new ConflictError("Tarefa já atribuída a outro operador.");
  }
  taskStateMachine.assertCanTransition(task.status, "IN_PROGRESS");

  const result = await tx.task.updateMany({
    where: { id: taskId, status: task.status, assignedToId: task.assignedToId },
    data: { status: "IN_PROGRESS", assignedToId: userId, startedAt: task.startedAt ?? new Date() },
  });
  if (result.count === 0) throw new ConflictError("Tarefa já foi iniciada por outro operador.");
  if (actor) {
    await writeAudit(tx, actor, { action: "START", entityType: "Task", entityId: taskId, previousValue: { status: task.status }, newValue: { status: "IN_PROGRESS" } });
  }
  return tx.task.findUniqueOrThrow({ where: { id: taskId } });
}

export async function startTask(actor: AuthUser, taskId: string, userId: string) {
  return prisma.$transaction((tx) => startTaskTx(tx, taskId, userId, actor));
}

export async function completeTaskTx(tx: Tx, taskId: string) {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError("Tarefa", taskId);
  taskStateMachine.assertCanTransition(task.status, "COMPLETED");
  const result = await tx.task.updateMany({
    where: { id: taskId, status: task.status },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (result.count === 0) throw new ConflictError("Tarefa foi concluída ou alterada por outra operação.");
  return tx.task.findUniqueOrThrow({ where: { id: taskId } });
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
    const result = await tx.task.updateMany({
      where: { id: taskId, status: task.status },
      data: { status: "CANCELLED", cancelReason: reason },
    });
    if (result.count === 0) throw new ConflictError("Tarefa foi alterada por outra operação; recarregue e tente novamente.");
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "Task", entityId: taskId, previousValue: { status: task.status }, newValue: { status: "CANCELLED", reason } });
    return tx.task.findUniqueOrThrow({ where: { id: taskId } });
  });
}

export function assertOperatorCanExecute(actor: AuthUser, task: { assignedToId: string | null }) {
  const isAssignee = task.assignedToId === actor.id;
  const canOverride = actor.permissions.includes("task.assign");
  if (!isAssignee && !canOverride) {
    throw new AppError("Tarefa não está atribuída a este operador.", 403, "TASK_NOT_OWNED");
  }
}
