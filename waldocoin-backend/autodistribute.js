import * as xrpl from 'xrpl'
import { logPresalePurchase } from './routes/presale.js'
import dotenv from 'dotenv'
import fs from 'fs'
import { redis, connectRedis } from './redisClient.js'

dotenv.config()

const requiredVars = ['DISTRIBUTOR_WALLET', 'DISTRIBUTOR_SECRET', 'WALDO_ISSUER', 'XRPL_NODE']
for (const v of requiredVars) {
  if (!process.env[v]) throw new Error(`❌ Missing required env variable: ${v}`)
}

await connectRedis()

const client = new xrpl.Client(process.env.XRPL_NODE)
await client.connect()

const DISTRIBUTOR_WALLET = process.env.DISTRIBUTOR_WALLET
const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET
const WALDO_ISSUER = process.env.WALDO_ISSUER
const WALDO_CURRENCY = 'WLO'

redis.on('error', (err) => {
  console.error('🚨 Redis error:', err)
})

function calculateWaldoAmount(xrpAmount) {
  const baseWaldo = xrpAmount * 100000
  let bonus = 0

  if (xrpAmount >= 100) bonus = 5000000
  else if (xrpAmount >= 90) bonus = 3000000
  else if (xrpAmount >= 80) bonus = 2000000

  const totalWaldo = baseWaldo + bonus
  return {
    totalWaldo,
    bonusPercent: bonus > 0 ? (bonus / baseWaldo) * 100 : 0
  }
}

async function sendWaldo(destination, waldoAmount, retries = 3) {
  const wallet = xrpl.Wallet.fromSeed(DISTRIBUTOR_SECRET)

  const payment = {
    TransactionType: 'Payment',
    Account: wallet.classicAddress,
    Destination: destination,
    Amount: {
      currency: WALDO_CURRENCY,
      value: (waldoAmount / 1_000_000).toFixed(6),
      issuer: WALDO_ISSUER
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const prepared = await client.autofill(payment)
      const signed = wallet.sign(prepared)
      const tx = await client.submitAndWait(signed.tx_blob)

      if (tx.result.meta.TransactionResult === 'tesSUCCESS') {
        console.log(`✅ WALDO Sent! TX Hash: ${tx.result.tx_json.hash}`)
        return tx.result.tx_json.hash
      } else {
        throw new Error(`XRPL TX failed: ${tx.result.meta.TransactionResult}`)
      }
    } catch (error) {
      console.error(`⚠️ Attempt ${attempt} failed: ${error.message}`)
      if (attempt === retries) throw error
      await new Promise(res => setTimeout(res, 2000 * attempt))
    }
  }
}

async function monitorTransactions() {
  await client.request({
    command: 'subscribe',
    accounts: [DISTRIBUTOR_WALLET]
  })

  console.log(`📡 Listening for XRP sent to: ${DISTRIBUTOR_WALLET}`)

  client.on('transaction', async (event) => {
    try {
      const tx = event.transaction

      if (
        tx.TransactionType === 'Payment' &&
        tx.Destination === DISTRIBUTOR_WALLET &&
        typeof tx.Amount === 'string'
      ) {
        const txHash = tx.hash

        const alreadyProcessed = await redis.get(`processed:${txHash}`)
        if (alreadyProcessed) {
          console.log(`⚡ Already processed TX: ${txHash}`)
          return
        }

        const xrpAmount = parseFloat(tx.Amount) / 1_000_000
        const senderWallet = tx.Account

        if (xrpAmount >= 10) {
          const { totalWaldo, bonusPercent } = calculateWaldoAmount(xrpAmount)

          try {
            const sendHash = await sendWaldo(senderWallet, totalWaldo)

            await redis.set(`processed:${txHash}`, '1')
            fs.appendFileSync('processed-log.txt', `${txHash}\n`)
            logPresalePurchase(senderWallet, xrpAmount, totalWaldo, bonusPercent)

            console.log(`🎯 Sent ${totalWaldo} WALDO to ${senderWallet} (Bonus: ${bonusPercent.toFixed(2)}%)`)
          } catch (err) {
            console.error(`❌ Error sending WALDO to ${senderWallet}:`, err.message)
          }
        } else {
          console.log(`⚠️ Ignored: ${xrpAmount} XRP from ${senderWallet} < 10 XRP threshold`)
        }
      }
    } catch (error) {
      console.error(`🚨 Listener Error: ${error.message}`)
    }
  })
}

await monitorTransactions().catch(console.error)

process.on("SIGINT", async () => {
  console.log("\n👋 Shutting down WALDO distributor gracefully...")
  try {
    await client.disconnect()
    await redis.quit()
    console.log("🔌 XRPL and Redis clients disconnected cleanly.")
  } catch (err) {
    console.error("❌ Disconnect failed:", err.message)
  }
  process.exit()
})

