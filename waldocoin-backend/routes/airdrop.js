const express = require("express");
const xrpl = require("xrpl");
const router = express.Router();
const { WALDO_ISSUER, WALDO_CURRENCY, WALDO_SECRET } = require("../constants");
const claimed = new Set(); // Replace with Redis in production

router.post("/claim", async (req, res) => {
  const { wallet, password } = req.body;

  console.log("🔐 Incoming airdrop claim request:", { wallet, password });

  if (!wallet || !password) {
    return res.json({ success: false, error: "Missing wallet or password" });
  }

  if (password !== "WALDOCREW") {
    return res.json({ success: false, error: "Incorrect password" });
  }

  if (claimed.has(wallet)) {
    return res.json({ success: false, error: "Already claimed" });
  }

  try {
    const client = new xrpl.Client("wss://s.altnet.rippletest.net");
    await client.connect();

    // Check trustline
    const accountLines = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasTrustline = accountLines.result.lines.some(
      line => line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
    );

    if (!hasTrustline) {
      await client.disconnect();
      return res.json({ success: false, error: "No WALDO trustline found" });
    }

    // Prepare payment
    const senderWallet = xrpl.Wallet.fromSecret(WALDO_SECRET);
    const tx = {
      TransactionType: "Payment",
      Account: senderWallet.classicAddress,
      Destination: wallet,
      Amount: {
        currency: WALDO_CURRENCY,
        issuer: WALDO_ISSUER,
        value: "50000"
      }
    };

    const prepared = await client.autofill(tx);
    const signed = senderWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    if (result.result.meta.TransactionResult === "tesSUCCESS") {
      claimed.add(wallet);
      console.log("✅ Airdrop successful:", result.result.hash);
      return res.json({ success: true });
    } else {
      console.error("❌ XRPL TX failed:", result.result.meta.TransactionResult);
      return res.json({ success: false, error: "Transaction failed" });
    }

  } catch (err) {
    console.error("🔥 Server error during airdrop:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;

