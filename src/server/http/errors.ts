import "server-only";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new ApiError(403, "forbidden", message);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, "conflict", message, details);
export const tooManyRequests = (message = "Too many requests. Please wait and try again.") =>
  new ApiError(429, "rate_limited", message);
export const precondition = (message: string, details?: unknown) =>
  new ApiError(412, "precondition_failed", message, details);
