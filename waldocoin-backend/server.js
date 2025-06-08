import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { connectRedis } from "./redisClient.js";
import { getXummClient } from "./utils/xummClient.js";

// 🌐 Load environment variables
dotenv.config();

// 🛠️ Express app setup
const app = express();

// ✅ Allow only trusted frontend origins
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

// 🔁 Global CORS headers middleware (REQUIRED for Render)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-admin-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

// ✅ Handle preflight OPTIONS request globally
app.options("*", (req, res) => {
  res.sendStatus(200);
});

// ✅ JSON & rate limiting
app.use(express.json());
const limiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: "Too many requests. Please slow down." });
app.use(limiter);

// ✅ Strip trailing slashes
app.use((req, res, next) => {
  if (req.path.endsWith("/") && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + query);
  } else {
    next();
  }
});

// ✅ Health check routes
app.get("/", (req, res) => res.json({ status: "🚀 WALDO API is live!" }));
app.get("/api/ping", (req, res) => res.json({ status: "✅ WALDO API is online" }));
app.get("/test", (req, res) => res.send("✅ Minimal route works"));

// ✅ Route registration helper with debug
const safeRegister = (path, route) => {
  try {
    console.log(`🧪 Attempting to register route: ${path}`);
    const routerStack = route.stack || [];
    for (const layer of routerStack) {
      if (typeof layer?.route?.path === "string") {
        console.log(`👉 Route path: ${layer.route.path}`);
        if (/:.+:.*/.test(layer.route.path)) {
          throw new Error(`❌ BAD ROUTE SYNTAX: ${layer.route.path}`);
        }
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

// ✅ Routes
import loginRoutes from "./routes/login.js";
import claimRoute from "./routes/claim.js";
import mintRoute from "./routes/mint.js";
import mintConfirmRoute from "./routes/mintConfirm.js";
import rewardRoute from "./routes/reward.js";
import tweetsRoute from "./routes/tweets.js";
import linkTwitterRoute from "./routes/linkTwitter.js";
import adminSecurity from "./routes/adminsecurity.js";
import debugRoutes from "./routes/debug.js";
import presaleRoutes from "./routes/presale.js";
import voteRoutes from "./routes/vote.js";
import trustlineRoute from "./routes/trustline.js";
import userStatsRoute from "./routes/userstats.js";
import priceRoute from "./routes/price.js";
import analyticsRoutes from "./routes/analytics.js";
import adminLogsRoutes from "./routes/adminLogs.js";
import proposalRoutes from "./routes/proposals.js";

// ✅ Register routes
app.use("/api/login", loginRoutes);
safeRegister("/api/claim", claimRoute);
safeRegister("/api/mint", mintRoute);
safeRegister("/api/mint/confirm", mintConfirmRoute);
safeRegister("/api/reward", rewardRoute);
safeRegister("/api/tweets", tweetsRoute);
safeRegister("/api/linkTwitter", linkTwitterRoute);
safeRegister("/api/admin/security", adminSecurity);
safeRegister("/api/debug", debugRoutes);
safeRegister("/api/presale", presaleRoutes);
safeRegister("/api/vote", voteRoutes);
safeRegister("/api/trustline", trustlineRoute);
safeRegister("/api/userStats", userStatsRoute);
safeRegister("/api/price", priceRoute);
safeRegister("/api/phase9/analytics", analyticsRoutes);
safeRegister("/api/phase9/admin", adminLogsRoutes);
//safeRegister("/api/proposals", proposalRoutes);

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


