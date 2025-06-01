import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js"; // ✅

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
patchRouter(router, path.basename(__filename)); // ✅ patch

router.get("/", (req, res) => {
  res.json({ status: "🎁 Reward route placeholder active." });
});

export default router;
