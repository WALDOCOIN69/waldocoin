// Manual WALDO Send Script
// Use this to manually send WALDO tokens to users who didn't receive them from trading widget

import xrpl from "xrpl";
import dotenv from "dotenv";

dotenv.config();

const DISTRIBUTOR_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET || process.env.DISTRIBUTOR_SECRET;
const WALDO_ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
const WALDO_CURRENCY = process.env.WALDOCOIN_TOKEN || "WLO";

async function sendWaldo(recipientWallet, waldoAmount) {
  if (!DISTRIBUTOR_SECRET) {
    console.error("❌ DISTRIBUTOR_SECRET not found in environment variables");
    return;
  }

  const client = new xrpl.Client("wss://xrplcluster.com");
  
  try {
    await client.connect();
    console.log("✅ Connected to XRPL");

    const distributorWallet = xrpl.Wallet.fromSeed(DISTRIBUTOR_SECRET);
    console.log(`📍 Distributor wallet: ${distributorWallet.classicAddress}`);

    const payment = {
      TransactionType: "Payment",
      Account: distributorWallet.classicAddress,
      Destination: recipientWallet,
      Amount: {
        currency: WALDO_CURRENCY,
        issuer: WALDO_ISSUER,
        value: waldoAmount.toString(),
      },
    };

    console.log(`🚀 Sending ${waldoAmount} WALDO to ${recipientWallet}...`);

    const prepared = await client.autofill(payment);
    const signed = distributorWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === "tesSUCCESS") {
      console.log(`✅ SUCCESS: ${waldoAmount} WALDO sent to ${recipientWallet}`);
      console.log(`📋 Transaction hash: ${result.result.hash}`);
      console.log(`🔗 View on XRPL: https://livenet.xrpl.org/transactions/${result.result.hash}`);
    } else {
      console.error(`❌ FAILED: ${result.result.meta.TransactionResult}`);
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.disconnect();
  }
}

// Usage: node manual-send-waldo.js <wallet> <amount>
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.log("Usage: node manual-send-waldo.js <wallet_address> <waldo_amount>");
  console.log("Example: node manual-send-waldo.js rABC123... 50000");
  process.exit(1);
}

const [wallet, amount] = args;
const waldoAmount = parseFloat(amount);

if (!wallet.startsWith('r') || wallet.length < 25) {
  console.error("❌ Invalid wallet address");
  process.exit(1);
}

if (!waldoAmount || waldoAmount <= 0) {
  console.error("❌ Invalid WALDO amount");
  process.exit(1);
}

sendWaldo(wallet, waldoAmount);
