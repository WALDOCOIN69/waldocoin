import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pkg from "xumm-sdk"; // ✅ This is the only correct xumm-sdk import
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
import { redis, connectRedis } from "./redisClient.js";
import proposalRoutes from "./routes/proposals.js";
import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config(); // ⬅️ MOVE THIS TO THE FIRST LINE

const PORT = process.env.PORT || 5050;
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

dotenv.config();

const app = express();
app.set("trust proxy", 1); // needed for accurate IP logging with proxies

// 🔒 CORS fix for WALDO admin dashboard
app.use(cors({
  origin: (origin, callback) => {
    const allowed = ["https://waldocoin.live", "https://waldocoin-1.onrender.com"];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key"],
  credentials: true,
  exposedHeaders: ["Content-Disposition"]
}));

app.use(express.json());
app.use("/api/login", loginRoutes);

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: "🚫 Too many requests, slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Routes
app.use("/api/linkTwitter", linkTwitterRoute);
app.use("/api/admin/security", adminSecurity);
app.use("/api/debug", debugRoutes);
app.use("/api/presale", presaleRoutes);
app.use("/api/vote", voteRoutes);
app.use("/api/trustline", trustlineRoute);
app.use("/api/userStats", userStatsRoute);
app.use("/api/price", priceRoute);
app.use("/api/claim", claimRoute);
app.use("/api/mint", mintRoute);
app.use("/api/mint/confirm", mintConfirmRoute);
app.use("/api/reward", rewardRoute);
app.use("/api/tweets", tweetsRoute);
app.use("/api/phase9/analytics", analyticsRoutes);
app.use("/api/phase9/admin", adminLogsRoutes);
app.use("/api/proposals", proposalRoutes);

// XUMM Login check
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

// XUMM login request
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

// Health check
app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});

app.get("/api/ping", (req, res) => {
  res.status(200).json({ status: "✅ WALDO API is online" });
});

// Startup block
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

startServer(); // 🔁 Call the startup function

