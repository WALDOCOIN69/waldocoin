import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
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
import loginRoute from "./routes/login.js";
import userStatsRoute from "./routes/userstats.js";



dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use("/api/admin/security", adminSecurity)
app.use("/api/debug", debugRoutes);
app.use("/api/presale", presaleRoutes);
app.use("/api/vote", voteRoutes);
app.use("/api/trustline", trustlineRoute);
app.use("/api/userStats", userStatsRoute);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: "🚫 Too many requests, slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use("/api/login", loginRoute);
app.use("/api/claim", claimRoute);
app.use("/api/mint", mintRoute);
app.use("/api/mint/confirm", mintConfirmRoute);
app.use("/api/reward", rewardRoute);
app.use("/api/tweets", tweetsRoute);
app.use("/api/phase9/analytics", analyticsRoutes);
app.use("/api/phase9/admin", adminLogsRoutes);


app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});
// Simple API Health Check (Ping Endpoint)
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: "✅ WALDO API is online" });
});

app.listen(PORT, () => {
  console.log(`✅ WALDO API running on http://localhost:${PORT}`);
});

