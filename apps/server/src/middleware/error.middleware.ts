import type { NextFunction, Request, Response } from "express";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ message: "Not found." });
}

// Central error handler. Express recognizes it by its 4-arg signature.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : "Internal server error.";
  console.error("[error]", message);
  if (res.headersSent) return;
  res.status(500).json({ message });
}
