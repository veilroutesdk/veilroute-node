import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APIConnectionError,
  APIStatusError,
  AuthenticationError,
  BadGatewayError,
  InsufficientBalanceError,
  MissingAPIKeyError,
  PermissionDeniedError,
  RateLimitError,
  RequestTimeoutError,
  ServiceUnavailableError,
  UnsupportedTargetError,
  VeilRoute,
  abckIsValid,
} from '../src/index.js';

type Call = { url: string; init: RequestInit };

function mock(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    return handler(c);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

const ENV = ['VEILROUTE_KEY', 'VEILROUTE_API_KEY', 'VEILROUTE_WEB_KEY', 'VEILROUTE_BMP_KEY', 'VEILROUTE_WEB_URL', 'VEILROUTE_BMP_URL'];

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});
afterEach(() => vi.useRealTimers());

// run a promise while flushing backoff timers
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const out = p.finally(() => (done = true));
  out.catch(() => {}); // the caller asserts on it; avoid an unhandled-rejection report meanwhile
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return out;
}

describe('web', () => {
  it('sensor sends the documented body and parses the result', async () => {
    const { fetch, calls } = mock(() => json(200, { status: 'success', sensor: '3;0;1;abc', index: 1, session_id: 's1', ms: 210 }));
    const c = new VeilRoute({ apiKey: 'k_web', fetch });
    const out = await c.web.sensor({ url: 'https://www.example.com/', userAgent: 'UA/1', cookies: '_abck=x; bm_sz=y', index: 1, sessionId: 's1' });

    expect(out).toMatchObject({ sensor: '3;0;1;abc', index: 1, sessionId: 's1', ms: 210 });
    expect(calls[0].url).toBe('https://web.veilroute.dev/api/v1/sensor');
    expect(hdr(calls[0], 'x-api-key')).toBe('k_web');
    expect(hdr(calls[0], 'user-agent')).toMatch(/^veilroute-node\//);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      url: 'https://www.example.com/',
      userAgent: 'UA/1',
      index: 1,
      session_id: 's1',
      cookies: '_abck=x; bm_sz=y',
    });
  });

  it('parse sends raw text and its result feeds sensor', async () => {
    const { fetch, calls } = mock((c) =>
      c.url.endsWith('/parse')
        ? json(200, { ver: 'v1', key: 42, dvc: 'a+b+', din: [2, 0, 1] })
        : json(200, { status: 'success', sensor: 's', index: 0 }),
    );
    const c = new VeilRoute({ apiKey: 'k', fetch });
    const data = await c.web.parse('var x = 1;');
    expect(hdr(calls[0], 'content-type')).toMatch(/^text\/plain/);
    expect(calls[0].init.body).toBe('var x = 1;');
    await c.web.sensor({ url: 'https://e.com/', userAgent: 'UA', scriptData: data });
    expect(JSON.parse(calls[1].init.body as string).scriptData).toEqual({ ver: 'v1', key: 42, dvc: 'a+b+', din: [2, 0, 1] });
  });

  it('sbsd, secCpt and pixel', async () => {
    const { fetch } = mock((c) => {
      const b = JSON.parse(c.init.body as string);
      if (c.url.endsWith('/sbsd')) {
        expect(b).toEqual({ vid: 'v', bm_o: 'o', index: 0 });
        return json(200, { body: 'MTt2', index: 0, vid: 'v' });
      }
      if (c.url.endsWith('/sec-cpt')) {
        expect(b).toEqual({ cookie: 'c', difficulty: 2000, count: 3 });
        return json(200, { answers: [1, 2, 3], count: 3, attempts: 99 });
      }
      expect(b).toEqual({ bazadebezolkohpepadr: 'id', hash: 'h' });
      return json(200, { sensor: 'p=1', payload: 'p=1' });
    });
    const c = new VeilRoute({ apiKey: 'k', fetch });
    expect((await c.web.sbsd({ vid: 'v', bmO: 'o' })).body).toBe('MTt2');
    expect(await c.web.secCpt({ cookie: 'c', difficulty: 2000, count: 3 })).toMatchObject({ answers: [1, 2, 3], attempts: 99 });
    expect((await c.web.pixel({ bazadebezolkohpepadr: 'id', hash: 'h' })).payload).toBe('p=1');
  });
});

describe('bmp', () => {
  it('uses the bmp host and its own key', async () => {
    const { fetch, calls } = mock(() =>
      json(200, { sensor: '1.70~4~x', deviceId: 'd1', platform: 'android', android: '14', sdkVersion: '1.0.0', latencyMs: 42 }),
    );
    const c = new VeilRoute({ webApiKey: 'k_web', bmpApiKey: 'k_bmp', fetch });
    const out = await c.bmp.sensor({ app: 'com.example.app' });
    expect(calls[0].url).toBe('https://bmp.veilroute.dev/api/v1/sensor');
    expect(hdr(calls[0], 'x-api-key')).toBe('k_bmp');
    expect(out).toMatchObject({ deviceId: 'd1', sdkVersion: '1.0.0', latencyMs: 42, headers: { 'x-acf-sensor-data': '1.70~4~x' } });
  });
});

describe('errors and retries', () => {
  it.each([
    [401, AuthenticationError],
    [402, InsufficientBalanceError],
    [403, PermissionDeniedError],
    [422, UnsupportedTargetError],
  ])('%i is typed and not retried', async (status, Cls) => {
    const { fetch, calls } = mock(() => json(status, { error: 'request failed', code: 'denied_code', request_id: 'vr_123' }));
    const c = new VeilRoute({ apiKey: 'k', fetch });
    const err = await c.bmp.sensor({ app: 'a' }).catch((e) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err.status).toBe(status);
    expect(err.code).toBe('denied_code');
    expect(err.requestId).toBe('vr_123');
    expect(calls).toHaveLength(1);
  });

  it('maps 408 and 502 to RequestTimeoutError and BadGatewayError', async () => {
    const { fetch: fetch408 } = mock(() => json(408, { error: 'timeout', code: 'challenge_timeout', retryable: true, request_id: 'vr_408' }));
    const err408 = await new VeilRoute({ apiKey: 'k', fetch: fetch408, maxRetries: 0 }).web.secCpt({ cookie: 'c' }).catch((e) => e);
    expect(err408).toBeInstanceOf(RequestTimeoutError);
    expect(err408.code).toBe('challenge_timeout');
    expect(err408.retryable).toBe(true);

    const { fetch: fetch502 } = mock(() => json(502, { error: 'proxy failed', code: 'proxy_connection_failed', param: 'proxy', retryable: true, request_id: 'vr_502' }));
    const err502 = await new VeilRoute({ apiKey: 'k', fetch: fetch502, maxRetries: 0 }).bmp.sensor({ app: 'azul' }).catch((e) => e);
    expect(err502).toBeInstanceOf(BadGatewayError);
    expect(err502.code).toBe('proxy_connection_failed');
    expect(err502.param).toBe('proxy');
    expect(err502.requestId).toBe('vr_502');
  });

  it('retries 429 then succeeds', async () => {
    const responses = [json(429, { error: 'request failed' }, { 'retry-after': '1' }), json(200, { sensor: 'ok' })];
    const { fetch, calls } = mock(() => responses.shift()!);
    const c = new VeilRoute({ apiKey: 'k', fetch });
    expect((await settle(c.bmp.sensor({ app: 'a' }))).sensor).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('gives up after maxRetries', async () => {
    const { fetch, calls } = mock(() => json(503, { error: 'request failed' }));
    const c = new VeilRoute({ apiKey: 'k', fetch, maxRetries: 2 });
    await expect(settle(c.bmp.sensor({ app: 'a' }))).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toHaveLength(3);
  });

  it('throws RateLimitError when retries are off', async () => {
    const { fetch } = mock(() => json(429, { error: 'request failed' }));
    const c = new VeilRoute({ apiKey: 'k', fetch, maxRetries: 0 });
    await expect(c.bmp.sensor({ app: 'a' })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('wraps network errors after retrying', async () => {
    const { fetch, calls } = mock(() => {
      throw new TypeError('fetch failed');
    });
    const c = new VeilRoute({ apiKey: 'k', fetch, maxRetries: 1 });
    await expect(settle(c.bmp.sensor({ app: 'a' }))).rejects.toBeInstanceOf(APIConnectionError);
    expect(calls).toHaveLength(2);
  });

  it('treats status:"error" bodies as errors', async () => {
    const { fetch } = mock(() => json(200, { status: 'error', err: 'x' }));
    const c = new VeilRoute({ apiKey: 'k', fetch, maxRetries: 0 });
    await expect(c.web.sensor({ url: 'https://e.com/', userAgent: 'UA' })).rejects.toBeInstanceOf(APIStatusError);
  });

  it('fails before any request when the key is missing', async () => {
    const { fetch, calls } = mock(() => json(200, {}));
    const c = new VeilRoute({ bmpApiKey: 'k_bmp', fetch });
    await expect(c.web.sensor({ url: 'https://e.com/', userAgent: 'UA' })).rejects.toBeInstanceOf(MissingAPIKeyError);
    expect(calls).toHaveLength(0);
  });
});

describe('config', () => {
  it('reads keys and base URLs from env', async () => {
    process.env.VEILROUTE_KEY = 'k_env';
    process.env.VEILROUTE_BMP_URL = 'http://localhost:9999/';
    const { fetch, calls } = mock(() => json(200, { sensor: 's' }));
    await new VeilRoute({ fetch }).bmp.sensor({ app: 'a' });
    expect(calls[0].url).toBe('http://localhost:9999/api/v1/sensor');
    expect(hdr(calls[0], 'x-api-key')).toBe('k_env');
  });

  it('never serializes the key', () => {
    const c = new VeilRoute({ apiKey: 'super_secret_key', fetch: (() => {}) as never });
    expect(JSON.stringify(c)).not.toContain('super_secret_key');
  });

  it('abckIsValid', () => {
    expect(abckIsValid('ABC~0~-1~-1')).toBe(true);
    expect(abckIsValid('ABC~-1~-1~-1')).toBe(false);
    expect(abckIsValid(undefined)).toBe(false);
  });
});
