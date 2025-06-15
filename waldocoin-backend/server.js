import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Environment setup
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize app
const app = express();
const PORT = process.env.PORT || 5050;

// Basic middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Patch router to prevent bad route patterns
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

// Import routes
import loginRoutes from "./routes/login.js";
import mintRoutes from "./routes/mint.js";

// Patch and register routes
patchRouter(loginRoutes, "login.js");
patchRouter(mintRoutes, "mint.js");

app.use("/api/login", loginRoutes);
app.use("/api/mint", mintRoutes);

// Fallback
app.get("/", (req, res) => {
  res.send("🧩 WALDO SANITY RESTORE: login + mint.js");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ WALDO login + mint test server running at http://localhost:${PORT}`);
});
