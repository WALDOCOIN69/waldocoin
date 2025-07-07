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

  // ✅ Validate input
  if (!wallet || !wallet.startsWith("r") || !password) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  if (password !== "WALDOCREW") {
    return res.status(401).json({ success: false, error: "Invalid password" });
  }

  try {
    // ✅ Load wallet + connect to XRPL mainnet
    const sender = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
    const client = new xrpl.Client("wss://s1.ripple.com"); // ✅ XRPL mainnet
    await client.connect();

    // ✅ Check WALDO trustline
    const trustlineCheck = await client.request({
      command: "account_lines",
      account: wallet
    });
    const hasTrust = trustlineCheck.result.lines.some(
      line => line.currency === WALDOCOIN_TOKEN && line.issuer === WALDO_ISSUER
    );
    if (!hasTrust) {
      await client.disconnect();
      return res.status(400).json({ success: false, error: "❌ No WALDO trustline found" });
    }

    // ✅ Prepare TX
    const tx = {
      TransactionType: "Payment",
      Account: sender.classicAddress,
      Destination: wallet,
 Amount: {
  currency: WALDOCOIN_TOKEN.toUpperCase(),
  issuer: WALDO_ISSUER.trim(),
  value: (50000).toFixed(6)  // Always string: "50000.000000"
}
console.log("🔍 TX Object:", JSON.stringify(tx, null, 2));

    };

    const prepared = await client.autofill(tx);
    const signed = sender.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    await client.disconnect();

    // ✅ Check XRPL result
    if (result.result.meta.TransactionResult !== "tesSUCCESS") {
      console.error("❌ TX failed meta:", result.result.meta);
      return res.status(500).json({
        success: false,
        error: "Transaction failed",
        detail: result.result.meta.TransactionResult
      });
    }

    return res.json({ success: true, txHash: result.result.hash });

  } catch (err) {
    console.error("❌ Airdrop error:", err.message);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

export default router;


