import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import loginRoutes from "./routes/login.js";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;

// ✅ CORS setup
app.use("/api/login", loginRoutes);
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

// ✅ Rate limit
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: "Too many requests. Please slow down.",
});
app.use(limiter);

// ✅ Simple routes
app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});

app.get("/api/ping", (req, res) => {
  res.json({ status: "✅ WALDO API is online" });
});

app.get("/test", (req, res) => {
  res.send("✅ Minimal route works");
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ WALDO API running at http://localhost:${PORT}`);
});


