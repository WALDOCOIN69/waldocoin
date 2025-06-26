// routes/conversion.js
import express from "express";
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    // Temporary hardcoded conversion rates
    return res.json({
      success: true,
      waldoToXrp: 0.01,
      waldoToUsd: 0.007
    });
  } catch (err) {
    console.error("❌ Conversion route error:", err);
    return res.status(500).json({ success: false, error: "Conversion fetch failed" });
  }
});

export default router;
