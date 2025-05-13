// routes/mint.js
import express from "express";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

router.post("/", async (req, res) => {
  try {
    console.log("⚡ Mint route: dynamically loading XUMM");

    const xummPkg = await import("xumm-sdk");
    const XummSdk = xummPkg.default || xummPkg;
    const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

    // Proceed with mint logic here...

    res.json({ success: true, message: "Mint route reached." });
  } catch (err) {
    console.error("❌ XUMM Mint Error:", err);
    res.status(500).json({ success: false, error: "XUMM minting failed." });
  }
});

export default router;
