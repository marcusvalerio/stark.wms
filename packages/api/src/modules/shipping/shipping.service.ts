import { ShipmentStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/common/errors";
import { StateMachine, guardedTransition } from "@/common/state-machine";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { z } from "zod";
import { createShipmentSchema } from "@/modules/shipping/shipping.schema";
import { orderStateMachine } from "@/modules/orders/order.service";

// Section 26: PACKING -> STAGING -> DOCA -> CARREGAMENTO -> EXPEDIDO.
export const shipmentStateMachine = new StateMachine<ShipmentStatus>("Expedição", {
  STAGING: ["DOCK"],
  DOCK: ["LOADING"],
  LOADING: ["SHIPPED"],
  SHIPPED: [],
});

const shipmentInclude = {
  order: { include: { items: true, customer: true } },
  carrier: true,
  dock: true,
  packages: { include: { package: true } },
} as const;

export async function get(id: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id }, include: shipmentInclude });
  if (!shipment) throw new NotFoundError("Expedição", id);
  return shipment;
}

export async function list() {
  return prisma.shipment.findMany({ include: shipmentInclude, orderBy: { createdAt: "desc" } });
}

/** Section 26: "não permitir expedição de pedido que não esteja corretamente conferido" — gated by requiring the order to already be in STAGING (which itself required full conference + packing per packing.service). */
export async function create(actor: AuthUser, data: z.infer<typeof createShipmentSchema>) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: data.orderId } });
    if (!order) throw new NotFoundError("Pedido", data.orderId);
    if (order.status !== "STAGING") {
      throw new ValidationError("Pedido não pode ser expedido porque a conferência/embalagem ainda não foi concluída.");
    }

    const packages = await tx.package.findMany({ where: { orderId: data.orderId, status: "CLOSED" } });
    if (packages.length === 0) throw new ValidationError("Pedido não possui volumes fechados para expedir.");

    const romaneioNumber = `ROM-${Date.now().toString(36).toUpperCase()}`;
    const shipment = await tx.shipment.create({
      data: {
        orderId: data.orderId,
        romaneioNumber,
        carrierId: data.carrierId,
        dockId: data.dockId,
        status: "STAGING",
        packages: { create: packages.map((p) => ({ packageId: p.id })) },
      },
      include: shipmentInclude,
    });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Shipment", entityId: shipment.id, newValue: { orderId: data.orderId, romaneioNumber } });
    return shipment;
  });
}

export async function assignDock(actor: AuthUser, id: string, dockId: string) {
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundError("Expedição", id);
    shipmentStateMachine.assertCanTransition(shipment.status, "DOCK");
    await guardedTransition(tx.shipment, id, shipment.status, { status: "DOCK", dockId });
    const updated = await tx.shipment.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "ASSIGN_DOCK", entityType: "Shipment", entityId: id, newValue: { dockId } });
    return updated;
  });
}

export async function load(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundError("Expedição", id);
    shipmentStateMachine.assertCanTransition(shipment.status, "LOADING");
    await guardedTransition(tx.shipment, id, shipment.status, { status: "LOADING", loadedAt: new Date() });
    const updated = await tx.shipment.findUniqueOrThrow({ where: { id } });

    const order = await tx.order.findUniqueOrThrow({ where: { id: shipment.orderId } });
    orderStateMachine.assertCanTransition(order.status, "READY");
    await guardedTransition(tx.order, order.id, order.status, { status: "READY" });

    await writeAudit(tx, actor, { action: "LOAD", entityType: "Shipment", entityId: id, newValue: { status: "LOADING" } });
    return updated;
  });
}

export async function ship(actor: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id }, include: { order: { include: { items: true } } } });
    if (!shipment) throw new NotFoundError("Expedição", id);
    shipmentStateMachine.assertCanTransition(shipment.status, "SHIPPED");
    if (shipment.order.status !== "READY") {
      throw new ConflictError("Pedido precisa estar PRONTO (carregado na doca) antes de expedir.");
    }

    // Guarded first: two concurrent "expedir" calls must not both proceed
    // to double-write qtyShipped and create duplicate SHIP movements below.
    await guardedTransition(tx.shipment, id, shipment.status, { status: "SHIPPED", shippedAt: new Date() });

    for (const item of shipment.order.items) {
      await tx.orderItem.update({ where: { id: item.id }, data: { qtyShipped: item.qtyPicked } });
      if (item.qtyPicked > 0) {
        await tx.movement.create({
          data: {
            type: "SHIP",
            productId: item.productId,
            qty: item.qtyPicked,
            userId: actor.id,
            refType: "Shipment",
            refId: id,
            reason: `Expedição ${shipment.romaneioNumber}`,
          },
        });
      }
    }
    orderStateMachine.assertCanTransition(shipment.order.status, "SHIPPED");
    await tx.order.update({ where: { id: shipment.order.id }, data: { status: "SHIPPED" } });

    const updated = await tx.shipment.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, { action: "SHIP", entityType: "Shipment", entityId: id, newValue: { status: "SHIPPED", romaneioNumber: shipment.romaneioNumber } });
    return updated;
  });
}
