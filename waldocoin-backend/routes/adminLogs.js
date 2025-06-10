import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js"; // ✅ Use shared version only

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

patchRouter(router, path.basename(__filename)); // ✅ Validates route syntax
console.log("🧩 Loaded: routes/adminLogs.js");

// 📜 Admin Logs (Mock)
router.get("/logs", (req, res) => {
  res.json([
    { timestamp: new Date().toISOString(), action: "Airdrop sent to rXYZ" },
    { timestamp: new Date().toISOString(), action: "Fake battle created" },
    { timestamp: new Date().toISOString(), action: "XP leaderboard updated" }
  ]);
});

export default router;
