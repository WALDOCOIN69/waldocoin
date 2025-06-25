import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "db.json");

// 🔧 Utility: Load and save DB file
const loadDB = () => JSON.parse(fs.readFileSync(dbPath, "utf8"));
const saveDB = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

// ✅ GET /api/presale — list of presale buyers
router.get("/", (req, res) => {
  try {
    const db = loadDB();
    const buyers = db.presale?.buyers || [];
    res.json(buyers);
  } catch (err) {
    console.error("❌ Failed to load presale buyers:", err);
    res.status(500).json({ error: "Failed to load presale buyers" });
  }
});

// ✅ GET /api/presale/airdrops — airdrop history
router.get("/airdrops", (req, res) => {
  try {
    const db = loadDB();
    const airdrops = db.presale?.airdrops || [];
    res.json(airdrops);
  } catch (err) {
    console.error("❌ Failed to load airdrop history:", err);
    res.status(500).json({ error: "Failed to load airdrop history" });
  }
});

// ✅ GET /api/presale/countdown — return current presale end date
router.get("/countdown", (req, res) => {
  try {
    const db = loadDB();
    res.json({ endDate: db.presale?.endDate || null });
  } catch (err) {
    console.error("❌ Failed to load countdown:", err);
    res.status(500).json({ error: "Failed to load countdown" });
  }
});

// ✅ POST /api/presale/set-end-date — update countdown (admin key required)
router.post("/set-end-date", (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid admin key" });
  }

  const { newDate } = req.body;
  if (!newDate || isNaN(Date.parse(newDate))) {
    return res.status(400).json({ error: "Invalid or missing date" });
  }

  try {
    const db = loadDB();
    db.presale = db.presale || {};
    db.presale.endDate = newDate;
    saveDB(db);
    res.json({ success: true, endDate: newDate });
  } catch (err) {
    console.error("❌ Failed to update countdown:", err);
    res.status(500).json({ error: "Failed to save countdown" });
  }
});

export default router;

