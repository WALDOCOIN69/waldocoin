import express from "express";
import { xummClient } from "../utils/xummClient.js";

const router = express.Router();

console.log("🧩 Loaded: routes/payment.js");

// GET /api/payment/status/:uuid - Check payment status
router.get("/status/:uuid", async (req, res) => {
  try {
    const { uuid } = req.params;
    
    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: "Missing payment UUID"
      });
    }

    // Get payment status from XUMM
    const payloadData = await xummClient.payload.get(uuid);
    
    return res.json({
      success: true,
      signed: payloadData.meta?.signed || null,
      resolved: payloadData.meta?.resolved || false,
      expired: payloadData.meta?.expired || false,
      cancelled: payloadData.meta?.cancelled || false
    });

  } catch (error) {
    console.error('❌ Payment status check error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to check payment status"
    });
  }
});

export default router;
