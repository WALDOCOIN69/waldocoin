import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for bad route detection
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

// 📌 Wallet Analytics (Mock)
router.get("/wallet/:address", (req, res) => {
  const { address } = req.params;
  res.json({
    address,
    bonusTier: "Tier 2",
    email: "user@example.com",
    joined: "2025-04-01T12:00:00Z",
    memesMinted: 12,
    battlesWon: 3
  });
});

// ⚔️ Battle Stats (Mock)
router.get("/battles", (req, res) => {
  res.json({
    totalBattles: 42,
    mostVotedMeme: "meme1",
    avgVotesPerBattle: 77.3
  });
});

// 🎁 Airdrop Stats (Mock)
router.get("/airdrops", (req, res) => {
  res.json({
    totalAirdropped: 5023000,
    totalWallets: 128,
    avgPerWallet: 39242.19
  });
});

export default router;
