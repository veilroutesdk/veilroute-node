// Generate the staged Akamai Web sensors for one session.
//
//   npm install veilroute
//   VEILROUTE_KEY=... node web-sensor.mjs https://www.example.com/ "_abck=...; bm_sz=..."
import { randomUUID } from 'node:crypto';
import { VeilRoute } from 'veilroute';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const [url = 'https://www.example.com/', cookies = ''] = process.argv.slice(2);

const client = new VeilRoute();
const sessionId = `sess_${randomUUID().slice(0, 12)}`;

const { sensor, ms } = await client.web.sensor({ url, userAgent: UA, cookies, index: 0, sessionId });
console.log(`index 0: ${sensor.length} chars in ${ms} ms`);
