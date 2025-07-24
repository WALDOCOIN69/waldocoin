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
    // Simple SignIn - no return URL (mobile stays in Xaman)
    const payload = {
      txjson: {
        TransactionType: "SignIn"
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

    // Check if payloadStatus and meta exist
    if (!payloadStatus || !payloadStatus.meta) {
      console.log("❌ Invalid or expired payload:", { uuid, payloadStatus });
      return res.json({
        signed: false,
        expired: true,
        account: null,
        error: "Payload not found or expired"
      });
    }

    console.log("✅ XUMM Status Check:", {
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

// Create trustline QR code (same as login but for trustline)
router.get("/trustline", async (req, res) => {
  try {
    // TrustSet transaction for WALDO trustline
    const payload = {
      txjson: {
        TransactionType: "TrustSet",
        LimitAmount: {
          currency: "WLO",
          issuer: "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY",
          value: "1000000000"
        }
      }
    };

    const created = await xummClient.payload.create(payload);

    console.log("XUMM Trustline Payload Created:", {
      uuid: created.uuid,
      qr_png: created.refs.qr_png,
      qr_uri: created.refs.qr_uri
    });

    // Return QR with Xaman logo
    res.json({
      qr: created.refs.qr_png,
      uuid: created.uuid,
      refs: created.refs,
      next: created.next
    });
  } catch (err) {
    console.error("❌ Error creating trustline QR:", err.message);
    res.status(500).json({ error: "Failed to create XUMM trustline payload", details: err.message });
  }
});

export default router;





