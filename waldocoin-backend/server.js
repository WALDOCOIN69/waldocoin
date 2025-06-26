import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

import { connectRedis } from "./redisClient.js";

// 🔗 WALDO routes
import loginRoute from "./routes/login.js";
import claimRoute from "./routes/claim.js";
import mintRoute from "./routes/mint.js";
import mintConfirmRoute from "./routes/mint/confirm.js";
import loginStatusRoute from "./routes/login/status.js";
import tweetsRoute from "./routes/tweets.js";
import userStatsRoute from "./routes/userstats.js";
import daoCreateRoute from "./routes/dao/create.js";
import daoVoteRoute from "./routes/dao/vote.js";
import daoExpireRoute from "./routes/dao/expire.js";
import daoDeleteRoute from "./routes/dao/delete.js";
import daoOverrideRoute from "./routes/dao/override.js";
import daoVoterHistoryRoute from "./routes/dao/voter-history.js";
import daoConfigRoute from "./routes/dao/config.js";
import daoArchiveRoute from "./routes/dao/archive.js";
import trustlineCheckRoute from "./routes/login/trustline-check.js";
import proposalsRoute from "./routes/proposals.js";
import battleResultsRoute from "./routes/battle/results.js";
import topMemeRoute from "./routes/topmeme.js";

// in server.js
import conversionRoute from "./routes/conversion.js";

// 🔗 Unified Presale route
import presaleRoute from "./routes/presale.js";

// ⚔️ Meme Battle routes
import battleStartRoute from "./routes/battle/start.js";
import battleAcceptRoute from "./routes/battle/accept.js";
import battleVoteRoute from "./routes/battle/vote.js";
import battlePayoutRoute from "./routes/battle/payout.js";
import battleCurrentRoute from "./routes/battle/current.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startServer = async () => {
  await connectRedis(); // Ensure Redis is ready before launching server

  const app = express();
  app.set("trust proxy", 1);

  // 🛡️ Middleware
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
  });
  app.use(cors());
  app.use(helmet());
  app.use(limiter);
  app.use(express.json());

  // 🚀 WALDO API Routes
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



  // ⚔️ Meme Battles
  app.use("/api/battle/start", battleStartRoute);
  app.use("/api/battle/accept", battleAcceptRoute);
  app.use("/api/battle/vote", battleVoteRoute);
  app.use("/api/battle/payout", battlePayoutRoute);
  app.use("/api/battle/results", battleResultsRoute);
  app.use("/api/battle", battleCurrentRoute);

  // 🧠 DAO Governance
  app.use("/api/dao/create", daoCreateRoute);
  app.use("/api/dao/vote", daoVoteRoute);
  app.use("/api/dao/expire", daoExpireRoute);
  app.use("/api/dao/delete", daoDeleteRoute);
  app.use("/api/dao/override", daoOverrideRoute);
  app.use("/api/dao/voter-history", daoVoterHistoryRoute);
  app.use("/api/dao/config", daoConfigRoute);
  app.use("/api/dao/archive", daoArchiveRoute);

  // 💰 Presale
  app.use("/api/presale", presaleRoute);

  // 🧪 Health check
  app.get("/", (req, res) => {
    res.send("✅ WALDO backend is live at /api/*");
  });

  const PORT = process.env.PORT || 5050;
  app.listen(PORT, () => {
    console.log(`🧩 WALDO backend running on http://localhost:${PORT}`);
  });
};

startServer().catch((err) => {
  console.error("❌ Startup error:", err);
  process.exit(1);
});
