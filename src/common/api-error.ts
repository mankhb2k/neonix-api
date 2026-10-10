import { HttpException } from "@nestjs/common";

// Keeps the exact same wire shape every route already used pre-Nest
// (`{ error: { message, code?, details? } }`) so existing API consumers/
// tests don't see a breaking response-shape change just because the
// framework changed. `details` is optional, structured extra context (e.g.
// compiler diagnostics) - most callers never pass it.
export class ApiError extends HttpException {
  constructor(status: number, message: string, code?: string, details?: unknown) {
    const error: { message: string; code?: string; details?: unknown } = { message };
    if (code) error.code = code;
    if (details !== undefined) error.details = details;
    super({ error }, status);
  }
}
