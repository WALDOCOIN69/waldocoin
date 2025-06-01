import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname in ES modules
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

const dbPath = path.join(__dirname, "../db.json");

function loadDB() {
  if (!fs.existsSync(dbPath)) return {};
  return JSON.parse(fs.readFileSync(dbPath));
}

function saveDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

router.post("/", (req, res) => {
  const { wallet, handle } = req.body;

  if (!wallet || !handle) {
    return res.status(400).json({ success: false, error: "Missing wallet or handle" });
  }

  const db = loadDB();
  const user = db[wallet] || {};

  if (user.twitterHandle) {
    return res.status(400).json({ success: false, error: "Twitter already linked and locked." });
  }

  user.twitterHandle = handle;
  db[wallet] = user;
  saveDB(db);

  return res.json({ success: true, message: "Twitter handle linked successfully." });
});

export default router;

