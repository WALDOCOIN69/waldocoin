import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

console.log("🧩 Loaded: routes/adminsecurity.js");

// ✅ Simple test route
router.get("/ping", (req, res) => {
  res.json({ status: "adminsecurity route is live" });
});

export default router;
