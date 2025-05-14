// routes/price.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const response = await fetch("https://api.sologenic.org/api/v1/token/WLO");

    // If the response is not OK, fallback to mock
    if (!response.ok) {
      console.warn(`Sologenic API returned ${response.status}`);
      throw new Error("WLO not trading or not found on Sologenic.");
    }

    const data = await response.json();
    const fullHistory = data?.token?.marketData?.history || [];

    // Send only last 7 days
    const last7Days = fullHistory.slice(-7);
    res.json({ history: last7Days });

  } catch (err) {
    console.error("⚠️ Failed to fetch WLO price data:", err.message);

    // Fallback mock data for dev/testing
    const mockHistory = [
      { time: "2025-05-06", close: "0.0021" },
      { time: "2025-05-07", close: "0.0023" },
      { time: "2025-05-08", close: "0.0026" },
      { time: "2025-05-09", close: "0.0022" },
      { time: "2025-05-10", close: "0.0028" },
      { time: "2025-05-11", close: "0.0031" },
      { time: "2025-05-12", close: "0.0034" }
    ];

    res.status(200).json({ history: mockHistory });
  }
});

export default router;
