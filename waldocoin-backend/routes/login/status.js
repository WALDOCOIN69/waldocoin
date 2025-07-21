// routes/login/status.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";

const router = express.Router();

router.get("/:uuid", async (req, res) => {
  const { uuid } = req.params;
  console.log("📡 Hit /api/login/status with uuid:", uuid); // 👈 DEBUG

  try {
    const payload = await xummClient.payload.get(uuid);

    // Check if payload exists
    if (!payload) {
      console.log("⚠️ XUMM payload not found for UUID:", uuid);
      return res.json({
        signed: false,
        expired: true,
        error: "Payload not found or expired"
      });
    }

    // Check if payload has meta property
    if (!payload.meta) {
      console.log("⚠️ XUMM payload missing meta data for UUID:", uuid);
      return res.json({
        signed: false,
        expired: true,
        error: "Invalid payload structure"
      });
    }

    console.log("✅ XUMM payload response:", {
      signed: payload.meta.signed,
      expired: payload.meta.expired,
      account: payload.response?.account,
    });

    if (payload.meta.expired) {
      return res.json({ expired: true });
    }

    if (payload.meta.signed) {
      return res.json({
        signed: true,
        wallet: payload.response?.account,
        account: payload.response?.account, // Add both for compatibility
      });
    }

    res.json({ signed: false });
  } catch (err) {
    console.error("❌ Error in login status route:", err.message);
    // Return a proper JSON response instead of 500 error
    res.json({
      signed: false,
      expired: true,
      error: "Failed to fetch login status",
      details: err.message
    });
  }
});

export default router;

