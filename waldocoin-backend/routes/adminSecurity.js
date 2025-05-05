import express from "express";
import redis from "../utils/redisClient.js";
import { logViolation, isAutoBlocked } from "../utils/security.js";

const router = express.Router();
const ADMIN_KEY = "waldogodmode2025";

// Middleware to protect routes
router.use((req, res, next) => {
  const key = req.header("x-admin-key");
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "🚫 Unauthorized" });
  }
  next();
});

// 📥 POST /api/admin/security/block
router.post("/block", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  await redis.set(`security:wallet:${wallet}:blocked`, "1");
  await redis.rPush(`security:wallet:${wallet}:log`, JSON.stringify({
    type: "manual_block",
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: `🔒 Wallet ${wallet} manually blocked.` });
});

// 📥 POST /api/admin/security/unblock
router.post("/unblock", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  await redis.del(`security:wallet:${wallet}:blocked`);
  await redis.rPush(`security:wallet:${wallet}:log`, JSON.stringify({
    type: "manual_unblock",
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true, message: `✅ Wallet ${wallet} unblocked.` });
});

// 📤 GET /api/admin/security/status/:wallet
router.get("/status/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const logKey = `security:wallet:${wallet}:log`;
  const blockedKey = `security:wallet:${wallet}:blocked`;

  const [violations, isBlocked] = await Promise.all([
    redis.lRange(logKey, 0, -1),
    redis.get(blockedKey),
  ]);

  res.json({
    wallet,
    isBlocked: !!isBlocked,
    violationCount: violations.length,
    recentViolations: violations.map((entry) => {
      try {
        return JSON.parse(entry);
      } catch {
        return { error: "Corrupt log entry", raw: entry };
      }
    }),
  });
});

export default router;
