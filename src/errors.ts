/** Base class for every error thrown by the SDK. */
export class VeilRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No API key was configured for the product being called. */
export class MissingAPIKeyError extends VeilRouteError {}

/** The request never got a response (DNS, TLS, connection reset...). */
export class APIConnectionError extends VeilRouteError {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

/** The request timed out. */
export class APITimeoutError extends APIConnectionError {}

/**
 * The API answered with an error status. Messages are intentionally generic,
 * so branch on the class (or `status`), not on `message`.
 */
export class APIStatusError extends VeilRouteError {
  readonly code?: string;
  readonly param?: string;
  readonly retryable?: boolean;
  readonly requestId?: string;

  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    meta?: { code?: string; param?: string; retryable?: boolean; requestId?: string },
  ) {
    super(message);
    if (meta) {
      this.code = meta.code;
      this.param = meta.param;
      this.retryable = meta.retryable;
      this.requestId = meta.requestId;
    }
  }
}

/** 400: the request body was missing or invalid. */
export class BadRequestError extends APIStatusError {}
/** 401: missing or invalid API key, or a key for the other product. */
export class AuthenticationError extends APIStatusError {}
/** 402: the key is valid but has no balance or quota left. */
export class InsufficientBalanceError extends APIStatusError {}
/** 403: request IP is not authorized by the account's IP whitelist. */
export class PermissionDeniedError extends APIStatusError {}
/** 404: unknown path. */
export class NotFoundError extends APIStatusError {}
/** 408: challenge computation timed out. */
export class RequestTimeoutError extends APIStatusError {}
/** 422: the target site or app is not supported. */
export class UnsupportedTargetError extends APIStatusError {}
/** 429: the key's request budget was exceeded. Retried automatically. */
export class RateLimitError extends APIStatusError {}
/** 5xx: the service failed to answer. Retried automatically. */
export class ServerError extends APIStatusError {}
/** 502: client proxy connection failed or upstream gateway unavailable. */
export class BadGatewayError extends ServerError {}
/** 503: the service could not generate a sensor right now. */
export class ServiceUnavailableError extends ServerError {}

type APIErrorConstructor = new (
  m: string,
  s: number,
  b: unknown,
  meta?: { code?: string; param?: string; retryable?: boolean; requestId?: string },
) => APIStatusError;

const BY_STATUS: Record<number, APIErrorConstructor> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: InsufficientBalanceError,
  403: PermissionDeniedError,
  404: NotFoundError,
  408: RequestTimeoutError,
  422: UnsupportedTargetError,
  429: RateLimitError,
  502: BadGatewayError,
  503: ServiceUnavailableError,
};

export function errorForStatus(status: number, body: unknown): APIStatusError {
  let message = 'request failed';
  let meta: { code?: string; param?: string; retryable?: boolean; requestId?: string } | undefined;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const raw = b.error ?? b.err ?? b.message;
    if (typeof raw === 'string' && raw) message = raw;
    meta = {
      code: typeof b.code === 'string' ? b.code : undefined,
      param: typeof b.param === 'string' ? b.param : undefined,
      retryable: typeof b.retryable === 'boolean' ? b.retryable : undefined,
      requestId: typeof b.request_id === 'string' ? b.request_id : undefined,
    };
  }
  const Cls = BY_STATUS[status] ?? (status >= 500 ? ServerError : APIStatusError);
  return new Cls(message, status, body, meta);
}
