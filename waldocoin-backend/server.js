// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import './utils/logRedactor.js';

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

// Buy bot completely removed - using volume trading bot only
// No Telegram bot imports to prevent conflicts

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
import adminVolumeBotRoute from "./routes/admin/volumeBot.js";



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
  // Restrict CORS to trusted origins only (allow root + subdomains of waldo/waldocoin)
  const allowedOriginsRaw = (process.env.CORS_ALLOWED_ORIGINS || "https://waldocoin.live,https://waldo.live,https://admin-vip-only-page.waldocoin.live,https://staking.waldocoin.live,https://waldocoin.onrender.com").split(",").map(s => s.trim());
  const allowedHosts = ["waldo.live", "waldocoin.live", "admin-vip-only-page.waldocoin.live", "staking.waldocoin.live", "waldocoin.onrender.com"]; // base hosts
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow curl/local
      try {
        const u = new URL(origin);
        const hostOk = allowedHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
        // Also allow exact origins provided via env var
        const originOk = allowedOriginsRaw.includes(origin);
        return cb(null, hostOk || originOk);
      } catch (e) {
        return cb(null, false);
      }
    },
    credentials: false
  }));
  // Ensure preflight (OPTIONS) also returns proper CORS headers for cross-site POSTs
  // Express 5 + path-to-regexp v6 doesn't accept '*' here; use a regex to match all paths
  app.options(/.*/, cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const u = new URL(origin);
        const hostOk = allowedHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
        const originOk = allowedOriginsRaw.includes(origin);
        return cb(null, hostOk || originOk);
      } catch (e) {
        return cb(null, false);
      }
    },
    credentials: false,
    methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With']
  }));


  app.use(helmet({
    contentSecurityPolicy: false // CSP typically handled at CDN/WordPress level
  }));
  app.use(limiter);
  app.use(express.json({ limit: '1mb' }));

  // 🚀 API Endpoints
  app.use("/api/login", loginRoute);
  app.use("/api/claim", claimRoute);
  app.use("/api/mint", mintRoute);
  app.use("/api/mint/confirm", mintConfirmRoute);
  app.use("/api/login/status", loginStatusRoute);
  app.use("/api/login/trustline-check", trustlineCheckRoute);
  app.use("/api/tweets", tweetsRoute);
  app.use("/api/userstats", userStatsRoute);
  app.use("/api/userMemes", (await import("./routes/userMemes.js")).default);
  app.use("/api/policy", (await import("./routes/policy.js")).default);
  app.use("/api/config", (await import("./routes/config.js")).default);
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
  app.use("/api/market/wlo", (await import("./routes/market/wlo.js")).default);
  app.use("/api/xrpl/trade", (await import("./routes/xrpl/trade.js")).default);
  app.use("/api/xrpl/trustline", (await import("./routes/xrpl/trustline.js")).default);
  app.use("/api/xrpl/balance", (await import("./routes/xrpl/balance.js")).default);
  app.use("/api/debug/autodistribute", (await import("./routes/debug/autodistribute.js")).default);



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
  app.use("/api/admin/volume-bot", adminVolumeBotRoute);

  // Note: User authentication is handled by XUMM login flow in /api/login

  app.use("/api/presale", presaleRoute);
  app.use('/api/presale', presaleLookup);

  // Health check endpoint
  app.get("/api/health", (_, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      version: "2025-09-16-auto-unstake",
      endpoints: {
        airdrop: "/api/airdrop",
        trustlineCount: "/api/airdrop/trustline-count",
        tokenomics: "/api/tokenomics/stats",
        admin: "/api/admin/send-waldo"
      }
    });
  });

  app.get("/api/routes", (_, res) => {
    try {
      const normalizePath = (p, layer) => {
        if (typeof p === 'string') return p;
        if (Array.isArray(p)) return p.join('|');
        // Best-effort derive mount path from layer regexp
        if (layer && layer.regexp) {
          if (layer.regexp.fast_slash) return '/';
          const src = layer.regexp.toString();
          return src;
        }
        return '';
      };

      const out = [];
      const stack = (app._router && app._router.stack) || [];
      for (const layer of stack) {
        try {
          if (layer && layer.route) {
            const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase());
            out.push({ methods, path: normalizePath(layer.route.path, layer) });
          } else if (layer && layer.name === 'router' && layer.handle && layer.handle.stack) {
            const mount = normalizePath(layer.path || layer.regexp, layer);
            for (const s of layer.handle.stack) {
              if (s && s.route) {
                const methods = Object.keys(s.route.methods || {}).map(m => m.toUpperCase());
                const sub = normalizePath(s.route.path, s);
                out.push({ methods, path: `${mount}${sub}` });
              }
            }
          }
        } catch (_) { /* skip malformed layer */ }
      }
      res.json({ success: true, count: out.length, routes: out });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
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
  // Do not log secrets. Only indicate presence and derive public address for validation.
  if (process.env.WALDO_DISTRIBUTOR_SECRET) {
    console.log("Render ENV WALDO_DISTRIBUTOR_SECRET: Loaded");
    try {
      const testWallet = xrpl.Wallet.fromSeed(process.env.WALDO_DISTRIBUTOR_SECRET);
      console.log("🔍 Distributor wallet (public):", testWallet.classicAddress);
    } catch (e) {
      console.error("❌ Invalid WALDO_DISTRIBUTOR_SECRET (seed could not derive address):", e.message);
    }
  } else {
    console.warn("⚠️ WALDO_DISTRIBUTOR_SECRET not set");
  }

  // 🤖 Telegram Webhook Route - DISABLED (using polling instead)
  app.post("/webhook/telegram", express.json(), (req, res) => {
    console.log("📨 Telegram webhook received but ignored (using polling)");
    // Webhook disabled - volume bot uses polling instead
    res.sendStatus(200);
  });

  // 🧪 Health Check
  app.get("/", (_, res) => {
    res.send("✅ WALDO backend is live at /api/*");
  });

  // 🔍 Webhook Test Endpoint - REMOVED DUPLICATE
  // Duplicate webhook endpoint removed to prevent conflicts

  app.get("/webhook/telegram", (_, res) => {
    res.send("🤖 Telegram webhook endpoint is active. Bot global status: " + (global.telegramBot ? "✅ Available" : "❌ Not available"));
  });

  // Set webhook endpoint - DISABLED (using polling instead)
  // app.post('/set-webhook', async (req, res) => {
  //   try {
  //     console.log('🔗 Setting up Telegram webhook...');
  //     const BOT_TOKEN = process.env.BOT_TOKEN;
  //     const WEBHOOK_URL = 'https://waldocoin-backend-api.onrender.com/webhook/telegram';

  //     const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ url: WEBHOOK_URL })
  //     });

  //     const data = await response.json();
  //     console.log('🔗 Webhook setup result:', data);

  //     res.json({ success: true, webhook: data });
  //   } catch (error) {
  //     console.error('❌ Webhook setup error:', error);
  //     res.status(500).json({ error: error.message });
  //   }
  // });

  // Test endpoint to manually trigger bot
  app.post('/test-bot', async (req, res) => {
    try {
      console.log('🧪 Manual bot test triggered');
      const BOT_TOKEN = process.env.BOT_TOKEN;
      const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

      // Test getMe
      const meResponse = await fetch(`${TELEGRAM_API}/getMe`);
      const meData = await meResponse.json();
      console.log('🤖 getMe result:', meData);

      // Test getUpdates
      const updatesResponse = await fetch(`${TELEGRAM_API}/getUpdates`);
      const updatesData = await updatesResponse.json();
      console.log('📨 getUpdates result:', updatesData);

      res.json({ success: true, me: meData, updates: updatesData });
    } catch (error) {
      console.error('❌ Manual bot test error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ⏱️ Cron Job — Check every 5 min for expired battles
  cron.schedule("*/5 * * * *", async () => {
    console.log("🕒 Checking for expired battles...");
    await refundExpiredBattles();
  });

  const PORT = process.env.PORT || 5050;
  app.listen(PORT, () => {
    console.log(`🧩 WALDO backend running on http://localhost:${PORT} - UPDATED ${new Date().toISOString()}`);
  });
};



// 🚀 Boot everything (server only - buy bot completely removed)
const boot = async () => {
  try {
    console.log("🤖 Buy Bot completely disabled - using volume trading bot only");
    await startServer();
    console.log("🚀 Server started successfully (no Telegram bot conflicts)");
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
};

boot();


