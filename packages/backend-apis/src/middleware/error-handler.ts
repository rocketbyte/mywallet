import { Request, Response, NextFunction } from 'express';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

/**
 * Terminal error handler. Logs the full error (including stack) server-side
 * only, and returns the standard envelope. In production the body never leaks
 * the raw message for unexpected (5xx) errors — it returns a generic
 * "Something went wrong" — so internal details (paths, driver errors) don't
 * reach clients. Typed errors that set `status`/`statusCode` keep their code
 * and message (those are deliberate, client-facing).
 */
export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  const status = err.status ?? err.statusCode ?? 500;

  if (status >= 500) {
    res.status(status).json({
      error: 'InternalServerError',
      // Surface the real message outside production to aid debugging.
      message: config.isProduction ? 'Something went wrong' : err.message
    });
    return;
  }

  res.status(status).json({
    error: err.name && err.name !== 'Error' ? err.name : 'RequestError',
    message: err.message
  });
}
