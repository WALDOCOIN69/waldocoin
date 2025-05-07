import express from "express";
const router = express.Router();

// 🧠 Mock Battle Stats
router.get("/battles", (req, res) => {
  res.json({
    totalBattles: 42,
    mostVotedMeme: "meme1",
    avgVotesPerBattle: 77.3
  });
});

// 🎁 Mock Airdrop Stats
router.get("/airdrops", (req, res) => {
  res.json({
    totalAirdropped: 5023000,
    totalWallets: 128,
    avgPerWallet: 39242.19
  });
});

export default router;
