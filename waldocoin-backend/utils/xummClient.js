import { XummSdk } from 'xumm-sdk';

console.log("XUMM KEY:", process.env.XUMM_API_KEY ? "Loaded" : "MISSING");
console.log("XUMM SECRET:", process.env.XUMM_API_SECRET ? "Loaded" : "MISSING");

let xummClient = null;

// Only initialize XUMM if we have valid API keys (not dummy values)
const hasValidKeys = process.env.XUMM_API_KEY &&
                     process.env.XUMM_API_SECRET &&
                     !process.env.XUMM_API_KEY.startsWith('00000000');

if (hasValidKeys) {
  try {
    xummClient = new XummSdk(
      process.env.XUMM_API_KEY,
      process.env.XUMM_API_SECRET,
      'mainnet'
    );
    console.log('✅ XUMM client initialized');
  } catch (error) {
    console.warn('⚠️  XUMM client initialization failed:', error.message);
  }
} else {
  console.warn('⚠️  XUMM client not initialized (missing or dummy API keys) - wallet auth will not work');
}

export { xummClient };

