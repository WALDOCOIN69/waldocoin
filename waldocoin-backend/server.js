import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
app.use(helmet());
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));

app.get("/", (_, res) => res.json({ status: "🧪 Phase 1 success" }));

app.listen(5050, () => console.log("✅ Middleware test running"));
