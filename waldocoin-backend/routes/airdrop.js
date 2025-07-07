import express from "express";
import xrpl from "xrpl";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const WALDO_ISSUER = "rf97bQQbqztUnL1BYB5ti4rC691e7u5C8F";
const WALDO_CURRENCY = "WLO";
const WALDO_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET;

const claimed = new Set(); // Swap to Redis in prod

router.post("/", async (req, res) => {
  const { wallet, password } = req.body;

  if (!wallet || !password) return res.json({ success: false, error: "Missing wallet or password" });
  if (password !== "WALDOCREW") return res.json({ success: false, error: "Incorrect password" });
  if (claimed.has(wallet)) return res.json({ success: false, error: "Already claimed" });

  const client = new xrpl.Client("wss://s.altnet.rippletest.net");
  await client.connect();

  try {
    const lines = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasTrustline = lines.result.lines.some(
      line => line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
    );

    if (!hasTrustline) {
      await client.disconnect();
      return res.json({ success: false, error: "No WALDO trustline found" });
    }

    const senderWallet = xrpl.Wallet.fromSecret(WALDO_SECRET);

    const tx = {
      TransactionType: "Payment",
      Account: senderWallet.classicAddress,
      Destination: wallet,
      Amount: {
        currency: WALDO_CURRENCY,
        issuer: WALDO_ISSUER,
        value: "20000"
      }
    };

    const prepared = await client.autofill(tx);
    const signed = senderWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    if (result.result.meta.TransactionResult === "tesSUCCESS") {
      claimed.add(wallet);
      return res.json({ success: true });
    } else {
      return res.json({ success: false, error: "Transaction failed" });
    }

  } catch (err) {
    await client.disconnect();
    return res.json({ success: false, error: "XRPL error", details: err.message });
  }
});

export default router;


