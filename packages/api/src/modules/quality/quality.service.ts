import { QualityStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { NotFoundError } from "@/common/errors";
import { StateMachine, guardedTransition } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { PaginationQuery, paginatedResult, toSkipTake } from "@/common/pagination";
import { z } from "zod";
import { decideInspectionSchema, openInspectionSchema } from "@/modules/quality/quality.schema";
import * as engine from "@/modules/inventory/inventory.engine";

// Section 24: quarantined stock can never be used for picking — enforced
// structurally because quarantineStock() moves units out of qtyAvailable,
// which is the only bucket the Allocation Engine reads from.
export const qualityStateMachine = new StateMachine<QualityStatus>("Inspeção de Qualidade", {
  PENDING: ["INSPECTING", "APPROVED", "REJECTED"],
  INSPECTING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
});

export async function list(query: PaginationQuery & { status?: QualityStatus }) {
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    prisma.qualityInspection.findMany({
      where,
      include: { product: { select: { sku: true, description: true } }, lot: { select: { code: true } }, location: { select: { fullCode: true } }, inspector: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      ...toSkipTake(query),
    }),
    prisma.qualityInspection.count({ where }),
  ]);
  return paginatedResult(items, total, query);
}

export async function open(actor: AuthUser, data: z.infer<typeof openInspectionSchema>) {
  return prisma.$transaction(async (tx) => {
    await engine.quarantineStock(tx, {
      type: "QUARANTINE",
      productId: data.productId,
      lotId: data.lotId,
      qty: data.qty,
      fromLocationId: data.locationId,
      userId: actor.id,
      reason: data.notes,
      refType: data.refType,
      refId: data.refId,
    });
    if (data.lotId) {
      await tx.lot.update({ where: { id: data.lotId }, data: { status: "QUARANTINE" } });
    }
    const inspection = await tx.qualityInspection.create({
      data: { refType: data.refType, refId: data.refId, productId: data.productId, lotId: data.lotId, locationId: data.locationId, qty: data.qty, notes: data.notes, status: "PENDING" },
    });
    await writeAudit(tx, actor, { action: "OPEN", entityType: "QualityInspection", entityId: inspection.id, newValue: { productId: data.productId, qty: data.qty } });
    return inspection;
  });
}

export async function startInspection(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const inspection = await tx.qualityInspection.findUnique({ where: { id } });
    if (!inspection) throw new NotFoundError("Inspeção", id);
    qualityStateMachine.assertCanTransition(inspection.status, "INSPECTING");
    await guardedTransition(tx.qualityInspection, id, inspection.status, { status: "INSPECTING", inspectorId: actor.id });
    const updated = await tx.qualityInspection.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "START", entityType: "QualityInspection", entityId: id, newValue: { status: "INSPECTING" } });
    return updated;
  });
}

export async function decide(actor: AuthUser, id: string, data: z.infer<typeof decideInspectionSchema>) {
  return prisma.$transaction(async (tx) => {
    const inspection = await tx.qualityInspection.findUnique({ where: { id } });
    if (!inspection) throw new NotFoundError("Inspeção", id);
    qualityStateMachine.assertCanTransition(inspection.status, data.result);
    if (!inspection.locationId || !inspection.qty) throw new NotFoundError("Localização/quantidade da inspeção", id);

    // Guarded first, with the real final state: two concurrent decide()
    // calls (e.g. APPROVED and REJECTED submitted moments apart) must not
    // both proceed to release the same quarantined qty back into
    // circulation.
    await guardedTransition(tx.qualityInspection, id, inspection.status, {
      status: data.result, result: data.result, notes: data.notes, decidedAt: new Date(), inspectorId: inspection.inspectorId ?? actor.id,
    });

    await engine.releaseFromQuarantine(tx, {
      type: "RELEASE",
      productId: inspection.productId,
      lotId: inspection.lotId,
      qty: inspection.qty,
      fromLocationId: inspection.locationId,
      userId: actor.id,
      reason: data.notes,
      refType: "QualityInspection",
      refId: id,
      toBlocked: data.result === "REJECTED",
    });

    if (inspection.lotId) {
      await tx.lot.update({ where: { id: inspection.lotId }, data: { status: data.result === "APPROVED" ? "ACTIVE" : "BLOCKED" } });
    }

    const updated = await tx.qualityInspection.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "DECIDE", entityType: "QualityInspection", entityId: id, newValue: { result: data.result } });
    return updated;
  });
}
