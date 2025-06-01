// utils/patchRouter.js - PATCH INCLUDED LOCALLY HERE FOR SAFETY CHECKS
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

// Must be first
import dotenv from "dotenv";
dotenv.config();

// Fallback dummy values BEFORE imports that use them
process.env.XUMM_API_KEY = process.env.XUMM_API_KEY || "dummy";
process.env.XUMM_API_SECRET = process.env.XUMM_API_SECRET || "dummy";

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { XummSdk } from "xumm-sdk";

import loginRoutes from "./routes/login.js";
import claimRoute from "./routes/claim.js";
import mintRoute from "./routes/mint.js";
import mintConfirmRoute from "./routes/mintConfirm.js";
import rewardRoute from "./routes/reward.js";
import tweetsRoute from "./routes/tweets.js";
import adminSecurity from "./routes/adminsecurity.js";
import analyticsRoutes from "./routes/analytics.js";
import adminLogsRoutes from "./routes/adminLogs.js";
import presaleRoutes from "./routes/presale.js";
import voteRoutes from "./routes/vote.js";
import debugRoutes from "./routes/debug.js";
import userStatsRoute from "./routes/userstats.js";
import priceRoute from "./routes/price.js";
import trustlineRoute from "./routes/trustline.js";
import linkTwitterRoute from "./routes/linkTwitter.js";
import proposalRoutes from "./routes/proposals.js";
import { redis, connectRedis } from "./redisClient.js";

const app = express();
const PORT = process.env.PORT || 5050;
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// CORS setup
const allowedOrigins = [
  "https://waldocoin.live",
  "https://www.waldocoin.live",
  "https://waldocoin-1.onrender.com"
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key"],
  credentials: true,
  exposedHeaders: ["Content-Disposition"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.set("trust proxy", 1);
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: "🚫 Too many requests, slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const safeRegister = (path, route) => {
  try {
    console.log("🧪 Attempting to register route:", path);

    // 🧨 Manually inspect route stack for all paths
    const routerStack = route.stack || [];
    for (const layer of routerStack) {
      if (typeof layer?.route?.path === "string" && /:[^\/]+:/.test(layer.route.path)) {
        throw new Error(`❌ BAD NESTED ROUTE: ${layer.route.path}`);
      }
    }

    app.use(path, route);
    console.log(`✅ Route registered: ${path}`);
  } catch (err) {
    console.error(`❌ Route FAILED: ${path}`);
    console.error(err.stack);
    process.exit(1);
  }
};

safeRegister("/api/login", loginRoutes);
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

// Health check
app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});

app.get("/api/ping", (req, res) => {
  res.status(200).json({ status: "✅ WALDO API is online" });
});

// XUMM login routes
app.get("/api/login/status/:uuid", async (req, res) => {
  const { uuid } = req.params;
  try {
    const result = await xumm.payload.get(uuid);
    if (result.meta.signed === true && result.response.account) {
      return res.json({ signed: true, wallet: result.response.account });
    }
    res.json({ signed: false });
  } catch (err) {
    console.error("❌ Error checking login status:", err);
    res.status(500).json({ error: "Failed to check sign-in status." });
  }
});

app.get("/api/login", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: { TransactionType: "SignIn" },
    });
    res.json({ qr: payload.refs.qr_png, uuid: payload.uuid });
  } catch (err) {
    console.error("❌ Error creating XUMM payload:", err);
    res.status(500).json({ error: "Failed to create XUMM sign-in." });
  }
});

// Start server
const startServer = async () => {
  try {
    await connectRedis();
    console.log("✅ Redis connected");

    app.listen(PORT, () => {
      console.log(`✅ WALDO API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
};

app._router.stack.forEach(r => {
  if (r.route && r.route.path) {
    console.log("✅ Loaded route:", r.route.path);
  }
});

startServer();

