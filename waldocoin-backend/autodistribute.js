import 'dotenv/config';
import { Client, xrpToDrops } from 'xrpl';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

const requiredEnv = [
  'DISTRIBUTOR_WALLET',
  'DISTRIBUTOR_SECRET',
  'WALDO_ISSUER',
  'REDIS_URL',
  'XRPL_NODE'
];

for (const v of requiredEnv) {
  if (!process.env[v]) throw new Error(`❌ Missing required env variable: ${v}`);
}

const XRPL_NODE = process.env.XRPL_NODE;
const WALLET_ADDRESS = process.env.DISTRIBUTOR_WALLET;
const WALLET_SECRET = process.env.DISTRIBUTOR_SECRET;
const WALDO_ISSUER = process.env.WALDO_ISSUER;
const REDIS_URL = process.env.REDIS_URL;

const redis = createClient({ url: REDIS_URL });
await redis.connect();

console.log('✅ Redis connected');

const client = new Client(XRPL_NODE);
await client.connect();
console.log('✅ XRPL connected');

const wallet = {
  address: WALLET_ADDRESS,
  secret: WALLET_SECRET
};

const MIN_XRP = 5;
const BASE_RATE = 10000; // 1 XRP = 10,000 WALDO
const BONUS_TIERS = [
  { threshold: 1000, bonus: 0.20 },
  { threshold: 500, bonus: 0.10 },
  { threshold: 100, bonus: 0.05 }
];

let lastTxHash = '';

async function listenForPayments() {
  console.log(`📡 Listening for XRP sent to: ${wallet.address}`);

  client.request({
    command: 'subscribe',
    accounts: [wallet.address]
  });

  client.on('transaction', async (event) => {
    const tx = event.transaction;
    const meta = event.meta;

    if (
      tx.TransactionType === 'Payment' &&
      tx.Destination === wallet.address &&
      tx.Account !== wallet.address &&
      !tx.Amount.includes('currency') &&
      meta.TransactionResult === 'tesSUCCESS'
    ) {
      const txHash = tx.hash;
      const from = tx.Account;
      const amountXRP = parseFloat(tx.Amount) / 1_000_000;

      const exists = await redis.get(`seen:${txHash}`);
      if (exists) return;

      await redis.set(`seen:${txHash}`, '1');
      await redis.expire(`seen:${txHash}`, 60 * 60 * 24 * 7);

      if (amountXRP < MIN_XRP) {
        console.log(`⚠️ Ignored payment from ${from}: too small (${amountXRP} XRP)`);
        return;
      }

      let waldoAmount = amountXRP * BASE_RATE;
      for (const tier of BONUS_TIERS) {
        if (amountXRP >= tier.threshold) {
          waldoAmount += waldoAmount * tier.bonus;
          break;
        }
      }

      const hasTrustline = await checkTrustline(from);
      if (!hasTrustline) {
        console.log(`🚫 ${from} has no WALDO trustline — skipping`);
        return;
      }

      const sent = await sendWaldo(from, Math.floor(waldoAmount), txHash);
      if (sent) {
        console.log(`✅ Sent ${waldoAmount} WALDO to ${from}`);
      }
    }
  });
}

async function checkTrustline(account) {
  try {
    const lines = await client.request({
      command: 'account_lines',
      account
    });
    return lines.result.lines.some(
      (line) => line.currency === 'WLO' && line.account === WALDO_ISSUER
    );
  } catch (err) {
    console.error(`❌ Trustline check error for ${account}:`, err);
    return false;
  }
}

async function sendWaldo(destination, amount, ref) {
  try {
    const payment = {
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: destination,
      Amount: {
        currency: 'WLO',
        issuer: WALDO_ISSUER,
        value: amount.toString()
      },
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('WALDO_AIRDROP').toString('hex'),
            MemoData: Buffer.from(ref).toString('hex')
          }
        }
      ]
    };

    const prepared = await client.autofill(payment);
    const { tx_blob } = await client.sign(prepared, wallet.secret);
    const result = await client.submit(tx_blob);

    return result.result.engine_result === 'tesSUCCESS';
  } catch (err) {
    console.error(`❌ WALDO send failed to ${destination}:`, err);
    return false;
  }
}

await listenForPayments();
