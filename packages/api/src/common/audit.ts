import { Prisma, PrismaClient } from "@prisma/client";
import { AuthUser } from "@/common/auth-middleware";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function writeAudit(
  tx: Tx,
  user: AuthUser | undefined,
  params: {
    action: string;
    entityType: string;
    entityId: string;
    previousValue?: unknown;
    newValue?: unknown;
  }
) {
  await tx.auditLog.create({
    data: {
      userId: user?.id,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      previousValue: params.previousValue as Prisma.InputJsonValue,
      newValue: params.newValue as Prisma.InputJsonValue,
    },
  });
}
