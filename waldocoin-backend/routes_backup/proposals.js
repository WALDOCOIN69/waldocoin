// 📁 routes/proposals.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 🔍 GET all proposals
router.get("/", async (req, res) => {
  try {
    const keys = await redis.keys("proposal:*");
    const proposals = await Promise.all(
      keys.map(async key => {
        const data = await redis.hGetAll(key);
        return {
          ...data,
          id: key.split(":")[1],
          options: JSON.parse(data.options),
          expiresAt: new Date(data.expiresAt).toISOString()
        };
      })
    );
    res.json(proposals);
  } catch (err) {
    console.error("❌ Error fetching proposals:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ➕ CREATE new proposal
router.post("/", async (req, res) => {
  const { title, description, options, duration, wallet } = req.body;

  if (!title || !options || options.length < 2 || !duration || !wallet) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  const id = uuidv4();
  const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString();

  try {
    await redis.hSet(`proposal:${id}`, {
      title,
      description,
      options: JSON.stringify(options),
      createdAt: new Date().toISOString(),
      expiresAt,
      wallet
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error("❌ Error creating proposal:", err);
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// 📄 GET a single proposal
router.get("/view/:id", async (req, res) => {
  try {
    const data = await redis.hGetAll(`proposal:${req.params.id}`);
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    res.json({
      ...data,
      id: req.params.id,
      options: JSON.parse(data.options)
    });
  } catch (err) {
    console.error("❌ Error fetching proposal:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// 🗑 DELETE proposal
router.delete("/delete/:id", async (req, res) => {
  try {
    await redis.del(`proposal:${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting proposal:", err);
    res.status(500).json({ success: false, error: "Delete failed" });
  }
});

// ⏳ Force expire a proposal
router.post("/expire/:id", async (req, res) => {
  try {
    await redis.hSet(`proposal:${req.params.id}`, {
      expiresAt: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error expiring proposal:", err);
    res.status(500).json({ success: false, error: "Expire failed" });
  }
});

export default router;
