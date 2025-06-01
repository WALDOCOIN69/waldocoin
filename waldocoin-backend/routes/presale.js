import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js"; // ✅ Import patchRouter

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
patchRouter(router, path.basename(__filename)); // ✅ Patch route checker

router.get("/end-date", (req, res) => {
  res.json({ endDate: new Date(Date.now() + 3 * 86400000).toISOString() });
});

export default router;
