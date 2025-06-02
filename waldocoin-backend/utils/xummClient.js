// utils/xummClient.js
export default async function getXummClient() {
  const { XummSdk } = await import("xumm-sdk");
  const { XUMM_API_KEY, XUMM_API_SECRET } = process.env;

  if (!XUMM_API_KEY || !XUMM_API_SECRET) {
    throw new Error("❌ Missing XUMM credentials");
  }

  return new XummSdk(XUMM_API_KEY, XUMM_API_SECRET);
}

