// routes/login.js
import express from "express";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    console.log("⚡ Dynamically importing xumm-sdk...");

    const xummPkg = await import("xumm-sdk");
    const XummSdk = xummPkg.default || xummPkg;
    const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

    const payload = {
      txjson: { TransactionType: "SignIn" }
    };

    const created = await xumm.payload.create(payload);

    res.json({
      success: true,
      qr: created.refs.qr_png,
      uuid: created.uuid
    });
  } catch (err) {
    console.error("❌ XUMM login error:", err);
    res.status(500).json({ success: false, error: "XUMM login failed." });
  }
});

export default router;
