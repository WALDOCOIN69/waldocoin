import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🧩 Loaded: routes/adminsecurity.js");

// ✅ Patch router for strict route validation
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string") {
        if (/:[^\/]+:/.test(path) || /:(\/|$)/.test(path)) {
          console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
          throw new Error(`❌ Invalid route pattern in ${file}: ${path}`);
        }
      }
      return original.call(this, path, ...handlers);
    };
  }
};

const router = express.Router();
patchRouter(router, path.basename(__filename));

// ✅ Simple route for testing
router.get("/ping", (req, res) => {
  res.json({ status: "adminsecurity route is live" });
});

export default router;

