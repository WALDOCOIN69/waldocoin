import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import helmet from "helmet";

import { validateRoutes } from "./utils/validateRoutes.js";
import { connectRedis } from "./redisClient.js";
import { getXummClient } from "./utils/xummClient.js";

// 🌐 Load environment variables
dotenv.config();
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

// 🛠️ Express app setup
const app = express();
app.use(helmet());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// ✅ Version check
app.get("/api/version", (req, res) => {
  res.json({ version: "1.0.0", updated: "2025-06-09", uptime: process.uptime() });
});

// ✅ CORS setup
const allowedOrigins = [
  "https://waldocoin.live",
  "https://www.waldocoin.live",
  "http://localhost:3000"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("❌ CORS policy does not allow this origin."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key"]
}));

// 🔁 Global headers for Render
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-admin-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (req, res) => res.sendStatus(200));

// ✅ JSON + Rate limit
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 100, message: "Too many requests. Please slow down." }));

// ✅ Remove trailing slash
app.use((req, res, next) => {
  if (req.path.endsWith("/") && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + query);
  } else {
    next();
  }
});

app.use("/api/login", loginRoutes);

// ✅ Health check
app.get("/", (req, res) => res.json({ status: "🚀 WALDO API is live!" }));
app.get("/api/ping", (req, res) => res.json({ status: "✅ WALDO API is online" }));
app.get("/test", (req, res) => res.send("✅ Minimal route works"));

// ✅ Route validator
validateRoutes();
console.log("🧪 Route validation complete. No issues.");

// ✅ Safe route registration
const safeRegister = (path, route) => {
  try {
    if (!route || typeof route !== "function" || !route.stack) {
      throw new Error(`❌ Invalid route handler for path: ${path}`);
    }

    console.log(`🧪 Attempting to register route: ${path}`);

    // Example validation for route path (if needed)
    // if (/:[^\/:]+:/.test(path) || /:[^\/]+:$/.test(path)) {
    //   throw new Error(`❌ BAD NESTED ROUTE PATTERN: ${path}`);
    // }
    // if (/:(\/|$)/.test(path)) {
    //   throw new Error(`❌ MISSING PARAM NAME IN ROUTE: ${path}`);
    // }

    app.use(path, route);
    console.log(`✅ Route registered: ${path}`);
  } catch (err) {
    console.error(`❌ Route FAILED: ${path}`);
    console.error(err.stack);
    process.exit(1);
  }
};

// ✅ Routes
import loginRoutes from "./routes/login.js";
//import claimRoute from "./routes/claim.js";
//import mintRoute from "./routes/mint.js";
//import mintConfirmRoute from "./routes/mintConfirm.js";
//import rewardRoute from "./routes/reward.js";
//import tweetsRoute from "./routes/tweets.js";
//import linkTwitterRoute from "./routes/linkTwitter.js";
//import adminSecurity from "./routes/adminsecurity.js";
//import debugRoutes from "./routes/debug.js";
//import presaleRoutes from "./routes/presale.js";
//import voteRoutes from "./routes/vote.js";
//import trustlineRoute from "./routes/trustline.js";
//import userStatsRoute from "./routes/userstats.js";
//import priceRoute from "./routes/price.js";
//import analyticsRoutes from "./routes/analytics.js";
//import adminLogsRoutes from "./routes/adminLogs.js";
//import proposalRoutes from "./routes/proposals.js";

// ✅ Register all routes

safeRegister("/api/claim", claimRoute);
//safeRegister("/api/mint", mintRoute);
//safeRegister("/api/mint/confirm", mintConfirmRoute);
//safeRegister("/api/reward", rewardRoute);
//safeRegister("/api/tweets", tweetsRoute);
//safeRegister("/api/linkTwitter", linkTwitterRoute);
//safeRegister("/api/admin/security", adminSecurity);
//safeRegister("/api/debug", debugRoutes);
//safeRegister("/api/presale", presaleRoutes);
//safeRegister("/api/vote", voteRoutes);
//safeRegister("/api/trustline", trustlineRoute);
//safeRegister("/api/userStats", userStatsRoute);
//safeRegister("/api/price", priceRoute);
//safeRegister("/api/phase9/analytics", analyticsRoutes);
//safeRegister("/api/phase9/admin", adminLogsRoutes);
//safeRegister("/api/proposals", proposalRoutes);

// 🕒 Cron jobs
import { scheduleWipeMemeJob } from "./cron/wipeMemeJob.js";
scheduleWipeMemeJob();

// 🚀 Start server
const PORT = process.env.PORT || 5050;
const startServer = async () => {
  await connectRedis();
  getXummClient(); // preload XUMM
  app.listen(PORT, () => {
    console.log(`✅ WALDO API running at http://localhost:${PORT}`);
  });
};

startServer().catch(err => {
  console.error("❌ WALDO API startup failed:", err);
  process.exit(1);
});


