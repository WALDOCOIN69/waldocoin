// routes/conversion.js
import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  return res.json({ waldoToXRP: 0.01, waldoToUSD: 0.005 });
});

export default router;
