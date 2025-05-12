import express from "express";
import dotenv from "dotenv";
import xummSdkPkg from "xumm-sdk"; // 👈 CommonJS compatibility for ESM
const XummSdk = xummSdkPkg.default; // 👈 Pull out the actual constructor

dotenv.config();

const router = express.Router();
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

router.get("/", async (req, res) => {
  try {
    const payload = {
      txjson: {
        TransactionType: "SignIn"
      }
    };

    const created = await xumm.payload.create(payload);
    res.json({
      success: true,
      qr: created.refs.qr_png,
      uuid: created.uuid
    });
  } catch (err) {
    console.error("❌ XUMM login error:", err.message);
    res.status(500).json({ success: false, error: "XUMM login failed." });
  }
});

export default router;
