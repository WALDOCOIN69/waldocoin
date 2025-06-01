// 📁 waldocoin-backend/routes/login.js
import express from 'express';
import { logViolation, isAutoBlocked } from '../utils/security.js';
import { fileURLToPath } from 'url';
import path from 'path';

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for malformed route detection
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && /:[^\/]+:/.test(path)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
      }
      return original.call(this, path, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

router.post('/wallet', async (req, res) => {
  const { wallet } = req.body;

  if (!wallet || !wallet.startsWith('r') || wallet.length < 25) {
    await logViolation(wallet || 'unknown', "invalid_wallet", { reason: "format" });
    return res.status(400).json({ error: "Invalid or missing wallet address." });
  }

  if (await isAutoBlocked(wallet)) {
    await logViolation(wallet, "login_attempt_blocked", { reason: "auto_blocked_status" });
    return res.status(403).json({ error: "🚫 This wallet is blocked due to prior violations." });
  }

  // Optional: Track login attempt
  await logViolation(wallet, "login_attempt", { ip: req.ip });

  // ✅ Success response
  res.json({ success: true, message: "Wallet verified and accepted." });
});

export default router;

