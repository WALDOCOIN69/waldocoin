import express from "express";
import { redis } from "../../redisClient.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { proposalId, status, adminKey } = req.body;

  // Use X_ADMIN_KEY for consistency with new DAO system
  if (adminKey !== process.env.X_ADMIN_KEY) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  try {
    const validStatuses = ["active", "expired", "archived"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status value" });
    }

    await redis.hSet(`proposal:${proposalId}`, "status", status);

    return res.json({ success: true, updated: { proposalId, status } });
  } catch (err) {
    console.error("❌ DAO override error:", err);
    return res.status(500).json({ success: false, error: "Could not update status" });
  }
});

export default router;
