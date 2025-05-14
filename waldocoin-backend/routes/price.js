import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const response = await axios.get("https://api.sologenic.org/api/v1/token/WALDO");
    const fullHistory = response.data?.token?.marketData?.history || [];

    // Send only last 7 days
    const last7Days = fullHistory.slice(-7);

    res.json({ history: last7Days });
  } catch (err) {
    console.error("Failed to fetch WALDO price:", err.message);
    res.status(500).json({ error: "Unable to fetch WALDO price data." });
  }
});

export default router;
