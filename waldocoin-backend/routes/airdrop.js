import express from "express";
import xrpl from "xrpl";
import { WALDOCOIN_TOKEN, WALDO_ISSUER, WALDO_DISTRIBUTOR_SECRET } from "../constants.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { wallet, password } = req.body;

  // Validate input
  if (!wallet || !wallet.startsWith("r") || !password) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  // Validate passcode
  if (password !== "WALDOCREW") {
    return res.status(401).json({ success: false, error: "Invalid password" });
  }

  try {
    // 🔑 Load wallet
    const sender = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
    const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
    await client.connect();

    // 🧾 Prepare TX
    const tx = {
      TransactionType: "Payment",
      Account: sender.classicAddress,
      Destination: wallet,
      Amount: {
        currency: WALDOCOIN_TOKEN,
        issuer: WALDO_ISSUER,
        value: "50000"
      }
    };

    const prepared = await client.autofill(tx);
    const signed = sender.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    if (result.result.meta.TransactionResult !== "tesSUCCESS") {
      return res.status(500).json({ success: false, error: "Transaction failed" });
    }

    return res.json({ success: true, txHash: result.result.hash });

  } catch (err) {
    console.error("❌ Airdrop error:", err);
    return res.status(500).json({ success: false, error: "Airdrop failed", detail: err.message });
  }
});

export default router;


