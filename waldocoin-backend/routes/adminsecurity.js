import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js"; // ✅ Use only the imported version

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// patchRouter(router, path.basename(__filename)); // ✅ Route pattern validation
console.log("🧩 Loaded: routes/adminsecurity.js");

// ✅ Simple test route
router.get("/ping", (req, res) => {
  res.json({ status: "adminsecurity route is live" });
});

export default router;
