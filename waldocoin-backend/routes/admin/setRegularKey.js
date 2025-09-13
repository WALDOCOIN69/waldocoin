// routes/admin/setRegularKey.js
import express from "express";
import dotenv from "dotenv";
import { xummClient } from "../../utils/xummClient.js";
dotenv.config();

const router = express.Router();

// POST /api/admin/set-regular-key
// Body: { regularKeyAddress: string }
router.post("/", async (req, res) => {
  try {
    const regularKeyAddress = (req.body?.regularKeyAddress || "").trim();
    if (!regularKeyAddress || !regularKeyAddress.startsWith("r")) {
      return res.status(400).json({ success: false, error: "Missing or invalid regularKeyAddress" });
    }

    const ILL = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.WALDO_DISTRIBUTOR_ADDRESS;
    if (!ILL || !ILL.startsWith("r")) {
      return res.status(500).json({ success: false, error: "Distributor wallet not configured (WALDO_DISTRIBUTOR_WALLET)" });
    }

    const payload = await xummClient.payload.create({
      txjson: {
        TransactionType: "SetRegularKey",
        RegularKey: regularKeyAddress
      },
      options: {
        expire: 300
      }
    });

    return res.json({ success: true, uuid: payload.uuid, next: payload.next, refs: payload.refs });
  } catch (err) {
    console.error("❌ SetRegularKey payload error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "Unknown error" });
  }
});

export default router;

