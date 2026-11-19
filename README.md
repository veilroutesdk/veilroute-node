<p align="center">
  <a href="https://veilroute.dev"><img src="https://veilroute.dev/favicon.svg" width="64" height="64" alt="VeilRoute"></a>
</p>

<h1 align="center">VeilRoute Node.js SDK</h1>

<p align="center">
  Akamai Bot Manager sensor API for Node.js and TypeScript: <code>sensor_data</code>, <code>sbsd</code>, <code>sec-cpt</code>, pixel and BMP mobile sensors.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/veilroute"><img src="https://img.shields.io/npm/v/veilroute.svg" alt="npm"></a>
  <a href="https://github.com/veilroutesdk/veilroute-node/actions/workflows/ci.yml"><img src="https://github.com/veilroutesdk/veilroute-node/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="Zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

<p align="center">
  <a href="https://veilroute.dev">Website</a> ·
  <a href="https://docs.veilroute.dev">Docs</a> ·
  <a href="https://app.veilroute.dev">Get an API key</a> ·
  <a href="https://discord.gg/YrZAcNWtE">Discord</a>
</p>

---

[VeilRoute](https://veilroute.dev) generates request-ready **Akamai Bot Manager** payloads over HTTP, so you can
get a trusted `_abck` cookie without running a headless browser. This package is the official Node.js client.

- **Akamai Web (v3):** staged `sensor_data` (index 0, 1, 2), `sbsd`, `sec-cpt` proof of work, pixel, script parsing.
- **Akamai BMP:** Mobile sensor API for the `x-acf-sensor-data` header and session cookies.
- Zero dependencies, full TypeScript types, ESM and CommonJS, automatic retries on `503` and network errors.
- You are only billed for sensors that return `200`, so retries are free.

## Install

```bash
npm install veilroute
```

Requires Node.js 18+ (uses the built-in `fetch`). Also runs on Bun and Deno.

## Quickstart

Get a key from the [dashboard](https://app.veilroute.dev) and export it:

```bash
export VEILROUTE_KEY="your-api-key"
```

### Akamai Web: generate sensor

```ts
import { VeilRoute, abckIsValid } from 'veilroute';

const client = new VeilRoute(); // reads VEILROUTE_KEY

const { sensor, ms } = await client.web.sensor({
  url: 'https://www.example.com/',
  userAgent: UA,                       // the exact UA your HTTP client sends
  cookies: '_abck=...; bm_sz=...',     // cookies from your first GET
  index: 0,
  sessionId: 'sess_42',
});

if (abckIsValid(newAbck)) console.log('valid');
```

Repeat with `index: 1` and `index: 2` (same `sessionId`) if the site needs more posts.

### Akamai BMP: mobile sensor

```ts
const bmp = await client.bmp.sensor({ app: 'com.example.app' });

const headers = { ...bmp.headers, 'user-agent': 'okhttp/4.12.0' }; // { 'x-acf-sensor-data': '...' }
```

Send your request with an OkHttp TLS fingerprint.

### CommonJS

```js
const { VeilRoute } = require('veilroute');
```

## All methods

| Method | Endpoint | Returns |
| --- | --- | --- |
| `client.web.sensor({ url, userAgent, cookies?, index?, sessionId?, ... })` | `POST web/api/v1/sensor` | `{ sensor, index, sessionId, ms }` |
| `client.web.sbsd({ vid, bmO, t?, userAgent?, url?, language?, index? })` | `POST web/api/v1/sbsd` | `{ body, index, vid }` |
| `client.web.secCpt({ cookie, nonce?, difficulty?, count?, timestamp? })` | `POST web/api/v1/sec-cpt` | `{ answers, count, attempts }` |
| `client.web.pixel({ bazadebezolkohpepadr, hash, userAgent? })` | `POST web/api/v1/pixel` | `{ payload }` |
| `client.web.parse(script)` | `POST web/api/v1/parse` | `{ ver, key, dvc, din }` |
| `client.bmp.sensor({ app, language? })` | `POST bmp/api/v1/sensor` | `{ sensor, headers, deviceId, sdkVersion, ... }` |

Every result keeps the full JSON in `.raw`. Field-by-field reference: [docs.veilroute.dev](https://docs.veilroute.dev).

## Configuration

```ts
const client = new VeilRoute({
  apiKey: '...',        // or VEILROUTE_KEY
  webApiKey: '...',     // optional, per product (or VEILROUTE_WEB_KEY)
  bmpApiKey: '...',     // optional, per product (or VEILROUTE_BMP_KEY)
  timeout: 30_000,      // ms, per attempt
  maxRetries: 2,        // 502, 503, 504 and network errors, exponential backoff
  fetch: customFetch,   // optional: undici dispatcher, proxies, tests
});
```

Keys are **per product**: an Akamai Web key does not work on BMP. Keep keys server-side, never in a browser bundle.

## Errors

```ts
import { InsufficientBalanceError, VeilRouteError } from 'veilroute';

try {
  await client.web.sensor({ url, userAgent: UA });
} catch (err) {
  if (err instanceof InsufficientBalanceError) { /* 402: top up at app.veilroute.dev */ }
  else if (err instanceof VeilRouteError) { /* base class for everything */ }
}
```

| Error | Status |
| --- | --- |
| `BadRequestError` | 400 |
| `AuthenticationError` | 401 |
| `InsufficientBalanceError` | 402 |
| `NotFoundError` | 404 |
| `UnsupportedTargetError` | 422 |
| `ServiceUnavailableError` / `ServerError` | 503 / 5xx |
| `APIConnectionError` / `APITimeoutError` | network |
| `MissingAPIKeyError` | no key configured |

## Your TLS fingerprint still matters

The sensor is half of the story. Akamai also reads your TLS ClientHello and header order, so send your own
request with a client that impersonates **Chrome** (Web) or **OkHttp** (BMP), such as
[`tlsclientwrapper`](https://www.npmjs.com/package/tlsclientwrapper). See
[HTTP client & TLS](https://docs.veilroute.dev/http-client).

## Other SDKs

- Python: [veilroutesdk/veilroute-python](https://github.com/veilroutesdk/veilroute-python)
- Go: [veilroutesdk/veilroute-go](https://github.com/veilroutesdk/veilroute-go)

## License

[MIT](LICENSE)
