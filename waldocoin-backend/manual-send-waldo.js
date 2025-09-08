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

// Auto-calculate WALDO amount based on XRP sent
async function calculateWaldoFromXrp(xrpAmount) {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://waldocoin-backend-api.onrender.com/api/market/wlo');
    const data = await response.json();
    const xrpPerWlo = data?.xrpPerWlo || data?.best?.mid;

    if (xrpPerWlo && isFinite(xrpPerWlo) && xrpPerWlo > 0) {
      return Math.floor(xrpAmount / xrpPerWlo);
    } else {
      // Fallback rate
      return Math.floor(xrpAmount * 10000);
    }
  } catch (error) {
    console.warn("Using fallback rate due to error:", error.message);
    return Math.floor(xrpAmount * 10000);
  }
}

// Usage: node manual-send-waldo.js <wallet> <xrp_amount_sent>
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.log("Usage: node manual-send-waldo.js <wallet_address> <xrp_amount_sent>");
  console.log("Example: node manual-send-waldo.js rABC123... 10");
  console.log("This will calculate the WALDO amount based on current market rate");
  process.exit(1);
}

const [wallet, xrpAmountStr] = args;
const xrpAmount = parseFloat(xrpAmountStr);

if (!wallet.startsWith('r') || wallet.length < 25) {
  console.error("❌ Invalid wallet address");
  process.exit(1);
}

if (!xrpAmount || xrpAmount <= 0) {
  console.error("❌ Invalid XRP amount");
  process.exit(1);
}

console.log(`🔄 Calculating WALDO amount for ${xrpAmount} XRP...`);
const waldoAmount = await calculateWaldoFromXrp(xrpAmount);
console.log(`💰 Will send ${waldoAmount} WALDO to ${wallet}`);

sendWaldo(wallet, waldoAmount);
