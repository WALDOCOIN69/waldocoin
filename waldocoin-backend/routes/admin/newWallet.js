// routes/admin/newWallet.js
import express from "express";
import dotenv from "dotenv";
import xrpl from "xrpl";

dotenv.config();

const router = express.Router();

// Simple admin key check (optional). If X_ADMIN_KEY is set, require it.
function checkAdmin(req) {
  const key = process.env.X_ADMIN_KEY;
  if (!key) return true; // no key configured -> allow
  const hdr = req.header("x-admin-key") || req.header("X-Admin-Key") || req.query.admin_key;
  return hdr === key;
}

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

