// server.js

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import helmet from "helmet";

import { connectRedis } from "./redisClient.js";
import { getXummClient } from "./utils/xummClient.js";

import loginRoutes from "./routes/login.js";

dotenv.config();
console.log("🦄 WALDO SANITY TEST: If you see this, you are running the REAL latest code.");
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION 🚨:", err);
});

const app = express();
app.use(helmet());
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));

const allowedOrigins = [
  "https://waldocoin.live",
  "https://www.waldocoin.live",
  "http://localhost:3000"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("❌ CORS policy does not allow this origin."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key"]
}));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-admin-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (_, res) => res.sendStatus(200));

app.use((req, res, next) => {
  if (req.path.endsWith("/") && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    return res.redirect(301, req.path.slice(0, -1) + query);
  }
  next();
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err)
    return res.status(400).json({ error: 'Invalid JSON payload' });
  next();
});

// ✅ Safe route registration
const safeRegister = (path, route) => {
  try {
    if (!route || typeof route !== "function" || !route.stack) {
      console.error(`❌ Invalid route handler for ${path}:`, route);
      throw new Error(`❌ Invalid route handler for ${path}`);
    }
    console.log(`🧪 Registering route: ${path}`);
    app.use(path, route);
    console.log(`✅ Registered: ${path}`);
  } catch (err) {
    console.error(`❌ Route FAILED: ${path}`);
    console.error(err.stack || err.message);
    process.exit(1);
  }
};

// ✅ Active route: login only
safeRegister("/api/login", loginRoutes);

// ✅ Health check
app.get("/", (_, res) => res.json({ status: "🚀 WALDO API is live!" }));
app.get("/api/ping", (_, res) => res.json({ status: "✅ WALDO API is online" }));

// 🕒 Cron (keep commented for now)
// import { scheduleWipeMemeJob } from "./cron/wipeMemeJob.js";
// scheduleWipeMemeJob();

const PORT = process.env.PORT || 5050;
const startServer = async () => {
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`✅ WALDO API running at http://localhost:${PORT}`);
  });
};

startServer().catch(err => {
  console.error("❌ WALDO API startup failed:", err);
  process.exit(1);
});
