import express from "express";
import { xummClient } from "../utils/xummClient.js"; // ✅ Correct

const router = express.Router();

router.get("/ping", (_, res) => {
  res.json({ status: "✅ Login route is alive" });
});

router.get("/", async (req, res) => {
  try {
    const payload = await xummClient.payload.create({
      txjson: { TransactionType: "SignIn" }
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid
    });
  } catch (err) {
    console.error("❌ Error in /api/login:", err.message);
    res.status(500).json({ error: "Failed to create XUMM login payload" });
  }
});

export default router;
