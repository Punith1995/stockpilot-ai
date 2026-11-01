import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { recordError } from "./recent-errors.js";

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Last-resort error handler. Never returns stack traces or secrets. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
    return;
  }
  if (err instanceof AppError) {
    if (err.status >= 500) recordError({ at: new Date().toISOString(), status: err.status, code: err.code, path: req.path, message: err.message });
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  logger.error({ path: req.path, err: err instanceof Error ? err.message : String(err) }, "unhandled error");
  recordError({ at: new Date().toISOString(), status: 500, code: "INTERNAL", path: req.path, message: "Something went wrong on the server" });
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on the server" } });
}
