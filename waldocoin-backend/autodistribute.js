// 📁 autodistribute.js - Enhanced for Trading Widget Support
import xrpl from "xrpl";
import dotenv from "dotenv";
import fetch from 'node-fetch';
// Enhanced autodistribute - uses same market pricing as trading widget
dotenv.config();
const client = new xrpl.Client("wss://xrplcluster.com");

const distributorWallet = process.env.DISTRIBUTOR_WALLET;
const distributorSecret = process.env.WALDO_DISTRIBUTOR_SECRET || process.env.DISTRIBUTOR_SECRET;
const issuerWallet = process.env.ISSUER_WALLET;
const WALDO_ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
const WALDO_CURRENCY = process.env.WALDOCOIN_TOKEN || "WLO";
// Wallet that will actually SEND WALDO (can be issuer/treasury). Falls back to distributorSecret.
const senderSecret = process.env.WALDO_SENDER_SECRET || process.env.ISSUER_SECRET || distributorSecret;

// Validate required environment variables
if (!distributorWallet) {
  console.error("❌ DISTRIBUTOR_WALLET environment variable not set");
  process.exit(1);
}

if (!distributorSecret) {
  console.error("❌ WALDO_DISTRIBUTOR_SECRET environment variable not set");
  process.exit(1);
}

const isNativeXRP = (tx) =>
  tx.TransactionType === "Payment" &&
  tx.Destination === distributorWallet &&
  typeof tx.Amount === "string";

// Simple approach: Any XRP payment to distributor wallet gets WALDO back

(async () => {
  try {
    await client.connect();
    console.log("✅ XRPL connected");
    const senderWalletObj = xrpl.Wallet.fromSeed(senderSecret);
    console.log(`📡 Listening for XRP sent to: ${distributorWallet}`);
    console.log(`✉️  WALDO sender address: ${senderWalletObj.classicAddress}`);

    await client.request({
      command: "subscribe",
      accounts: [distributorWallet],
    });

    client.on("transaction", async (event) => {
      if (!event.validated) { return; }
      const tx = event.transaction;
      if (!isNativeXRP(tx)) {
        console.warn("⚠️ Ignored event - not a valid XRP Payment TX");
        return;
      }

      const sender = tx.Account;
      const txHash = tx.hash;
      const xrpAmount = parseFloat(xrpl.dropsToXrp(tx.Amount));

      console.log(`💰 XRP Payment received: ${xrpAmount} XRP from ${sender} | TX: ${txHash}`);

      // Get current market rate from same endpoint as trading widget
      let waldoAmount;
      try {
        const marketResponse = await fetch('https://waldocoin-backend-api.onrender.com/api/market/wlo');
        const marketData = await marketResponse.json();
        const xrpPerWlo = marketData?.xrpPerWlo || marketData?.best?.mid;

        if (xrpPerWlo && isFinite(xrpPerWlo) && xrpPerWlo > 0) {
          // Same calculation as trading widget: waldoAmount = xrpAmount / xrpPerWlo
          waldoAmount = Math.floor(xrpAmount / xrpPerWlo);
          console.log(`🎯 Market rate: ${xrpPerWlo} XRP/WLO → ${waldoAmount} WALDO for ${xrpAmount} XRP`);
        } else {
          throw new Error('Invalid market rate');
        }
      } catch (error) {
        console.warn(`⚠️ Market rate fetch failed, using fallback: ${error.message}`);
        // Fallback rate: 10,000 WALDO per XRP (same as presale)
        waldoAmount = Math.floor(xrpAmount * 10000);
        console.log(`🎯 Fallback rate: 10,000 WALDO/XRP → ${waldoAmount} WALDO for ${xrpAmount} XRP`);
      }

      // Check for WALDO trustline
      const trustlines = await client.request({
        command: "account_lines",
        account: sender,
      });

      const trustsWaldo = trustlines.result.lines.some(
        (line) => line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
      );

      if (!trustsWaldo) {
        console.warn(`🚫 No WALDO trustline for ${sender} (currency: ${WALDO_CURRENCY}, issuer: ${WALDO_ISSUER})`);
        return;
      }

      console.log(`✅ WALDO trustline confirmed for ${sender}`);

      try {
        // Send WALDO using configured sender (issuer/treasury/distributor)
        const senderWalletObj = xrpl.Wallet.fromSeed(senderSecret);

        const payment = {
          TransactionType: "Payment",
          Account: senderWalletObj.classicAddress,
          Destination: sender,
          Amount: {
            currency: WALDO_CURRENCY,
            issuer: WALDO_ISSUER,
            value: waldoAmount.toString(),
          },
        };

        console.log(`🚀 Sending ${waldoAmount} WALDO to ${sender}...`);

        const prepared = await client.autofill(payment);
        const signed = senderWalletObj.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        const engine = result?.result?.engine_result || result?.result?.meta?.TransactionResult;
        if (engine === "tesSUCCESS") {
          console.log(`✅ WALDO distribution completed: ${waldoAmount} WALDO sent to ${sender} | TX: ${result.result.hash}`);
        } else {
          console.error(`❌ WALDO distribution failed: ${result.result.meta.TransactionResult} for ${sender}`);
        }
      } catch (distributionError) {
        console.error(`❌ Error during WALDO distribution to ${sender}:`, distributionError.message);
      }
    });
  } catch (err) {
    console.error("❌ Error in autodistribute.js:", err.message);
  }
})();
