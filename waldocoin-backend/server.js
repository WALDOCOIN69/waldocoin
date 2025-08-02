// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import dotenv from "dotenv";
import cron from "node-cron";
import xrpl from "xrpl";

dotenv.config();

import { connectRedis } from "./redisClient.js";
import { refundExpiredBattles } from "./cron/battleRefunder.js";

//airdrop
import airdropRoute from "./routes/airdrop.js";

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
import linkTwitterRoute from "./routes/linkTwitter.js";
import activityRoute from "./routes/activity.js";

import { startBuyBot } from "./waldoBuyBot.js";

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
import presaleLookup from "./routes/presaleLookup.js";

// 🔐 Admin Routes
import adminSendWaldoRoute from "./routes/admin/sendWaldo.js";
import adminTrustlineRoute from "./routes/admin/trustline.js";



const startServer = async () => {
  await connectRedis();


  // inside startServer()
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
  app.use("/api/userLevel", (await import("./routes/userLevel.js")).default);
  app.use("/api/tokenomics", (await import("./routes/tokenomics.js")).default);
  app.use("/api/security", (await import("./routes/security.js")).default);
  app.use("/api/staking", (await import("./routes/staking.js")).default);
  app.use("/api/marketplace", (await import("./routes/marketplace.js")).default);
  app.use("/api/burn", (await import("./routes/burn.js")).default);
  app.use("/api/battle", (await import("./routes/battle.js")).default);
  app.use("/api/dao", (await import("./routes/dao.js")).default);
  app.use("/api/users", (await import("./routes/users.js")).default);
  app.use("/api/rewards", (await import("./routes/rewards.js")).default);
  app.use("/api/proposals", proposalsRoute);
  app.use("/api/conversion", conversionRoute);
  app.use("/api/topMeme", topMemeRoute);
  app.use("/api/linkTwitter", linkTwitterRoute);
  app.use("/api/activity", activityRoute);
  app.use("/api/system", (await import("./routes/system.js")).default);

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

  console.log("🔗 Registering airdrop routes...");
  app.use("/api/airdrop", airdropRoute);

  console.log("🔐 Registering admin routes...");
  app.use("/api/admin/send-waldo", adminSendWaldoRoute);
  app.use("/api/admin/trustline", adminTrustlineRoute);

  app.use("/api/presale", presaleRoute);
  app.use('/api/presale', presaleLookup);

  // Health check endpoint
  app.get("/api/health", (_, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      version: "2025-01-21-v3",
      endpoints: {
        airdrop: "/api/airdrop",
        trustlineCount: "/api/airdrop/trustline-count",
        tokenomics: "/api/tokenomics/stats",
        admin: "/api/admin/send-waldo"
      }
    });
  });

  app.get("/api/routes", (_, res) => {
    res.json(app._router.stack
      .filter(r => r.route && r.route.path)
      .map(r => ({
        method: Object.keys(r.route.methods)[0].toUpperCase(),
        path: r.route.path
      }))
    );
  });

  app.get("/api/debug/refund", async (_, res) => {
    await refundExpiredBattles();
    res.send("✅ Refund logic manually triggered");
    refundExpiredBattles()
      .then(() => res.json({ success: true, message: "Manual refund triggered" }))
      .catch((err) =>
        res.status(500).json({ success: false, error: err.message })
      );
  });
  console.log("Render ENV WALDO_DISTRIBUTOR_SECRET:", process.env.WALDO_DISTRIBUTOR_SECRET);

  try {
    const testWallet = xrpl.Wallet.fromSeed(process.env.WALDO_DISTRIBUTOR_SECRET);
    console.log("🔍 Wallet Address from Secret:", testWallet.classicAddress);
  } catch (e) {
    console.error("❌ Invalid WALDO_DISTRIBUTOR_SECRET:", e.message);
  }

  // 🧪 Health Check
  app.get("/", (_, res) => {
    res.send("✅ WALDO backend is live at /api/*");
  });

  // ⏱️ Cron Job — Check every 5 min for expired battles
  cron.schedule("*/5 * * * *", async () => {
    console.log("🕒 Checking for expired battles...");
    await refundExpiredBattles();
  });

  const PORT = process.env.PORT || 5050;
  app.listen(PORT, () => {
    console.log(`🧩 WALDO backend running on http://localhost:${PORT} - UPDATED`);
  });
};

// 🚀 Boot everything (bot + server)
const boot = async () => {
  try {
    await startBuyBot();
    console.log("🤖 WALDO Buy Bot is running.");
    await startServer();
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
};

boot();


