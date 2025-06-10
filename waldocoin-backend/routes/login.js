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
    router[method] = function (routePath, ...handlers) {
      if (typeof routePath === "string" && /:[^\/]+:/.test(routePath)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${routePath}`);
        throw new Error(`❌ Invalid route pattern in ${file}: ${routePath}`);
      }
      return original.call(this, routePath, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

// 🔐 Wallet Login Route
router.post('/wallet', async (req, res) => {
  const { wallet } = req.body;

  // 🧪 Validate wallet format
  if (!wallet || typeof wallet !== "string" || !wallet.startsWith('r') || wallet.length < 25) {
    await logViolation(wallet || 'unknown', "invalid_wallet", { reason: "format_invalid" });
    return res.status(400).json({ error: "Invalid or missing wallet address." });
  }

  // 🚫 Check for auto-blocked wallet
  if (await isAutoBlocked(wallet)) {
    await logViolation(wallet, "login_attempt_blocked", { reason: "auto_blocked" });
    return res.status(403).json({ error: "🚫 This wallet is blocked due to prior violations." });
  }

  // 📝 Optional logging for all login attempts
  await logViolation(wallet, "login_attempt", { ip: req.ip });

  // ✅ Respond with success
  return res.json({ success: true, message: "Wallet verified and accepted." });
});

export default router;
