import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors.js";

/** Requires X-Admin-Token. Fails closed when ADMIN_TOKEN is not configured. */
export function requireAdmin(expected: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!expected) return next(new AppError(503, "ADMIN_NOT_CONFIGURED", "ADMIN_TOKEN is not set on the server; this action is disabled"));
    const got = Buffer.from(req.header("x-admin-token") ?? "");
    const want = Buffer.from(expected);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return next(new AppError(401, "UNAUTHORIZED", "Admin token required"));
    next();
  };
}
