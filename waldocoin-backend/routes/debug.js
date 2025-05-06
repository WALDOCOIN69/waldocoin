import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const battlesPath = path.join(__dirname, "..", "battles.json");

// Ensure file exists
function ensureBattleFile() {
  if (!fs.existsSync(battlesPath)) {
    fs.writeFileSync(battlesPath, "[]");
  }
}

// POST /api/debug/fake-battle
router.post("/fake-battle", (req, res) => {
  try {
    ensureBattleFile();
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
    console.error("❌ Failed to create fake battle:", err);
    res.status(500).json({ error: "Failed to create fake battle" });
  }
});

// GET /api/debug/battles
router.get("/battles", (req, res) => {
  try {
    ensureBattleFile();
    const data = JSON.parse(fs.readFileSync(battlesPath, "utf8"));
    res.json(data);
  } catch (err) {
    console.error("❌ Failed to read battles.json:", err);
    res.status(500).json({ error: "Failed to read battles.json" });
  }
});

export default router;


