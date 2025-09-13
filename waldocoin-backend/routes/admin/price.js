// routes/admin/price.js
import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

function checkAdmin(req) {
  const key = process.env.X_ADMIN_KEY;
  if (!key) return true;
  const hdr = req.header("x-admin-key") || req.header("X-Admin-Key") || req.query.admin_key;
  return hdr === key;
}

// POST /api/admin/price/override { xrpPerWlo: number }
router.post('/override', async (req, res) => {
  try {
    if (!checkAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const n = Number(req.body?.xrpPerWlo);
    if (!isFinite(n) || n <= 0) return res.status(400).json({ success: false, error: 'xrpPerWlo must be > 0' });
    await redis.set('price:xrp_per_wlo:override', String(n));
    return res.json({ success: true, xrpPerWlo: n });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/price/override
router.delete('/override', async (req, res) => {
  try {
    if (!checkAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    await redis.del('price:xrp_per_wlo:override');
    return res.json({ success: true, cleared: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;

