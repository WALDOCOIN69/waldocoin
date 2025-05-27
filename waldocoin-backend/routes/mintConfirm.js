import express from "express";
import dotenv from "dotenv";
import { redis } from "../redisClient.js";
import xrpl from "xrpl"; // ✅ Fix
import { uploadToIPFS } from "../utils/ipfsUploader.js";

const { Wallet, Client, NFTokenMint } = xrpl;

dotenv.config();
const router = express.Router();
