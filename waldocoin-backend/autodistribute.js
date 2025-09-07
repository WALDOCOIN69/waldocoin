// 📁 autodistribute.js - Enhanced for Trading Widget Support
import xrpl from "xrpl";
import dotenv from "dotenv";
import pkg from 'xumm-sdk';
import getWaldoPerXrp from "./utils/getWaldoPerXrp.js";
dotenv.config();
const { XummSdk } = pkg;
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
const client = new xrpl.Client("wss://xrplcluster.com");

const distributorWallet = process.env.DISTRIBUTOR_WALLET;
const distributorSecret = process.env.WALDO_DISTRIBUTOR_SECRET || process.env.DISTRIBUTOR_SECRET;
const issuerWallet = process.env.ISSUER_WALLET;
const WALDO_ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
const WALDO_CURRENCY = process.env.WALDOCOIN_TOKEN || "WLO";

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

// Parse memo to extract WALDO amount for trading widget transactions
function parseTradingMemo(tx) {
  if (!tx.Memos || !Array.isArray(tx.Memos)) return null;

  for (const memoWrapper of tx.Memos) {
    const memo = memoWrapper.Memo;
    if (!memo) continue;

    try {
      const memoType = memo.MemoType ? Buffer.from(memo.MemoType, 'hex').toString('utf8') : '';
      const memoData = memo.MemoData ? Buffer.from(memo.MemoData, 'hex').toString('utf8') : '';

      console.log('📝 Memo found:', { memoType, memoData });

      if (memoType === 'WALDO_BUY') {
        // Parse memo data like "Buy 1234.567890 WLO for 10 XRP"
        const match = memoData.match(/Buy\s+([\d.]+)\s+WLO\s+for\s+([\d.]+)\s+XRP/i);
        if (match) {
          const waldoAmount = parseFloat(match[1]);
          const xrpAmount = parseFloat(match[2]);
          console.log('🎯 Parsed trading memo:', { waldoAmount, xrpAmount });
          return { waldoAmount, xrpAmount, isTradingWidget: true };
        }
      }
    } catch (error) {
      console.error('❌ Error parsing memo:', error);
    }
  }

  return null;
}

(async () => {
  try {
    await client.connect();
    console.log("✅ XRPL connected");
    console.log(`📡 Listening for XRP sent to: ${distributorWallet}`);

    await client.request({
      command: "subscribe",
      accounts: [distributorWallet],
    });

    client.on("transaction", async (event) => {
      const tx = event.transaction;
      if (!isNativeXRP(tx)) {
        console.warn("⚠️ Ignored event - not a valid XRP Payment TX");
        return;
      }

      const sender = tx.Account;
      const txHash = tx.hash;
      const xrpAmount = parseFloat(xrpl.dropsToXrp(tx.Amount));

      console.log(`💰 XRP Payment received: ${xrpAmount} XRP from ${sender} | TX: ${txHash}`);

      // Check if this is a trading widget transaction with memo
      const tradingMemo = parseTradingMemo(tx);
      let waldoAmount;

      if (tradingMemo && tradingMemo.isTradingWidget) {
        // Use the exact WALDO amount from the trading widget memo
        waldoAmount = tradingMemo.waldoAmount;
        console.log(`🎯 Trading widget transaction: ${waldoAmount} WALDO for ${xrpAmount} XRP`);
      } else {
        // Legacy calculation for direct payments (presale, etc.)
        const bonus = xrpAmount >= 100 ? 0.2 : xrpAmount >= 50 ? 0.1 : 0;
        waldoAmount = Math.floor(xrpAmount * 100000 * (1 + bonus));
        console.log(`📊 Legacy calculation: ${waldoAmount} WALDO (${bonus * 100}% bonus)`);
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
        // Send WALDO directly using distributor wallet (automated)
        const distributorWalletObj = xrpl.Wallet.fromSeed(distributorSecret);

        const payment = {
          TransactionType: "Payment",
          Account: distributorWalletObj.classicAddress,
          Destination: sender,
          Amount: {
            currency: WALDO_CURRENCY,
            issuer: WALDO_ISSUER,
            value: waldoAmount.toString(),
          },
        };

        console.log(`🚀 Sending ${waldoAmount} WALDO to ${sender}...`);

        const prepared = await client.autofill(payment);
        const signed = distributorWalletObj.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        if (result.result.meta.TransactionResult === "tesSUCCESS") {
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
