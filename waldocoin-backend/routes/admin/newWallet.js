// routes/admin/newWallet.js
import express from "express";
import dotenv from "dotenv";
import xrpl from "xrpl";
import { checkAdmin } from "../../utils/adminAuth.js";

dotenv.config();

const router = express.Router();

// POST /api/admin/new-wallet  (or GET)
router.post("/", async (req, res) => {
  try {
    if (!checkAdmin(req)) return res.status(403).json({ success: false, error: "Forbidden" });

    const w = xrpl.Wallet.generate();
    // Do NOT log the seed
    return res.json({
      success: true,
      address: w.classicAddress,
      seed: w.seed,
      note: "Fund with >= 12 XRP for base reserve & trustline; then add WLO trustline to the WALDO issuer and configure as distributor in Render."
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get("/", async (req, res) => {
  // Allow GET for convenience
  return router.handle(req, res);
});

export default router;

