// routes/login.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js";
import { logViolation, isAutoBlocked } from "../utils/security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

patchRouter(router, path.basename(__filename)); // ✅ Route validator

console.log("🛡️ Loaded: routes/login.js");

// 🔐 Wallet Login Route
router.post("/wallet", async (req, res) => {
  const { wallet } = req.body;

  // 🧪 Validate wallet format
  if (!wallet || typeof wallet !== "string" || !wallet.startsWith("r") || wallet.length < 25) {
    await logViolation(wallet || "unknown", "invalid_wallet", { reason: "format_invalid" });
    return res.status(400).json({ error: "Invalid or missing wallet address." });
  }

  // 🚫 Check for auto-blocked wallet
  if (await isAutoBlocked(wallet)) {
    await logViolation(wallet, "login_attempt_blocked", { reason: "auto_blocked" });
    return res.status(403).json({ error: "🚫 This wallet is blocked due to prior violations." });
  }

  // 📝 Log all login attempts
  await logViolation(wallet, "login_attempt", { ip: req.ip });

  // ✅ Success response
  return res.json({ success: true, message: "Wallet verified and accepted." });
});

export default router;

