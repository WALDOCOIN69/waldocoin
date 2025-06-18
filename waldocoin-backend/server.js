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

// 🔗 Core WALDO routes
import loginRoute from "./routes/login.js";
import claimRoute from "./routes/claim.js";
import mintRoute from "./routes/mint.js";
import mintConfirmRoute from "./routes/mint/confirm.js";
import tweetsRoute from "./routes/tweets.js";
import statsRoute from "./routes/userstats.js";
import daoCreateRoute from "./routes/dao/create.js";
import daoVoteRoute from "./routes/dao/vote.js";
import daoExpireRoute from "./routes/dao/expire.js";
import daoDeleteRoute from "./routes/dao/delete.js";
import daoOverrideRoute from "./routes/dao/override.js";
import daoVoterHistoryRoute from "./routes/dao/voter-history.js";
import daoConfigRoute from "./routes/dao/config.js";
import daoArchiveRoute from "./routes/dao/archive.js";

// 🔗 Meme Battle system
import battleStartRoute from "./routes/battle/start.js";
import battleAcceptRoute from "./routes/battle/accept.js";
import battleVoteRoute from "./routes/battle/vote.js";
import battlePayoutRoute from "./routes/battle/payout.js";

import presaleEndDateRoute from "./routes/presale/end-date.js";
import presaleSetDateRoute from "./routes/presale/set-end-date.js";
import presaleCountdownRoute from "./routes/presale/countdown.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startServer = async () => {
  await connectRedis();

  const app = express();

  // 🛡️ Middleware
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
  });
  app.use(cors());
  app.use(helmet());
  app.use(limiter);
  app.use(express.json());

  // 🧩 WALDO API Routes
  app.use("/api/login", loginRoute);
  app.use("/api/claim", claimRoute);
  app.use("/api/mint", mintRoute);
  app.use("/api/mint/confirm", mintConfirmRoute);
  app.use("/api/tweets", tweetsRoute);
  app.use("/api/user-stats", statsRoute);
  app.use("/api/dao/create", daoCreateRoute);
  app.use("/api/dao/vote", daoVoteRoute);
  app.use("/api/dao/expire", daoExpireRoute);
  app.use("/api/dao/delete", daoDeleteRoute);
  app.use("/api/dao/override", daoOverrideRoute);
  app.use("/api/dao/voter-history", daoVoterHistoryRoute);
  app.use("/api/dao/config", daoConfigRoute);
  app.use("/api/dao/archive", daoArchiveRoute);
  app.use("/api/presale/end-date", presaleEndDateRoute);
  app.use("/api/presale/set-end-date", presaleSetDateRoute);
  app.use("/api/presale/countdown", presaleCountdownRoute);


  // ⚔️ Meme Battle Routes
  app.use("/api/battle/start", battleStartRoute);
  app.use("/api/battle/accept", battleAcceptRoute);
  app.use("/api/battle/vote", battleVoteRoute);
  app.use("/api/battle/payout", battlePayoutRoute);

  // 🧪 Render health check
  app.get("/", (req, res) => {
    res.send("✅ WALDO backend is live at /api/*");
  });

  // 🚀 Start server
  const PORT = process.env.PORT || 5050;
  app.listen(PORT, () => {
    console.log(`🧩 WALDO backend running on http://localhost:${PORT}`);
  });
};

startServer().catch(err => {
  console.error("❌ Startup error:", err);
  process.exit(1);
});
