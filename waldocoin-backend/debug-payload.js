// debug-payload.js
import { XummSdk } from 'xumm-sdk';
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

const uuid = process.argv[2];
if (!uuid) throw new Error('UUID required!');

(async () => {
  const result = await xumm.payload.get(uuid);
  console.log(JSON.stringify(result, null, 2));
})();
