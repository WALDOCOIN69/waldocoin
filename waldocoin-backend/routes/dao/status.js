import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/:proposalId", async (req, res) => {
  const { proposalId } = req.params;
  if (!proposalId) return res.status(400).json({ success: false, error: "Missing proposalId" });

  try {
    const votes = await redis.hGetAll(`proposalVotes:${proposalId}`);
    const proposal = await redis.hGetAll(`proposal:${proposalId}`);

    if (!proposal || !Object.keys(proposal).length) {
      return res.status(404).json({ success: false, error: "Proposal not found" });
    }

    const voteCount = {};
    Object.values(votes).forEach(choice => {
      voteCount[choice] = (voteCount[choice] || 0) + 1;
    });

    return res.json({ success: true, proposal, votes: voteCount });
  } catch (err) {
    console.error("❌ DAO status error:", err);
    return res.status(500).json({ success: false, error: "Could not fetch status" });
  }
});

export default router;