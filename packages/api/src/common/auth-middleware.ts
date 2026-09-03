import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import { ForbiddenError, UnauthorizedError } from "@/common/errors";
import { PermissionCode } from "@/common/permissions";

export interface AuthUser {
  id: string;
  matricula: string;
  name: string;
  email: string;
  roleCode: string;
  permissions: PermissionCode[];
  authorizedZones: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Token de autenticação ausente.");
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthUser;
    req.user = payload;
    next();
  } catch {
    throw new UnauthorizedError("Token inválido ou expirado.");
  }
}

export function requirePermission(...codes: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    const has = codes.some((c) => req.user!.permissions.includes(c));
    if (!has) {
      throw new ForbiddenError(
        `Ação requer permissão: ${codes.join(" ou ")}.`
      );
    }
    next();
  };
}
