// Generate an Akamai BMP sensor and print the headers to attach.
//
//   npm install veilroute
//   VEILROUTE_KEY=... node bmp-sensor.mjs com.example.app
//
// Send the request itself with an OkHttp TLS fingerprint (e.g. tlsclientwrapper).
import { VeilRoute } from 'veilroute';

const app = process.argv[2] ?? 'com.example.app';
const bmp = await new VeilRoute().bmp.sensor({ app });

console.log(`sensor generated in ${bmp.latencyMs} ms (SDK ${bmp.sdkVersion})`);
console.log({ ...bmp.headers, 'user-agent': 'okhttp/4.12.0', accept: 'application/json' });
