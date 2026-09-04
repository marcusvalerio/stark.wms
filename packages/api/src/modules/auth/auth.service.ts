import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/db/prisma";
import { env } from "@/config/env";
import { UnauthorizedError } from "@/common/errors";
import { AuthUser } from "@/common/auth-middleware";
import { PermissionCode } from "@/common/permissions";

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new UnauthorizedError("Usuário não encontrado ou inativo.");
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Senha inválida.");
  }

  const permissions = user.role.permissions.map((rp) => rp.permission.code) as PermissionCode[];

  const authUser: AuthUser = {
    id: user.id,
    matricula: user.matricula,
    name: user.name,
    email: user.email,
    roleCode: user.role.code,
    permissions,
    authorizedZones: user.authorizedZones,
  };

  const token = jwt.sign(authUser, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });

  await prisma.user.update({ where: { id: user.id }, data: { operatorStatus: "AVAILABLE" } });

  return { token, user: authUser };
}

export async function me(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: true },
  });
  return {
    id: user.id,
    matricula: user.matricula,
    name: user.name,
    email: user.email,
    role: user.role.code,
    shift: user.shift,
    status: user.status,
    operatorStatus: user.operatorStatus,
    authorizedZones: user.authorizedZones,
  };
}
