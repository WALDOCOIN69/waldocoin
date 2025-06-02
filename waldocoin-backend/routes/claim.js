// 🔐 Safely register routes and detect malformed paths
const safeRegister = (path, route) => {
  try {
    console.log("🧪 Attempting to register route:", path);

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

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

// 🌐 Load environment variables
dotenv.config();

// 🛠️ Express app setup
const app = express();
const PORT = process.env.PORT || 5050;

// ✅ Core middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: "Too many requests. Please slow down.",
});
app.use(limiter);

// ✅ Simple health check routes
app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});

app.get("/api/ping", (req, res) => {
  res.json({ status: "✅ WALDO API is online" });
});

app.get("/test", (req, res) => {
  res.send("✅ Minimal route works");
});

// ✅ Route imports
import loginRoutes from "./login.js";
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

// ✅ Route registration (after app init!)
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
safeRegister("/api/proposals", proposalRoutes);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ WALDO API running at http://localhost:${PORT}`);
});

