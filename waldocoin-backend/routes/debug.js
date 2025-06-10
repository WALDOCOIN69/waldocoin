import express from "express";
import { redis } from "../redisClient.js";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Patch router for route validation
const __filename = fileURLToPath(import.meta.url);
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (routePath, ...handlers) {
      if (typeof routePath === "string" && /:[^\/]+:/.test(routePath)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${routePath}`);
        throw new Error(`❌ Invalid route pattern in ${file}: ${routePath}`);
      }
      return original.call(this, routePath, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

const BATTLE_LIST_KEY = "battles:list";

// 🧱 Create Fake Battle
router.post("/fake-battle", async (req, res) => {
  const id = "test-" + Date.now();
  const battle = {
    battleId: id,
    meme1: "test-meme-1",
    meme2: "test-meme-2",
    startTime: new Date().toISOString(),
    votes: { meme1: 0, meme2: 0 },
    ended: false
  };

  try {
    await redis.set(`battles:data:${id}`, JSON.stringify(battle));
    await redis.lPush(BATTLE_LIST_KEY, id);
    await redis.set("battles:active", id);
    return res.json({ success: true, battleId: id });
  } catch (err) {
    console.error("❌ Failed to create fake battle:", err);
    return res.status(500).json({ error: "Redis error", detail: err.message });
  }
});

// 👁️ View All Battles
router.get("/battles", async (req, res) => {
  try {
    const ids = await redis.lRange(BATTLE_LIST_KEY, 0, -1);
    const battles = await Promise.all(ids.map(async id => {
      const raw = await redis.get(`battles:data:${id}`);
      return JSON.parse(raw);
    }));
    return res.json(battles);
  } catch (err) {
    console.error("❌ Failed to fetch battles:", err);
    return res.status(500).json({ error: "Redis error", detail: err.message });
  }
});

// ♻️ Reset Active Battle
router.post("/reset-active", async (req, res) => {
  try {
    const activeId = await redis.get("battles:active");
    if (!activeId) return res.json({ success: false, message: "No active battle to reset." });

    const data = JSON.parse(await redis.get(`battles:data:${activeId}`));
    data.ended = true;
    await redis.set(`battles:data:${activeId}`, JSON.stringify(data));
    await redis.del("battles:active");

    return res.json({ success: true, message: "Active battle has been reset." });
  } catch (err) {
    return res.status(500).json({ error: "Failed to reset battle", detail: err.message });
  }
});

// 🗳️ Cast Vote
router.post("/vote", async (req, res) => {
  const { wallet, choice } = req.body;
  if (!wallet || !choice) return res.status(400).json({ error: "Missing wallet or choice" });

  try {
    const activeId = await redis.get("battles:active");
    if (!activeId) return res.status(404).json({ error: "No active battle found" });

    const battleKey = `battles:data:${activeId}`;
    const raw = await redis.get(battleKey);
    const battle = JSON.parse(raw);

    battle.votes[choice] = (battle.votes[choice] || 0) + 1;
    await redis.set(battleKey, JSON.stringify(battle));

    return res.json({ success: true, votes: battle.votes });
  } catch (err) {
    return res.status(500).json({ error: "Voting failed", detail: err.message });
  }
});

// 💸 Trigger Manual Payout (Testing Only)
router.post("/payout", async (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ error: "Missing battleId" });

  try {
    const battleKey = `battles:data:${battleId}`;
    const raw = await redis.get(battleKey);
    if (!raw) return res.status(404).json({ error: "Battle not found" });

    const battle = JSON.parse(raw);
    if (battle.ended) return res.status(400).json({ error: "Battle already ended" });

    battle.ended = true;
    await redis.set(battleKey, JSON.stringify(battle));
    await redis.del("battles:active");

    return res.json({ success: true, message: `Payout complete for ${battleId}` });
  } catch (err) {
    return res.status(500).json({ error: "Payout failed", detail: err.message });
  }
});

export default router;
