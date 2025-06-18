// routes/dao/voter-history.js
import express from "express";
import { readData } from "../../utils/datastore.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "Wallet address required." });

  const db = await readData();
  const proposals = db.dao?.proposals || [];

  const history = proposals
    .filter(p => p.votes?.some(v => v.wallet === wallet))
    .map(p => {
      const vote = p.votes.find(v => v.wallet === wallet);
      return {
        id: p.id,
        title: p.title,
        vote: vote.choice,
        timestamp: vote.timestamp
      };
    });

  res.json({ wallet, votes: history });
});

export default router;
