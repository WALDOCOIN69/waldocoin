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
}

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

// Route registration with logs for debugging
const register = (path, route) => {
  console.log("✅ Registering route:", path);
  app.use(path, route);
};

register("/api/login", loginRoutes);
register("/api/claim", claimRoute);
register("/api/mint", mintRoute);
register("/api/mint/confirm", mintConfirmRoute);
register("/api/reward", rewardRoute);
register("/api/tweets", tweetsRoute);
register("/api/linkTwitter", linkTwitterRoute);
register("/api/admin/security", adminSecurity);
register("/api/debug", debugRoutes);
register("/api/presale", presaleRoutes);
register("/api/vote", voteRoutes);
register("/api/trustline", trustlineRoute);
register("/api/userStats", userStatsRoute);
register("/api/price", priceRoute);
register("/api/phase9/analytics", analyticsRoutes);
register("/api/phase9/admin", adminLogsRoutes);
register("/api/proposals", proposalRoutes);

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

startServer();

