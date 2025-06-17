// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

import { connectRedis } from "./redisClient.js";
import loginRoute from "./routes/login.js";
import claimRoute from "./routes/claim.js";
import mintConfirmRoute from "./routes/mint/confirm.js";
// import mintRoute from "./routes/mint.js"; // ⛔ optional

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Async function to connect Redis and launch server
const startServer = async () => {
  await connectRedis();

  const app = express();

  // 🔐 Middleware
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 100,
  });
  app.use(cors());
  app.use(helmet());
  app.use(limiter);
  app.use(express.json());

  // 🔗 Routes
  app.use("/api/login", loginRoute);
  app.use("/api/claim", claimRoute);
  app.use("/api/mint/confirm", mintConfirmRoute);
  // app.use("/api/mint", mintRoute); // ⛔ optional: enable if needed

  // 🔍 Root status
  app.get("/", (req, res) => {
    res.send("✅ WALDO backend is live at /api/*");
  });

  // 🚀 Start server
  const PORT = process.env.PORT || 5050;
  app.listen(PORT, () => {
    console.log(`🧩 WALDO backend running on http://localhost:${PORT}`);
  });
};

// 🚨 Start everything
startServer().catch(err => {
  console.error("❌ Startup error:", err);
  process.exit(1);
});

