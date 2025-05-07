import express from "express";
const router = express.Router();

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

