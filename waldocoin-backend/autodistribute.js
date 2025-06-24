// autodistribute.js ✅ WALDOCOIN XRPL Auto Distributor
import xrpl from "xrpl";
import dotenv from "dotenv";
import { Xumm } from "xumm-sdk";

dotenv.config();

const client = new xrpl.Client("wss://xrplcluster.com"); // ✅ Mainnet
const distributorWallet = process.env.DISTRIBUTOR_WALLET;
const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

const isNativeXRP = (tx) =>
  tx.TransactionType === "Payment" &&
  tx.Destination === distributorWallet &&
  typeof tx.Amount === "string";

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
      const bonus = xrpAmount >= 100 ? 0.2 : xrpAmount >= 50 ? 0.1 : 0;
      const waldoAmount = Math.floor((xrpAmount * 1000) * (1 + bonus));

      const hasTrust = await client.request({
        command: "account_lines",
        account: sender,
      });

      const trustsWaldo = hasTrust.result.lines.some(
        (line) =>
          line.currency === "WLO" &&
          line.account === process.env.ISSUER_WALLET
      );

      if (!trustsWaldo) {
        console.warn(`🚫 No WALDO trustline for ${sender}`);
        return;
      }

      const payload = {
        txjson: {
          TransactionType: "Payment",
          Account: distributorWallet,
          Destination: sender,
          Amount: {
            currency: "WLO",
            issuer: process.env.ISSUER_WALLET,
            value: waldoAmount.toString(),
          },
        },
      };

      const created = await xumm.payload.createAndSubscribe(payload, (event) => {
        if (event.data.signed === true) {
          console.log(`✅ WALDO sent: ${waldoAmount} to ${sender}`);
          return true;
        }
      });

      console.log(`🔄 Sent WALDO ${waldoAmount} to ${sender} | TX: ${txHash}`);
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();

