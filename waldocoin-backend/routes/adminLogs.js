import express from "express";
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

// 📜 Admin Logs (Mock)
router.get("/logs", (req, res) => {
  res.json([
    { timestamp: new Date().toISOString(), action: "Airdrop sent to rXYZ" },
    { timestamp: new Date().toISOString(), action: "Fake battle created" },
    { timestamp: new Date().toISOString(), action: "XP leaderboard updated" }
  ]);
});

export default router;
