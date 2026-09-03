import { NextFunction, Request, Response } from "express";
import { ZodTypeAny } from "zod";
import { ValidationError } from "@/common/errors";

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError("Dados inválidos.", result.error.flatten());
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new ValidationError("Parâmetros de consulta inválidos.", result.error.flatten());
    }
    req.query = result.data as never;
    next();
  };
}
