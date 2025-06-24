import { Xumm } from 'xumm-sdk';
import { Client } from 'xrpl';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const XRPL_NODE = 'wss://xrplcluster.com'; // Mainnet
const redis = new Redis(process.env.REDIS_URL);

const client = new Client(XRPL_NODE);
const distributorWallet = process.env.DISTRIBUTOR_WALLET;
const issuerWallet = process.env.ISSUER_WALLET;
const waldoCurrencyCode = 'WLO';

const bonusTiers = [
  { min: 2000, bonus: 0.25 },
  { min: 1000, bonus: 0.20 },
  { min: 500, bonus: 0.15 },
  { min: 250, bonus: 0.10 },
  { min: 100, bonus: 0.05 }
];

// Connect XRPL
await client.connect();
console.log('✅ XRPL connected');

// Subscribe to payment transactions
await client.request({
  command: 'subscribe',
  accounts: [distributorWallet]
});
console.log(`📡 Listening for XRP sent to: ${distributorWallet}`);

client.on('transaction', async (event) => {
  try {
    const tx = event.transaction;
    if (
      tx &&
      tx.TransactionType === 'Payment' &&
      tx.Destination === distributorWallet &&
      tx.Amount &&
      tx.Amount.currency === undefined && // native XRP
      tx.hash
    ) {
      const sender = tx.Account;
      const amountXRP = parseFloat(tx.Amount) / 1_000_000;
      const txHash = tx.hash;

      const alreadyProcessed = await redis.get(`tx:${txHash}`);
      if (alreadyProcessed) {
        console.log(`⚠️ Duplicate tx ignored: ${txHash}`);
        return;
      }

      // Mark tx as processed
      await redis.set(`tx:${txHash}`, '1', 'EX', 86400);

      // Apply bonus
      let bonus = 0;
      for (const tier of bonusTiers) {
        if (amountXRP >= tier.min) {
          bonus = tier.bonus;
          break;
        }
      }

      const baseWaldo = amountXRP * 1000;
      const totalWaldo = Math.floor(baseWaldo * (1 + bonus));

      // Check trustline
      const trustlines = await client.request({
        command: 'account_lines',
        account: sender
      });

      const hasTrustline = trustlines.result.lines.some(
        (line) => line.currency === waldoCurrencyCode && line.account === issuerWallet
      );

      if (!hasTrustline) {
        console.log(`❌ ${sender} has no WLO trustline. Skipping...`);
        return;
      }

      // Send WALDO
      const txPayload = {
        TransactionType: 'Payment',
        Account: distributorWallet,
        Destination: sender,
        Amount: {
          currency: waldoCurrencyCode,
          issuer: issuerWallet,
          value: totalWaldo.toString()
        }
      };

      const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
      const submit = await xumm.payload.createAndSubscribe({
        txjson: txPayload,
        options: { submit: true }
      }, (event) => {
        if (event.data.signed === true) {
          console.log(`✅ WALDO sent to ${sender}: ${totalWaldo}`);
          return true;
        } else {
          console.log(`❌ WALDO not signed by ${sender}`);
          return false;
        }
      });

      await redis.lpush('presale:log', JSON.stringify({
        wallet: sender,
        amountXRP,
        waldo: totalWaldo,
        txHash,
        timestamp: Date.now(),
        id: uuidv4()
      }));

    } else {
      console.log('⚠️ Ignored event - not a valid XRP Payment TX');
    }
  } catch (err) {
    console.error('🔥 Error processing transaction:', err.message);
  }
});
