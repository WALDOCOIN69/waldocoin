import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pkg from "xumm-sdk"; // ✅ This is the only correct xumm-sdk import

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
import trustlineRoute from "./routes/trustline.js";
import debugRoutes from "./routes/debug.js";
import userStatsRoute from "./routes/userstats.js";
import priceRoute from "./routes/price.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;

const XummSdk = pkg;
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: "🚫 Too many requests, slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// ⬇️ Mount all routes
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


// ✅ XUMM Login Route
app.get("/api/login", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "SignIn",
      },
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid,
    });
  } catch (err) {
    console.error("❌ Error creating XUMM payload:", err);
    res.status(500).json({ error: "Failed to create XUMM sign-in." });
  }
});

// 🩺 Health Check
app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});

app.get("/api/ping", (req, res) => {
  res.status(200).json({ status: "✅ WALDO API is online" });
});

// ▶️ Start Server
app.listen(PORT, () => {
  console.log(`✅ WALDO API running on http://localhost:${PORT}`);
});

