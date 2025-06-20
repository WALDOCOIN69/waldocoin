// routes/login/status.js
import express from "express";
import xummClient from "../../utils/xummClient.js";

const router = express.Router();

router.get("/:uuid", async (req, res) => {
  const { uuid } = req.params;
  console.log("📡 Hit /api/login/status with uuid:", uuid); // 👈 DEBUG

  try {
    const payload = await xummClient.payload.get(uuid);
    console.log("✅ XUMM payload response:", {
      signed: payload.meta.signed,
      expired: payload.meta.expired,
      account: payload.response?.account,
    });

    if (payload.meta.expired) {
      return res.json({ expired: true });
    }

    if (payload.meta.signed) {
      return res.json({
        signed: true,
        wallet: payload.response.account,
      });
    }

    res.json({ signed: false });
  } catch (err) {
    console.error("❌ Error in login status route:", err.message);
    res.status(500).json({ error: "Failed to fetch login status" });
  }
});

export default router;

