import express from "express";
import pkg from "xumm-sdk"; // ✅ correct way to import CommonJS module in ESM
const Xumm = pkg.default;   // ✅ get the actual class constructor

const router = express.Router();

// ✅ Initialize XUMM client
const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// ✅ Ping route
router.get("/ping", (_, res) => {
  res.json({ status: "✅ Login route is alive" });
});

// ✅ Create SignIn payload
router.get("/", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
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
