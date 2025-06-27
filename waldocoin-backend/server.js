// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

import { connectRedis } from "./redisClient.js";
import { refundExpiredBattles } from "./cron/battleRefunder.js";

// 🔗 WALDO Routes
import loginRoute from "./routes/login.js";
import claimRoute from "./routes/claim.js";
import mintRoute from "./routes/mint.js";
import mintConfirmRoute from "./routes/mint/confirm.js";
import loginStatusRoute from "./routes/login/status.js";
import trustlineCheckRoute from "./routes/login/trustline-check.js";
import tweetsRoute from "./routes/tweets.js";
import userStatsRoute from "./routes/userstats.js";
import proposalsRoute from "./routes/proposals.js";
import conversionRoute from "./routes/conversion.js";
import topMemeRoute from "./routes/topmeme.js";

// ⚔️ Meme Battle Routes
import battleStartRoute from "./routes/battle/start.js";
import battleAcceptRoute from "./routes/battle/accept.js";
import battleVoteRoute from "./routes/battle/vote.js";
import battlePayoutRoute from "./routes/battle/payout.js";
import battleResultsRoute from "./routes/battle/results.js";
import battleCurrentRoute from "./routes/battle/current.js";

// 🧠 DAO Governance Routes
import daoCreateRoute from "./routes/dao/create.js";
import daoVoteRoute from "./routes/dao/vote.js";
import daoExpireRoute from "./routes/dao/expire.js";
import daoDeleteRoute from "./routes/dao/delete.js";
import daoOverrideRoute from "./routes/dao/override.js";
import daoVoterHistoryRoute from "./routes/dao/voter-history.js";
import daoConfigRoute from "./routes/dao/config.js";
import daoArchiveRoute from "./routes/dao/archive.js";

// 💰 Presale Route
import presaleRoute from "./routes/presale.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startServer = async () => {
  await connectRedis();

  const app = express();
  app.set("trust proxy", 1);

  // 🛡️ Security Middleware
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
  });
  app.use(cors());
  app.use(helmet());
  app.use(limiter);
  app.use(express.json());

  // 🚀 API Endpoints
  app.use("/api/login", loginRoute);
  app.use("/api/claim", claimRoute);
  app.use("/api/mint", mintRoute);
  app.use("/api/mint/confirm", mintConfirmRoute);
  app.use("/api/login/status", loginStatusRoute);
  app.use("/api/login/trustline-check", trustlineCheckRoute);
  app.use("/api/tweets", tweetsRoute);
  app.use("/api/userstats", userStatsRoute);
  app.use("/api/proposals", proposalsRoute);
  app.use("/api/conversion", conversionRoute);
  app.use("/api/topMeme", topMemeRoute);

  app.use("/api/battle/start", battleStartRoute);
  app.use("/api/battle/accept", battleAcceptRoute);
  app.use("/api/battle/vote", battleVoteRoute);
  app.use("/api/battle/payout", battlePayoutRoute);
  app.use("/api/battle/results", battleResultsRoute);
  app.use("/api/battle", battleCurrentRoute);

  app.use("/api/dao/create", daoCreateRoute);
  app.use("/api/dao/vote", daoVoteRoute);
  app.use("/api/dao/expire", daoExpireRoute);
  app.use("/api/dao/delete", daoDeleteRoute);
  app.use("/api/dao/override", daoOverrideRoute);
  app.use("/api/dao/voter-history", daoVoterHistoryRoute);
  app.use("/api/dao/config", daoConfigRoute);
  app.use("/api/dao/archive", daoArchiveRoute);

  app.use("/api/presale", presaleRoute);

  // 🧪 Health Check
  app.get("/", (req, res) => {
    res.send("✅ WALDO backend is live at /api/*");
  });

  // ⏱️ Cron Job — Check every 5 min for expired battles
  cron.schedule("*/5 * * * *", async () => {
    console.log("🕒 Checking for expired battles...");
    await refundExpiredBattles();
  });

  const PORT = process.env.PORT || 5050;
  app.listen(PORT, () => {
    console.log(`🧩 WALDO backend running on http://localhost:${PORT}`);
  });
};

// 🚀 Boot the server
startServer().catch((err) => {
  console.error("❌ Startup error:", err);
  process.exit(1);
});

