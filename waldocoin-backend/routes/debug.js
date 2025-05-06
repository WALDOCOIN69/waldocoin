import express from "express";
import fs from "fs";
import path from "path";
const router = express.Router();

const dbPath = path.resolve("battles.json");

// GET /api/debug/battles
router.get("/battles", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(dbPath));
    res.json(data.battles || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to read battles.json" });
  }
});

// POST /api/debug/fake-battle
router.post("/fake-battle", (req, res) => {
  try {
    const db = JSON.parse(fs.readFileSync(dbPath));
    const newBattle = {
      battleId: "fake_" + Date.now(),
      meme1: "meme_1",
      meme2: "meme_2",
      votes: { meme1: 0, meme2: 0 },
      start: new Date().toISOString(),
      durationHours: 24
    };
    db.battles.unshift(newBattle);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.json({ success: true, newBattle });
  } catch (err) {
    res.status(500).json({ error: "Failed to write fake battle" });
  }
});

export default router;
