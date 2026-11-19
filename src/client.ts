import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  MissingAPIKeyError,
  VeilRouteError,
  errorForStatus,
} from './errors.js';
import type {
  BmpSensor,
  BmpSensorParams,
  ParsedScript,
  Pixel,
  PixelParams,
  Sbsd,
  SbsdParams,
  SecCpt,
  SecCptParams,
  WebSensor,
  WebSensorParams,
} from './types.js';
import { VERSION } from './version.js';

export const DEFAULT_WEB_URL = 'https://web.veilroute.dev';
export const DEFAULT_BMP_URL = 'https://bmp.veilroute.dev';

type Product = 'web' | 'bmp';
type Json = Record<string, unknown>;

export interface ClientOptions {
  /** Key for both products. Defaults to `VEILROUTE_KEY`. */
  apiKey?: string;
  /** Akamai Web key. Defaults to `VEILROUTE_WEB_KEY`, then `apiKey`. */
  webApiKey?: string;
  /** Akamai BMP key. Defaults to `VEILROUTE_BMP_KEY`, then `apiKey`. */
  bmpApiKey?: string;
  /** Per-attempt timeout in ms. Default 30000. */
  timeout?: number;
  /** Retries on 429/502/503/504 and network errors. Default 2. */
  maxRetries?: number;
  webBaseURL?: string;
  bmpBaseURL?: string;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string>;
  /** Custom fetch (proxies, tests). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

// Only 200 responses are billed, so retrying these is always safe.
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 30_000;

const env = (name: string): string | undefined => {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = p?.env?.[name];
  return v ? v : undefined;
};

const clean = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const ints = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => int(x) !== undefined) : []);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class VeilRoute {
  readonly web: WebResource;
  readonly bmp: BmpResource;
  readonly timeout: number;
  readonly maxRetries: number;
  #keys: Record<Product, string | undefined>;
  #urls: Record<Product, string>;
  #headers: Record<string, string>;
  #fetch: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    const shared = opts.apiKey ?? env('VEILROUTE_KEY') ?? env('VEILROUTE_API_KEY');
    this.#keys = {
      web: opts.webApiKey ?? env('VEILROUTE_WEB_KEY') ?? shared,
      bmp: opts.bmpApiKey ?? env('VEILROUTE_BMP_KEY') ?? shared,
    };
    this.#urls = {
      web: (opts.webBaseURL ?? env('VEILROUTE_WEB_URL') ?? DEFAULT_WEB_URL).replace(/\/+$/, ''),
      bmp: (opts.bmpBaseURL ?? env('VEILROUTE_BMP_URL') ?? DEFAULT_BMP_URL).replace(/\/+$/, ''),
    };
    this.timeout = opts.timeout ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    if (this.maxRetries < 0) throw new RangeError('maxRetries must be >= 0');
    this.#headers = { ...(opts.defaultHeaders ?? {}) };
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new VeilRouteError('No global fetch found. Use Node.js 18+ or pass { fetch }.');
    this.#fetch = f;
    this.web = new WebResource(this);
    this.bmp = new BmpResource(this);
  }

  /** @internal */
  async _post(product: Product, path: string, body: Json | string): Promise<Json> {
    const key = this.#keys[product];
    if (!key) {
      throw new MissingAPIKeyError(
        `No API key for Akamai ${product.toUpperCase()}. Pass apiKey or set VEILROUTE_KEY (or VEILROUTE_${product.toUpperCase()}_KEY).`,
      );
    }
    const isText = typeof body === 'string';
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': `veilroute-node/${VERSION}`,
      ...this.#headers,
      'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json',
      'x-api-key': key,
    };
    const url = this.#urls[product] + path;
    const payload = isText ? body : JSON.stringify(body);

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      try {
        res = await this.#fetch(url, { method: 'POST', headers, body: payload, signal: ctrl.signal });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt, null));
          continue;
        }
        if (ctrl.signal.aborted) throw new APITimeoutError('request timed out', err);
        throw new APIConnectionError('connection error', err);
      }
      let parsed: unknown;
      try {
        const text = await res.text();
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      } finally {
        clearTimeout(timer);
      }
      if (RETRY_STATUSES.has(res.status) && attempt < this.maxRetries) {
        await sleep(backoff(attempt, res.headers.get('retry-after')));
        continue;
      }
      if (res.status >= 400) throw errorForStatus(res.status, parsed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new APIStatusError('invalid response body', res.status, undefined);
      }
      const json = parsed as Json;
      if (json.status === 'error') throw errorForStatus(503, json);
      return json;
    }
  }

  /** Keys are never included. */
  toJSON() {
    return { products: (Object.keys(this.#keys) as Product[]).filter((p) => this.#keys[p]), maxRetries: this.maxRetries };
  }
}

function backoff(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const s = Number(retryAfter);
    if (Number.isFinite(s)) return Math.min(Math.max(s * 1000, 0), MAX_RETRY_AFTER_MS);
  }
  const base = Math.min(500 * 2 ** attempt, 8000);
  return base * (0.75 + Math.random() * 0.5);
}

/** Akamai Web (Bot Manager v3) endpoints on web.veilroute.dev. */
export class WebResource {
  constructor(private readonly c: VeilRoute) {}

  /** Generate a sensor payload for step `index` (0, 1, 2). */
  async sensor(p: WebSensorParams): Promise<WebSensor> {
    const d = await this.c._post(
      'web',
      '/api/v1/sensor',
      clean({
        url: p.url,
        userAgent: p.userAgent,
        index: p.index ?? 0,
        session_id: p.sessionId,
        cookies: p.cookies,
        _abck: p.abck,
        bm_sz: p.bmSz,
        scriptData: p.scriptData
          ? clean({ ver: p.scriptData.ver, key: p.scriptData.key, dvc: p.scriptData.dvc, din: p.scriptData.din })
          : undefined,
        scriptUrl: p.scriptUrl,
        language: p.language,
      }),
    );
    return { sensor: str(d.sensor) ?? '', index: int(d.index) ?? 0, sessionId: str(d.session_id), ms: int(d.ms), raw: d };
  }

  /** Build the sbsd payload. */
  async sbsd(p: SbsdParams): Promise<Sbsd> {
    const d = await this.c._post(
      'web',
      '/api/v1/sbsd',
      clean({ vid: p.vid, bm_o: p.bmO, t: p.t, userAgent: p.userAgent, url: p.url, language: p.language, index: p.index ?? 0 }),
    );
    return { body: str(d.body) ?? '', index: int(d.index) ?? 0, vid: str(d.vid), raw: d };
  }

  /** Solve a sec-cpt proof-of-work challenge. */
  async secCpt(p: SecCptParams): Promise<SecCpt> {
    const d = await this.c._post(
      'web',
      '/api/v1/sec-cpt',
      clean({ cookie: p.cookie, nonce: p.nonce, difficulty: p.difficulty, count: p.count, timestamp: p.timestamp }),
    );
    const answers = ints(d.answers);
    return { answers, count: int(d.count) ?? answers.length, attempts: int(d.attempts), raw: d };
  }

  /** Build the pixel validation payload. */
  async pixel(p: PixelParams): Promise<Pixel> {
    const d = await this.c._post(
      'web',
      '/api/v1/pixel',
      clean({ bazadebezolkohpepadr: p.bazadebezolkohpepadr, hash: p.hash, userAgent: p.userAgent }),
    );
    return { payload: str(d.payload) ?? str(d.sensor) ?? '', raw: d };
  }

  /** Extract ver, key, dvc and din from a script payload (sent as raw text). */
  async parse(script: string): Promise<ParsedScript> {
    const d = await this.c._post('web', '/api/v1/parse', script);
    return { ver: str(d.ver), key: int(d.key), dvc: str(d.dvc), din: ints(d.din), raw: d };
  }
}

/** Akamai BMP (mobile SDK) endpoints on bmp.veilroute.dev. */
export class BmpResource {
  constructor(private readonly c: VeilRoute) {}

  /** Generate a mobile sensor for the x-acf-sensor-data header. */
  async sensor(p: BmpSensorParams): Promise<BmpSensor> {
    const d = await this.c._post('bmp', '/api/v1/sensor', clean({
      app: p.app,
      proxy: p.proxy,
      language: p.language,
      sessionId: p.sessionId,
      deviceId: p.deviceId,
    }));
    const sensor = str(d.sensor) ?? '';
    const rawCookies = Array.isArray(d.cookies) ? d.cookies : [];
    const cookies = rawCookies.map((c: any) => ({
      name: String(c.name || ''),
      value: String(c.value || ''),
      domain: c.domain ? String(c.domain) : undefined,
    }));
    const headers: Record<string, string> = { 'x-acf-sensor-data': sensor };
    if (cookies.length > 0) {
      headers['cookie'] = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
    }
    return {
      sensor,
      deviceId: str(d.deviceId),
      platform: str(d.platform),
      android: str(d.android),
      sdkVersion: str(d.sdkVersion),
      appVersion: str(d.appVersion),
      appVersionCode: int(d.appVersionCode),
      deviceModel: str(d.deviceModel),
      deviceManufacturer: str(d.deviceManufacturer),
      screenWidth: int(d.screenWidth),
      screenHeight: int(d.screenHeight),
      language: str(d.language),
      sessionId: str(d.sessionId),
      latencyMs: int(d.latencyMs),
      cookies,
      headers,
      raw: d,
    };
  }
}

/** True when an `_abck` cookie value is valid. */
export function abckIsValid(abck: string | null | undefined): boolean {
  return !!abck && abck.includes('~0~');
}
