import express from "express";
import dotenv from "dotenv";
import { XummSdk } from "xumm-sdk";
import { Client } from "xrpl";

dotenv.config();

const router = express.Router();
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// 🔐 Create XUMM Sign-In Payload
router.get("/", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "SignIn",
      },
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid,
    });
  } catch (err) {
    console.error("❌ Error creating XUMM payload:", err);
    res.status(500).json({ error: "Failed to create XUMM sign-in." });
  }
});

// 🔁 Poll Sign-In Status
router.get("/status/:uuid", async (req, res) => {
  const { uuid } = req.params;

  try {
    const result = await xumm.payload.get(uuid);

    if (result.meta.signed === true && result.response.account) {
      return res.json({
        signed: true,
        wallet: result.response.account
      });
    }

    res.json({ signed: false });
  } catch (err) {
    console.error("❌ Error checking login status:", err);
    res.status(500).json({ error: "Failed to check sign-in status." });
  }
});

// ✅ WALDO Trustline Check
router.get("/trustline-check", async (req, res) => {
  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet parameter." });
  }

  try {
    const client = new Client("wss://s.altnet.rippletest.net:51233"); // use mainnet if you're live
    await client.connect();

    const response = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasWaldoTrustline = response.result.lines.some(
      line => line.currency === "WLO" && line.account === "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY"
    );

    await client.disconnect();
    res.json({ hasWaldoTrustline });
  } catch (err) {
    console.error("❌ Trustline check failed:", err);
    res.status(500).json({ error: "Trustline check failed." });
  }
});

export default router;
