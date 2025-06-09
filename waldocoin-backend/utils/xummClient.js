import { XummSdk } from 'xumm-sdk'
import dotenv from 'dotenv'

dotenv.config()

let xummClient = null

export function getXummClient() {
  if (!xummClient) {
    const { XUMM_API_KEY, XUMM_API_SECRET } = process.env

    if (!XUMM_API_KEY || !XUMM_API_SECRET) {
      throw new Error('❌ Missing XUMM_API_KEY or XUMM_API_SECRET in environment variables')
    }

    console.log('🧪 Instantiating XUMM SDK...')
    xummClient = new XummSdk(XUMM_API_KEY, XUMM_API_SECRET)
    console.log('✅ XUMM Client loaded')
  }

  return xummClient
}

console.log('🧩 xummClient.js initialized 🔍')
