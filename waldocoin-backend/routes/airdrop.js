// routes/airdrop.js
import express from "express";
import xrpl from "xrpl";
import {
  WALDOCOIN_TOKEN,
  WALDO_ISSUER,
  WALDO_DISTRIBUTOR_SECRET
} from "../constants.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { wallet, password } = req.body;

  if (!wallet || !wallet.startsWith("r") || !password) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  if (password !== "WALDOCREW") {
    return res.status(401).json({ success: false, error: "Invalid password" });
  }

  try {
    console.log("🐛 Airdrop POST called");
    console.log("🐛 wallet from body:", wallet);
    console.log("🐛 WALDOCOIN_TOKEN:", WALDOCOIN_TOKEN);
    console.log("🐛 WALDO_ISSUER:", WALDO_ISSUER);

    const sender = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
    console.log("🚨 Sender wallet:", sender.classicAddress);

    const client = new xrpl.Client("wss://s1.ripple.com");
    await client.connect();

    // 🔍 Check if the wallet is active
    try {
      await client.request({
        command: 'account_info',
        account: wallet
      });
    } catch (err) {
      if (err.data?.error === 'actNotFound') {
        await client.disconnect();
        return res.status(400).json({
          success: false,
          error: "Destination wallet is not activated. Must hold XRP first."
        });
      }
      throw err;
    }

    // 🔍 Check trustline
    const trustlines = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasTrustline = trustlines.result.lines.some(
      (line) =>
        String(line.currency).trim().toUpperCase() === String(WALDOCOIN_TOKEN).trim().toUpperCase() &&
        line.account === WALDO_ISSUER
    );

    if (!hasTrustline) {
      await client.disconnect();
      return res.status(400).json({ success: false, error: "❌ No WALDO trustline found" });
    }

    // ✅ Build and send TX
    const tx = {
      TransactionType: "Payment",
      Account: sender.classicAddress,
      Destination: wallet,
      Amount: {
        currency: WALDOCOIN_TOKEN.toUpperCase(),
        issuer: WALDO_ISSUER,
        value: "50000.000000"
      }
    };

    const prepared = await client.autofill(tx);
    const signed = sender.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    if (result.result.meta.TransactionResult !== "tesSUCCESS") {
      console.error("❌ TX failed:", result.result.meta);
      return res.status(500).json({
        success: false,
        error: "Transaction failed",
        detail: result.result.meta.TransactionResult
      });
    }

    return res.json({ success: true, txHash: result.result.hash });

  } catch (err) {
    console.error("❌ Airdrop error:", err);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

export default router;



