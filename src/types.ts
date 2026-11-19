export interface ScriptData {
  ver?: string;
  key?: number;
  dvc?: string;
  din?: number[];
}

export interface WebSensorParams {
  /** Target page URL. */
  url: string;
  /** The exact User-Agent your HTTP client sends to the target. */
  userAgent: string;
  /** Current cookies from the target, e.g. `_abck=...; bm_sz=...`. */
  cookies?: string;
  /** Step of the sequence: 0, 1, 2. Default 0. */
  index?: number;
  /** Pins consecutive calls to the same session. Required for index > 0. */
  sessionId?: string;
  /** `_abck` value, instead of `cookies`. */
  abck?: string;
  /** `bm_sz` value, instead of `cookies`. */
  bmSz?: string;
  /** Explicit script constants, e.g. the result of `web.parse()`. */
  scriptData?: ScriptData;
  /** URL path of the site's Akamai script. */
  scriptUrl?: string;
  /** Accept-Language to model. */
  language?: string;
}

export interface WebSensor {
  /** Post this exact string as the body of the site's sensor script path. */
  sensor: string;
  index: number;
  sessionId?: string;
  /** Generation time in milliseconds. */
  ms?: number;
  raw: Record<string, unknown>;
}

export interface SbsdParams {
  vid: string;
  bmO: string;
  t?: string;
  userAgent?: string;
  url?: string;
  language?: string;
  index?: number;
}

export interface Sbsd {
  /** Base64 body to post to the site's sbsd endpoint. */
  body: string;
  index: number;
  vid?: string;
  raw: Record<string, unknown>;
}

export interface SecCptParams {
  /** The `sec_cpt` cookie/token from the challenge. */
  cookie: string;
  nonce?: string;
  difficulty?: number;
  count?: number;
  timestamp?: number;
}

export interface SecCpt {
  answers: number[];
  count: number;
  attempts?: number;
  raw: Record<string, unknown>;
}

export interface PixelParams {
  bazadebezolkohpepadr: string;
  hash: string;
  userAgent?: string;
}

export interface Pixel {
  /** URL-encoded payload to post to the site's pixel endpoint. */
  payload: string;
  raw: Record<string, unknown>;
}

export interface ParsedScript extends ScriptData {
  din: number[];
  raw: Record<string, unknown>;
}

export interface BmpCookie {
  name: string;
  value: string;
  domain?: string;
}

export interface BmpSensorParams {
  /** Target application name (e.g. `smiles`, `azul`) or package identifier. */
  app: string;
  /** Optional proxy URL (e.g. `http://user:pass@host:port`). */
  proxy?: string;
  /** Device language hint, e.g. `pt-BR`. */
  language?: string;
  /** Optional session identifier. */
  sessionId?: string;
  /** Optional stable device UUID. */
  deviceId?: string;
}

export interface BmpSensor {
  /** Send as the `x-acf-sensor-data` header. */
  sensor: string;
  deviceId?: string;
  platform?: string;
  android?: string;
  sdkVersion?: string;
  appVersion?: string;
  appVersionCode?: number;
  deviceModel?: string;
  deviceManufacturer?: string;
  screenWidth?: number;
  screenHeight?: number;
  language?: string;
  sessionId?: string;
  latencyMs?: number;
  cookies?: BmpCookie[];
  /** Headers ready to spread into your request (sensor and optional Cookie header). */
  headers: Record<string, string>;
  raw: Record<string, unknown>;
}
