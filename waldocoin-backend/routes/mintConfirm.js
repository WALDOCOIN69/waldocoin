// routes/mintConfirm.js
import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import xrpl from "xrpl";
import { uploadToIPFS } from "../utils/ipfsUploader.js";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router to catch malformed routes
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

dotenv.config();
const router = express.Router();
patchRouter(router, path.basename(__filename));

// 💥 Dummy fallback route to prevent router error
router.post("/confirm", async (req, res) => {
  res.json({ success: true, message: "Mint confirm stub active" });
});

export default router;

