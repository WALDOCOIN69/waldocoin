// routes/login.js
import express from "express";
import { xummClient } from "../utils/xummClient.js";
const router = express.Router();

// Health check
router.get("/ping", (_, res) => {
  res.json({ status: "✅ Login route is alive" });
});

// Create login QR with deep link support
router.get("/", async (req, res) => {
  try {
    // Use SignIn transaction with proper configuration
    const payload = {
      txjson: {
        TransactionType: "SignIn"
      },
      options: {
        submit: true, // Allow submission for SignIn
        multisign: false,
        expire: 5, // 5 minutes expiry
        return_url: {
          web: "https://waldocoin.live",
          app: "waldocoin://authenticated"
        }
      },
      custom_meta: {
        identifier: "WALDOCOIN-AUTH",
        blob: {
          purpose: "wallet_authentication",
          app: "WALDOCOIN Airdrop",
          description: "Sign in to claim your WALDOCOIN airdrop",
          timestamp: new Date().toISOString()
        }
      }
    };

    const created = await xummClient.payload.create(payload);

    console.log("XUMM Login Payload Created:", {
      uuid: created.uuid,
      qr_png: created.refs.qr_png,
      qr_uri: created.refs.qr_uri,
      websocket: created.refs.websocket_status
    });

    // Return all available refs for mobile deep linking
    res.json({
      qr: created.refs.qr_png,
      uuid: created.uuid,
      refs: created.refs, // Include all refs (qr_png, qr_uri, websocket_status, etc.)
      next: created.next // Include next object if available
    });
  } catch (err) {
    console.error("❌ Error in /api/login:", err.message);
    console.error("Full error:", err);
    res.status(500).json({ error: "Failed to create XUMM login payload", details: err.message });
  }
});

// Check login status
router.get("/status", async (req, res) => {
  const { uuid } = req.query;
  try {
    const payloadStatus = await xummClient.payload.get(uuid);

    console.log("XUMM Status Check:", {
      uuid,
      signed: payloadStatus.meta.signed,
      expired: payloadStatus.meta.expired,
      account: payloadStatus.response?.account,
      response: payloadStatus.response
    });

    res.json({
      signed: payloadStatus.meta.signed,
      expired: payloadStatus.meta.expired,
      account: payloadStatus.response?.account || payloadStatus.response?.signer,
      txid: payloadStatus.response?.txid,
      response: payloadStatus.response
    });
  } catch (err) {
    console.error("❌ Error checking login status:", err);
    res.status(500).json({ error: "Error checking login status", details: err.message });
  }
});

export default router;





