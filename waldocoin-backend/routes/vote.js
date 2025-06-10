// 📁 routes/vote.js
import { wrapRouter } from "../utils/wrapRouter.js";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";
import { redis } from "../redisClient.js";
import { patchRouter } from "../utils/patchRouter.js";
const router = wrapRouter("login.js");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

patchRouter(router, path.basename(__filename)); // ✅ Route validator added

// 🗳 Vote submission route
router.post("/", async (req, res) => {
  const { proposalId, choice, wallet } = req.body;

  if (!proposalId || !choice || !wallet) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  try {
    // ✅ Fetch WALDO balance from XRPL
    const response = await fetch("https://s1.ripple.com:51234", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_lines",
        params: [{ account: wallet }]
      })
    });

    const data = await response.json();
    const lines = data?.result?.lines || [];

    const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const WALDO_CURRENCY = "WLO";
    const WALDO_PRICE_XRP = 0.01;
    const REQUIRED_XRP = 100;
    const requiredWaldo = REQUIRED_XRP / WALDO_PRICE_XRP;

    const waldoLine = lines.find(
      l => l.currency === WALDO_CURRENCY && l.account === WALDO_ISSUER
    );

    const waldoBalance = parseFloat(waldoLine?.balance || "0");

    if (waldoBalance < requiredWaldo) {
      return res.status(403).json({
        success: false,
        error: `You need at least ${requiredWaldo.toLocaleString()} WALDO to vote (≈${REQUIRED_XRP} XRP)`
      });
    }

    // ⛔ Prevent duplicate voting
    const existing = await redis.hGet(`proposalVotes:${proposalId}`, wallet);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "You already voted on this proposal."
      });
    }

    // ✅ Save vote to Redis
    await redis.hSet(`proposalVotes:${proposalId}`, wallet, choice);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Voting error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;


