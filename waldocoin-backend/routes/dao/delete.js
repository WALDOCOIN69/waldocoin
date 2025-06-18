import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { proposalId, adminKey } = req.body;

  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    await redis.del(`proposal:${proposalId}`);
    await redis.del(`proposalVotes:${proposalId}`);
    await redis.sRem("dao:proposals:active", proposalId);

    return res.json({ success: true, deleted: proposalId });
  } catch (err) {
    console.error("❌ DAO delete error:", err);
    return res.status(500).json({ success: false, error: "Could not delete proposal" });
  }
});

export default router;
