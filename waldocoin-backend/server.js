import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import helmet from "helmet";

import { validateRoutes } from "./utils/validateRoutes.js";
import { connectRedis } from "./redisClient.js";
import { getXummClient } from "./utils/xummClient.js";

// 🌐 Load environment variables
dotenv.config();
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

// 🛠️ Express app setup
const app = express();
app.use(helmet());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// ✅ Version check
app.get("/api/version", (req, res) => {
  res.json({ version: "1.0.0", updated: "2025-06-09", uptime: process.uptime() });
});

// ✅ CORS setup
const allowedOrigins = [
  "https://waldocoin.live",
  "https://www.waldocoin.live",
  "http://localhost:3000"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("❌ CORS policy does not allow this origin."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key"]
}));

// 🔁 Global headers for Render
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-admin-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (req, res) => res.sendStatus(200));

// ✅ JSON + Rate limit
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 100, message: "Too many requests. Please slow down." }));

// ✅ Remove trailing slash
app.use((req, res, next) => {
  if (req.path.endsWith("/") && req.path.length > 1) {
    const query = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + query);
  } else {
    next();
  }
});

// ✅ Import routes early
import loginRoutes from "./routes/login.js";

// ✅ Direct registration test route
if (!loginRoutes || typeof loginRoutes !== "function" || !loginRoutes.stack) {
  console.error("❌ loginRoutes is invalid or undefined.");
  process.exit(1);
}
app.use("/api/login", loginRoutes);

// ✅ Health check
app.get("/", (req, res) => res.json({ status: "🚀 WALDO API is live!" }));
app.get("/api/ping", (req, res) => res.json({ status: "✅ WALDO API is online" }));
app.get("/test", (req, res) => res.send("✅ Minimal route works"));

// ✅ Route validator
// validateRoutes();
console.log("🧪 Route validation complete. No issues.");

// ✅ Safe route registration (for later routes)
const safeRegister = (path, route) => {
  try {
    if (!route || typeof route !== "function" || !route.stack) {
      throw new Error(`❌ Invalid route handler for path: ${path}`);
    }
    console.log(`🧪 Registering route: ${path}`);
    app.use(path, route);
    console.log(`✅ Registered: ${path}`);
  } catch (err) {
    console.error(`❌ Route FAILED: ${path}`);
    console.error(err.message);
    process.exit(1);
  }
};

// 🔒 All other routes commented for now (restore one-by-one safely)
// import claimRoute from "./routes/claim.js";
// safeRegister("/api/claim", claimRoute);

// 🕒 Cron jobs
import { scheduleWipeMemeJob } from "./cron/wipeMemeJob.js";
// scheduleWipeMemeJob();

// 🚀 Start server
const PORT = process.env.PORT || 5050;
const startServer = async () => {
  await connectRedis();
  // getXummClient(); // preload XUMM
  app.listen(PORT, () => {
    console.log(`✅ WALDO API running at http://localhost:${PORT}`);
  });
};

startServer().catch(err => {
  console.error("❌ WALDO API startup failed:", err);
  process.exit(1);
});


