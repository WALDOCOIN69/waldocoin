
// routes/airdrop.js don't know why its not working
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
    const client = new xrpl.Client("wss://s1.ripple.com");
    await client.connect();

    const trustlines = await client.request({
      command: "account_lines",
      account: wallet
    });
    console.log("🔍 Trustlines returned:", JSON.stringify(trustlines.result.lines, null, 2));

 const hasTrustline = trustlines.result.lines.some(
  (line) =>
    String(line.currency).trim().toUpperCase() === String(WALDOCOIN_TOKEN).trim().toUpperCase() &&
    line.account === WALDO_ISSUER
);

    console.log("🔍 Trustlines returned:", JSON.stringify(trustlines.result.lines, null, 2));

    if (!hasTrustline) {
      await client.disconnect();
      return res.status(400).json({ success: false, error: "❌ No WALDO trustline found" });
    }

    const tx = {
      TransactionType: "Payment",
      Account: sender.classicAddress,
      Destination: wallet,
      Amount: {
        currency: String(WALDOCOIN_TOKEN).trim().toUpperCase(),
        issuer: String(WALDO_ISSUER).trim(),
        value: "50000.000000" // must be string
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





