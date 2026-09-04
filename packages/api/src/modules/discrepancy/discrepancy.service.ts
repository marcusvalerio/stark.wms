import { DiscrepancyStatus, DiscrepancyType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { NotFoundError } from "@/common/errors";
import { StateMachine, guardedTransition } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";

type Tx = Prisma.TransactionClient | PrismaClient;

// Section 10: divergences are never silently auto-corrected — every one is
// recorded and must move through this explicit state machine to close.
export const discrepancyStateMachine = new StateMachine<DiscrepancyStatus>("Divergência", {
  OPEN: ["IN_REVIEW", "RESOLVED", "CANCELLED"],
  IN_REVIEW: ["RESOLVED", "CANCELLED"],
  RESOLVED: [],
  CANCELLED: [],
});

export interface RaiseDiscrepancyInput {
  type: DiscrepancyType;
  refType: string;
  refId: string;
  productId?: string;
  expectedQty?: number;
  actualQty?: number;
  description: string;
  createdById: string;
}

export async function raiseDiscrepancy(tx: Tx, input: RaiseDiscrepancyInput) {
  return tx.discrepancy.create({ data: { ...input, status: "OPEN" } });
}

export async function list(query: PaginationQuery & { status?: DiscrepancyStatus; type?: DiscrepancyType; refType?: string }) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.refType ? { refType: query.refType } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.discrepancy.findMany({
      where,
      include: { product: { select: { sku: true, description: true } }, createdBy: { select: { name: true } }, resolvedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(query),
    }),
    prisma.discrepancy.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function get(id: string) {
  const discrepancy = await prisma.discrepancy.findUnique({
    where: { id },
    include: { product: true, createdBy: { select: { name: true } }, resolvedBy: { select: { name: true } } },
  });
  if (!discrepancy) throw new NotFoundError("Divergência", id);
  return discrepancy;
}

export async function review(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const discrepancy = await tx.discrepancy.findUnique({ where: { id } });
    if (!discrepancy) throw new NotFoundError("Divergência", id);
    discrepancyStateMachine.assertCanTransition(discrepancy.status, "IN_REVIEW");
    await guardedTransition(tx.discrepancy, id, discrepancy.status, { status: "IN_REVIEW" });
    const updated = await tx.discrepancy.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "REVIEW", entityType: "Discrepancy", entityId: id, previousValue: { status: discrepancy.status }, newValue: { status: "IN_REVIEW" } });
    return updated;
  });
}

export async function resolve(actor: AuthUser, id: string, input: { action: string; notes: string }) {
  return prisma.$transaction(async (tx) => {
    const discrepancy = await tx.discrepancy.findUnique({ where: { id } });
    if (!discrepancy) throw new NotFoundError("Divergência", id);
    discrepancyStateMachine.assertCanTransition(discrepancy.status, "RESOLVED");
    await guardedTransition(tx.discrepancy, id, discrepancy.status, {
      status: "RESOLVED", resolvedById: actor.id, resolvedAt: new Date(), resolutionAction: input.action, resolutionNotes: input.notes,
    });
    const updated = await tx.discrepancy.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, {
      action: "RESOLVE",
      entityType: "Discrepancy",
      entityId: id,
      previousValue: { status: discrepancy.status },
      newValue: { status: "RESOLVED", action: input.action, notes: input.notes, resolvedBy: actor.name },
    });
    return updated;
  });
}

export async function cancel(actor: AuthUser, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const discrepancy = await tx.discrepancy.findUnique({ where: { id } });
    if (!discrepancy) throw new NotFoundError("Divergência", id);
    discrepancyStateMachine.assertCanTransition(discrepancy.status, "CANCELLED");
    await guardedTransition(tx.discrepancy, id, discrepancy.status, { status: "CANCELLED", resolvedById: actor.id, resolvedAt: new Date(), resolutionNotes: reason });
    const updated = await tx.discrepancy.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "CANCEL", entityType: "Discrepancy", entityId: id, previousValue: { status: discrepancy.status }, newValue: { status: "CANCELLED", reason } });
    return updated;
  });
}
