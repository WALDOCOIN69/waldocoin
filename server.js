import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";

import loginRoute from "./waldocoin-backend/routes/login.js";
import claimRoute from "./waldocoin-backend/routes/claim.js";
import mintRoute from "./waldocoin-backend/routes/mint.js";
import mintConfirmRoute from "./waldocoin-backend/routes/mintConfirm.js";
import rewardRoute from "./waldocoin-backend/routes/reward.js";
import tweetsRoute from "./waldocoin-backend/routes/tweets.js";
import adminSecurity from "./waldocoin-backend/routes/adminsecurity.js";
import debugRoutes from "./waldocoin-backend/routes/debug.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use("/api/admin/security", adminSecurity)
app.use("/api/debug", debugRoutes);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  message: "🚫 Too many requests, slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use("/api/login", loginRoute);
app.use("/api/claim", claimRoute);
app.use("/api/mint", mintRoute);
app.use("/api/mint/confirm", mintConfirmRoute);
app.use("/api/reward", rewardRoute);
app.use("/api/tweets", tweetsRoute);

app.get("/", (req, res) => {
  res.json({ status: "🚀 WALDO API is live!" });
});

app.listen(PORT, () => {
  console.log(`✅ WALDO API running on http://localhost:${PORT}`);
});

