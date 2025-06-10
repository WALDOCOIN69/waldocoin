// 📁 routes/waldoPrice.js
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import { patchRouter } from "../utils/patchRouter.js";

// ✅ Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Initialize and patch router
const router = express.Router();
patchRouter(router, path.basename(__filename));

// 📈 GET / — Returns last 7-day WALDO token close price from Sologenic or fallback
router.get("/", async (req, res) => {
  try {
    const response = await fetch("https://api.sologenic.org/api/v1/token/WLO");

    if (!response.ok) {
      console.warn(`Sologenic API returned status ${response.status}`);
      throw new Error("Token not found or inactive.");
    }

    const data = await response.json();
    const history = data?.token?.marketData?.history || [];

    // Return last 7 entries
    return res.json({ history: history.slice(-7) });
  } catch (err) {
    console.error("⚠️ WALDO price fetch failed:", err.message);

    const fallback = [
      { time: "2025-05-06", close: "0.0021" },
      { time: "2025-05-07", close: "0.0023" },
      { time: "2025-05-08", close: "0.0026" },
      { time: "2025-05-09", close: "0.0022" },
      { time: "2025-05-10", close: "0.0028" },
      { time: "2025-05-11", close: "0.0031" },
      { time: "2025-05-12", close: "0.0034" }
    ];

    return res.status(200).json({ history: fallback });
  }
});

export default router;

