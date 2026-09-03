import { NextFunction, Request, Response } from "express";
import { AppError } from "@/common/errors";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: (err as { details?: unknown }).details },
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message: `Rota não encontrada: ${req.method} ${req.path}` } });
}
