// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";
import mintConfirmRoute from "./routes/mint/confirm.js";
import dotenv from "dotenv";
dotenv.config();

import loginRoute from "./routes/login.js";
import claimRoute from "./routes/claim.js"; // ✅ re-enable claim
// import mintRoute from "./routes/mint.js"; // ❌ optional, keep disabled if testing

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
});

app.use(cors());
app.use(helmet());
app.use(limiter);
app.use(express.json());


// 🧩 Load WALDO routes
app.use("/api/login", loginRoute);
app.use("/api/claim", claimRoute); // ✅ claim enabled
// app.use("/api/mint", mintRoute); // ❌ keep off if needed
app.use("/api/mint/confirm", mintConfirmRoute);

app.get("/", (req, res) => {
  res.send("✅ WALDO login + claim test server running at http://localhost:5050");
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🧩 WALDO login + claim test server running at http://localhost:${PORT}`);
});
