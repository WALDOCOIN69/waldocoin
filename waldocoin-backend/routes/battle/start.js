import express from "express";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import dotenv from "dotenv";
import { addActivityNotification } from "../activity.js";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/start.js");

async function getWalletFromHandle(handle) {
  const key = `twitter:${handle.toLowerCase()}`;
  const wallet = await redis.get(key);
  return wallet;
}

async function getHandleFromWallet(wallet) {
  const key = `handle:${wallet}`;
  const handle = await redis.get(key);
  return handle;
}

router.post("/", async (req, res) => {
  const { wallet, tweetId, twitterHandle } = req.body;

  if (!wallet || !tweetId) {
    return res.status(400).json({ success: false, error: "Missing wallet or tweetId" });
  }

  try {
    const battleId = uuidv4();
    const now = dayjs();
    const { startFeeWLO } = await (await import("../../utils/config.js")).getBattleFees();
    const feeWaldo = startFeeWLO;

    let challengedWallet = null;
    let challengedHandle = null;

    if (twitterHandle) {
      challengedWallet = await getWalletFromHandle(twitterHandle);
      if (!challengedWallet) {
        return res.status(404).json({ success: false, error: `No wallet found for @${twitterHandle}` });
      }
      challengedHandle = twitterHandle;
    }

    const challengerHandle = await getHandleFromWallet(wallet);

    // 🔐 WALDO payment payload
    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: process.env.ISSUER_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 777
      },
      options: {
        submit: true,
        expire: 300
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, (event) => {
      if (event.data.signed === true) return true;
      if (event.data.signed === false) throw new Error("User rejected battle start payment");
    });

    const battleData = {
      battleId,
      challenger: wallet,
      challengerHandle: challengerHandle || null,
      challengerTweetId: tweetId,
      challenged: challengedWallet,
      challengedHandle: challengedHandle,
      challengedTweetId: null,
      status: "pending",
      createdAt: now.toISOString(),
      acceptedAt: null,
      expiresAt: now.add(10, "hour").toISOString(),
      votes: 0
    };

    await redis.set(`battle:${battleId}`, JSON.stringify(battleData), { EX: 60 * 60 * 12 });

    // Add activity notifications
    if (challengedWallet && challengedHandle) {
      // Targeted challenge - notify both challenger and challenged
      await addActivityNotification(
        wallet,
        'battle_challenge_sent',
        `You challenged @${challengedHandle} to a meme battle!`,
        50,
        { battleId, challengedHandle, tweetId }
      );

      await addActivityNotification(
        challengedWallet,
        'battle_challenged',
        `🎯 @${challengerHandle || 'Someone'} challenged you to a meme battle!`,
        0,
        { battleId, challengerHandle, tweetId, urgent: true }
      );
    } else {
      // Open battle - notify challenger only
      await addActivityNotification(
        wallet,
        'battle_started',
        `You started an open meme battle! Waiting for someone to accept...`,
        25,
        { battleId, tweetId }
      );
    }

    return res.json({
      success: true,
      battleId,
      fee: feeWaldo,
      uuid,
      next
    });

  } catch (err) {
    console.error("❌ Battle start error:", err);
    return res.status(500).json({
      success: false,
      error: "Battle start failed",
      detail: err.message
    });
  }
});

export default router;


