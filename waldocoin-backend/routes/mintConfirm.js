import express from "express";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    console.log("⚡ Confirm route: loading XUMM SDK");

    const xummPkg = await import("xumm-sdk");
    const XummSdk = xummPkg.default || xummPkg;
    const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

    // 🔧 your confirm logic goes here...

    res.json({ success: true, message: "Confirm route reached." });
  } catch (err) {
    console.error("❌ XUMM Confirm Error:", err);
    res.status(500).json({ success: false, error: "XUMM confirm failed." });
  }
});

export default router;
