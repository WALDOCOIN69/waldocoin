import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for bad route detection
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && /:[^\/]+:/.test(path)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
      }
      return original.call(this, path, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

const battlesPath = path.join(__dirname, "..", "battles.json");

// ✅ Ensure battles.json exists
if (!fs.existsSync(battlesPath)) {
  fs.writeFileSync(battlesPath, "[]", "utf8");
}

// 🧱 Create a Fake Battle
router.post("/fake-battle", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(battlesPath, "utf8"));
    const newBattle = {
      battleId: "test-" + Date.now(),
      meme1: "test-meme-1",
      meme2: "test-meme-2",
      startTime: new Date().toISOString(),
      votes: { meme1: 0, meme2: 0 },
      ended: false,
    };
    data.unshift(newBattle);
    fs.writeFileSync(battlesPath, JSON.stringify(data, null, 2));
    res.json({ success: true, battleId: newBattle.battleId });
  } catch (err) {
    res.status(500).json({ error: "Failed to create fake battle", details: err.message });
  }
});

// 👁️ View All Battles
router.get("/battles", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(battlesPath, "utf8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to read battles.json", details: err.message });
  }
});

// ♻️ Reset Active Battle
router.post("/reset-active", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(battlesPath, "utf8"));
    if (data.length === 0) return res.json({ success: false, message: "No active battle to reset." });

    data[0].ended = true;
    fs.writeFileSync(battlesPath, JSON.stringify(data, null, 2));
    res.json({ success: true, message: "Active battle has been reset." });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset battle", details: err.message });
  }
});

// 🗳️ Cast Vote
router.post("/vote", (req, res) => {
  const { wallet, choice } = req.body;
  if (!wallet || !choice) return res.status(400).json({ error: "Missing wallet or choice." });

  try {
    const data = JSON.parse(fs.readFileSync(battlesPath, "utf8"));
    const activeBattle = data.find(b => !b.ended);
    if (!activeBattle) return res.status(404).json({ error: "No active battle found." });

    activeBattle.votes[choice] = (activeBattle.votes[choice] || 0) + 1;
    fs.writeFileSync(battlesPath, JSON.stringify(data, null, 2));
    res.json({ success: true, votes: activeBattle.votes });
  } catch (err) {
    res.status(500).json({ error: "Voting failed", details: err.message });
  }
});

// 💸 Trigger Payout
router.post("/payout", (req, res) => {
  const { battleId } = req.body;
  if (!battleId) return res.status(400).json({ error: "Missing battleId" });

  try {
    const data = JSON.parse(fs.readFileSync(battlesPath, "utf8"));
    const battle = data.find(b => b.battleId === battleId);
    if (!battle || battle.ended) return res.status(400).json({ error: "Invalid or ended battle" });

    battle.ended = true; // Simulated logic — replace with actual payout later
    fs.writeFileSync(battlesPath, JSON.stringify(data, null, 2));
    res.json({ success: true, message: `Payout complete for ${battleId}` });
  } catch (err) {
    res.status(500).json({ error: "Payout failed", details: err.message });
  }
});

export default router;

