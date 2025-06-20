// routes/login/status.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js"; // ✅ named import

const router = express.Router();

router.get("/:uuid", async (req, res) => {
  try {
    const { uuid } = req.params;
    const payload = await xummClient.payload.get(uuid);

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
    console.error("❌ Error in login status:", err.message);
    res.status(500).json({ error: "Failed to fetch login status" });
  }
});

export default router;
