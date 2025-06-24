// autodistribute.js

import xrpl from "xrpl"
import Redis from "ioredis"
import { WALDO_ISSUER, WALDO_DISTRIBUTOR } from "./config/waldo.js"
import { sendWaldo } from "./utils/sendWaldo.js"

// 🔐 Load and validate required environment variables
const REQUIRED_ENVS = [
  "DISTRIBUTOR_SECRET",
  "DISTRIBUTOR_WALLET",
  "WALDO_ISSUER",
  "XRPL_NODE",
  "REDIS_URL"
]
for (const v of REQUIRED_ENVS) {
  if (!process.env[v]) throw new Error(`❌ Missing required env variable: ${v}`)
}

const DISTRIBUTOR_WALLET = process.env.DISTRIBUTOR_WALLET
const REDIS_URL = process.env.REDIS_URL

// 🌐 Connect to XRPL and Redis
const client = new xrpl.Client(process.env.XRPL_NODE)
await client.connect()
console.log("✅ XRPL connected")

const redis = new Redis(REDIS_URL)
console.log("✅ Redis connected")

console.log(`📡 Listening for XRP sent to: ${DISTRIBUTOR_WALLET}`)

// 🛰️ Subscribe to XRPL ledger events
client.request({
  command: "subscribe",
  accounts: [DISTRIBUTOR_WALLET]
})

// 🔁 Handle incoming transactions
client.on("transaction", async (event) => {
  const tx = event.transaction

  if (
    tx?.TransactionType === "Payment" &&
    tx.Destination === DISTRIBUTOR_WALLET &&
    (
      typeof tx.Amount === "string" ||
      typeof tx.delivered_amount === "string" ||
      typeof event.meta?.delivered_amount === "string"
    )
  ) {
    const txHash = event.hash || tx.hash
    const alreadyProcessed = await redis.get(`processed:${txHash}`)
    if (alreadyProcessed) {
      console.log(`⚡ Already processed TX: ${txHash}`)
      return
    }

    const amountStr = tx.Amount || tx.delivered_amount || event.meta?.delivered_amount
    const xrpAmount = parseFloat(amountStr) / 1_000_000
    const senderWallet = tx.Account

    console.log(`💸 Received ${xrpAmount} XRP from ${senderWallet}`)

    const bonusMultiplier =
      xrpAmount >= 1000 ? 1.2 :
      xrpAmount >= 500  ? 1.15 :
      xrpAmount >= 250  ? 1.1 :
      xrpAmount >= 100  ? 1.05 : 1

    const waldoAmount = Math.floor(xrpAmount * 1000 * bonusMultiplier)

    try {
      const result = await sendWaldo(senderWallet, waldoAmount)
      if (result.success) {
        await redis.set(`processed:${txHash}`, "1")
        console.log(`✅ Sent ${waldoAmount} WALDO to ${senderWallet}`)
      } else {
        console.error("❌ WALDO send failed:", result)
      }
    } catch (err) {
      console.error("❌ Error in WALDO payout:", err.message)
    }
  } else {
    console.log("⚠️ Ignored non-payment or invalid tx")
  }
})
