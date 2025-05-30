// routes/mintConfirm.js
import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import xrpl from "xrpl";
import { uploadToIPFS } from "../utils/ipfsUploader.js";

dotenv.config();
const router = express.Router();

// 💥 Dummy fallback route to prevent router error
router.post("/", async (req, res) => {
  res.json({ success: true, message: "Mint confirm stub active" });
});

export default router;
