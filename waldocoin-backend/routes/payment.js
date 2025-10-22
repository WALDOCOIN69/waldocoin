import express from "express";
import { getPaymentStatus, getPaymentFailure } from "../utils/paymentHandler.js";

const router = express.Router();

console.log("🧩 Loaded: routes/payment.js");

// GET /api/payment/status/:uuid - Check payment status with enhanced error handling
router.get("/status/:uuid", async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: "Missing payment UUID"
      });
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment UUID format"
      });
    }

    // Get enhanced payment status
    const status = await getPaymentStatus(uuid);

    if (!status.success) {
      // Check for failure information
      const failure = await getPaymentFailure(uuid);

      return res.status(404).json({
        success: false,
        error: status.error,
        failure: failure ? {
          reason: failure.reason,
          timestamp: failure.timestamp
        } : null
      });
    }

    return res.json({
      success: true,
      signed: status.signed,
      resolved: status.resolved,
      expired: status.expired || false,
      cancelled: status.cancelled || false,
      txid: status.txid || null,
      timestamp: status.timestamp || null,
      cached: status.error ? true : false // Indicates if using cached data
    });

  } catch (error) {
    console.error('❌ Payment status check error:', error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while checking payment status",
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
