import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const top = await redis.get("topMeme");
    res.json({ success: true, meme: JSON.parse(top || "{}") });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to load top meme" });
  }
});

export default router;
