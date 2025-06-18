import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const keys = await redis.sMembers("dao:proposals:active");
    const proposals = [];

    for (const id of keys) {
      const data = await redis.hGetAll(`proposal:${id}`);
      if (data && Object.keys(data).length) {
        proposals.push({ proposalId: id, ...data });
      }
    }

    return res.json({ success: true, proposals });
  } catch (err) {
    console.error("❌ DAO list error:", err);
    return res.status(500).json({ success: false, error: "Could not list proposals" });
  }
});

export default router;