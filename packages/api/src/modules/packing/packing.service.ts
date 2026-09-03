import { prisma } from "@/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/common/errors";
import { StateMachine } from "@/common/state-machine";
import { PackageStatus } from "@prisma/client";
import { AuthUser } from "@/common/auth-middleware";
import { writeAudit } from "@/common/audit";
import { z } from "zod";
import { addPackageItemSchema, closePackageSchema, createPackageSchema } from "@/modules/packing/packing.schema";
import { orderStateMachine } from "@/modules/orders/order.service";

export const packageStateMachine = new StateMachine<PackageStatus>("Volume", {
  OPEN: ["CLOSED"],
  CLOSED: ["SHIPPED"],
  SHIPPED: [],
});

export async function listByOrder(orderId: string) {
  return prisma.package.findMany({ where: { orderId }, include: { items: { include: { orderItem: { include: { product: true } } } } }, orderBy: { createdAt: "asc" } });
}

// Section 25: PICKING -> CONFERÊNCIA -> PACKING. A package can only be
// opened once the order has cleared conference.
export async function createPackage(actor: AuthUser, data: z.infer<typeof createPackageSchema>) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: data.orderId } });
    if (!order) throw new NotFoundError("Pedido", data.orderId);
    if (order.status === "CONFERENCE") {
      orderStateMachine.assertCanTransition(order.status, "PACKING");
      await tx.order.update({ where: { id: order.id }, data: { status: "PACKING" } });
    } else if (order.status !== "PACKING") {
      throw new ValidationError("Pedido precisa estar em CONFERÊNCIA ou PACKING para criar volumes.");
    }
    const created = await tx.package.create({ data: { orderId: data.orderId, code: data.code } });
    await writeAudit(tx, actor, { action: "CREATE", entityType: "Package", entityId: created.id, newValue: { orderId: data.orderId, code: data.code } });
    return created;
  });
}

export async function addItem(actor: AuthUser, packageId: string, data: z.infer<typeof addPackageItemSchema>) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundError("Volume", packageId);
    if (pkg.status !== "OPEN") throw new ConflictError("Volume não está aberto.");

    const orderItem = await tx.orderItem.findUnique({ where: { id: data.orderItemId }, include: { packageItems: true } });
    if (!orderItem || orderItem.orderId !== pkg.orderId) throw new NotFoundError("Item do pedido", data.orderItemId);

    const alreadyPacked = orderItem.packageItems.reduce((sum, pi) => sum + pi.qty, 0);
    if (alreadyPacked + data.qty > orderItem.qtyPicked) {
      throw new ValidationError(`Quantidade supera o separado para este item (separado ${orderItem.qtyPicked}, já embalado ${alreadyPacked}).`);
    }

    const created = await tx.packageItem.create({ data: { packageId, orderItemId: data.orderItemId, qty: data.qty } });
    await writeAudit(tx, actor, { action: "ADD_ITEM", entityType: "Package", entityId: packageId, newValue: { orderItemId: data.orderItemId, qty: data.qty } });
    return created;
  });
}

export async function closePackage(actor: AuthUser, packageId: string, data: z.infer<typeof closePackageSchema>) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({ where: { id: packageId }, include: { items: true } });
    if (!pkg) throw new NotFoundError("Volume", packageId);
    packageStateMachine.assertCanTransition(pkg.status, "CLOSED");
    if (pkg.items.length === 0) throw new ValidationError("Volume não possui itens.");

    const updated = await tx.package.update({ where: { id: packageId }, data: { ...data, status: "CLOSED", closedAt: new Date() } });
    await writeAudit(tx, actor, { action: "CLOSE", entityType: "Package", entityId: packageId, newValue: data });
    return updated;
  });
}

/** Section 25/26 gate: every picked unit must be packed and every package closed before an order can move to staging. */
export async function sendToStaging(actor: AuthUser, orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { packageItems: true } } } });
    if (!order) throw new NotFoundError("Pedido", orderId);
    orderStateMachine.assertCanTransition(order.status, "STAGING");

    const packages = await tx.package.findMany({ where: { orderId } });
    if (packages.length === 0) throw new ValidationError("Pedido não possui volumes.");
    const openPackages = packages.filter((p) => p.status === "OPEN");
    if (openPackages.length > 0) throw new ValidationError(`Existem ${openPackages.length} volume(s) ainda aberto(s).`);

    for (const item of order.items) {
      const packed = item.packageItems.reduce((sum, pi) => sum + pi.qty, 0);
      if (packed < item.qtyPicked) {
        throw new ValidationError(`Item não totalmente embalado: faltam ${item.qtyPicked - packed} unidade(s).`);
      }
    }

    const updated = await tx.order.update({ where: { id: orderId }, data: { status: "STAGING" } });
    await writeAudit(tx, actor, { action: "SEND_TO_STAGING", entityType: "Order", entityId: orderId, newValue: { status: "STAGING" } });
    return updated;
  });
}
