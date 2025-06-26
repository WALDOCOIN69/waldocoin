// routes/conversion.js
import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    waldoToXrp: 0.01,
    waldoToUsd: 0.007,
  });
});

export default router;
