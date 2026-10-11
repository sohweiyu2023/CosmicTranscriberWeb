export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorToSafeJson(error, requestId) {
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      requestId
    };
  }
  return { ok: false, error: { code: "internal_error", message: "The request could not be completed." }, requestId };
}
