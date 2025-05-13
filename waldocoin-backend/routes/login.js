import express from "express";
import dotenv from "dotenv";
import xumm from "../utils/xummClient.js"; // ✅ Use the wrapper safely

dotenv.config();
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    console.log("⚡ Starting XUMM sign-in payload...");

    const payload = {
      txjson: {
        TransactionType: "SignIn"
      }
    };

    const created = await xumm.payload.create(payload);

    console.log("✅ Payload created:", {
      uuid: created.uuid,
      qr: created.refs?.qr_png
    });

    res.json({
      success: true,
      qr: created.refs.qr_png,
      uuid: created.uuid
    });
  } catch (err) {
    console.error("❌ Full XUMM SDK Error:", err);
    res.status(500).json({ success: false, error: "XUMM login failed." });
  }
});

export default router;
