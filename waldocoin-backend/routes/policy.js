import express from "express";
import ensureMinWaldoWorth from "../utils/waldoWorth.js";
import getWaldoPerXrp from "../utils/getWaldoPerXrp.js";
import getWaldoBalance from "../utils/getWaldoBalance.js";

const router = express.Router();

// GET /api/policy/worth?wallet=...
// Returns { ok, minXrp, waldoPerXrp, requiredWaldo, balance }
router.get("/worth", async (req, res) => {
  try {
    const wallet = (req.query.wallet || "").trim();
    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid or missing wallet" });
    }

    const minXrp = parseFloat(process.env.MIN_XRP_WORTH || "3");
    const waldoPerXrp = await getWaldoPerXrp();
    const balance = await getWaldoBalance(wallet);
    const requiredWaldo = Math.ceil(minXrp * waldoPerXrp);
    const ok = (balance || 0) >= requiredWaldo;

    return res.json({
      success: true,
      ok,
      minXrp,
      waldoPerXrp,
      requiredWaldo,
      balance
    });
  } catch (err) {
    console.error("❌ /api/policy/worth error:", err.message || err);
    return res.status(500).json({ success: false, error: "Failed to compute worth policy" });
  }
});

export default router;

