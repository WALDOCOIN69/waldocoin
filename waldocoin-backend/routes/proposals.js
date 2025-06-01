import express from "express";
import { redis } from "../redisClient.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js"; // ✅ import patch

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
patchRouter(router, path.basename(__filename)); // ✅ patch applied

// 🔍 GET all proposals
router.get("/", async (req, res) => {
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
});

// ➕ CREATE new proposal
router.post("/", async (req, res) => {
  const { title, description, options, duration, wallet } = req.body;

  if (!title || !options || options.length < 2 || !duration || !wallet) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  const id = uuidv4();
  const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString();

  await redis.hSet(`proposal:${id}`, {
    title,
    description,
    options: JSON.stringify(options),
    createdAt: new Date().toISOString(),
    expiresAt,
    wallet
  });

  res.json({ success: true, id });
});

// 📄 GET a single proposal
router.get("/view/:id", async (req, res) => {
  const data = await redis.hGetAll(`proposal:${req.params.id}`);
  if (!data || Object.keys(data).length === 0) {
    return res.status(404).json({ error: "Proposal not found" });
  }
  res.json({
    ...data,
    id: req.params.id,
    options: JSON.parse(data.options)
  });
});

// 🗑 DELETE proposal
router.delete("/delete/:id", async (req, res) => {
  await redis.del(`proposal:${req.params.id}`);
  res.json({ success: true });
});

// ⏳ Force expire
router.post("/expire/:id", async (req, res) => {
  await redis.hSet(`proposal:${req.params.id}`, {
    expiresAt: new Date().toISOString()
  });
  res.json({ success: true });
});

export default router;
