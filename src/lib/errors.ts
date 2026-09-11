/** Domain error types mapped to HTTP responses by the API layer. */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: string = 'BAD_REQUEST',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string) => new AppError(msg, 400, 'BAD_REQUEST');
export const unauthorized = (msg = 'Authentication required') => new AppError(msg, 401, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError(msg, 403, 'FORBIDDEN');
export const notFound = (msg = 'Resource not found') => new AppError(msg, 404, 'NOT_FOUND');
export const conflict = (msg: string) => new AppError(msg, 409, 'CONFLICT');
/** 422 — semantic errors (invalid state transitions, invalid amounts...). */
export const unprocessable = (msg: string) => new AppError(msg, 422, 'UNPROCESSABLE');
export const tooMany = (msg = 'Too many requests') => new AppError(msg, 429, 'RATE_LIMITED');
