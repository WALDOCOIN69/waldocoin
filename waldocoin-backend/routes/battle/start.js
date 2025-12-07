import express from "express";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import dotenv from "dotenv";
import { addActivityNotification } from "../activity.js";
import { validateTweetForBattle } from "../../utils/tweetValidator.js";
import { createBattle, BATTLE_KEYS } from "../../utils/battleStorage.js";
import { createErrorResponse, logError } from "../../utils/errorHandler.js";
import { rateLimitMiddleware } from "../../utils/rateLimiter.js";
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

router.post("/", rateLimitMiddleware('BATTLE_START'), async (req, res) => {
	  const { wallet, tweetId, twitterHandle } = req.body;
	  const challengeHandle = req.body.challengeHandle;

  if (!wallet || !tweetId) {
    return res.status(400).json({ success: false, error: "Missing wallet or tweetId" });
  }

  try {
    // 🔍 Validate tweet before processing payment
    const tweetValidation = await validateTweetForBattle(tweetId, wallet);
    if (!tweetValidation.valid) {
      const errorResponse = await createErrorResponse(
        'TWEET_NOT_FOUND',
        { originalReason: tweetValidation.reason, tweetId },
        wallet,
        'POST /api/battle/start'
      );
      return res.status(400).json(errorResponse);
    }

    const now = dayjs();
    const { startFeeWLO } = await (await import("../../utils/config.js")).getBattleFees();
    const feeWaldo = startFeeWLO;

	    let challengedWallet = null;
	    let challengedHandle = null;

	    const handleToUse = twitterHandle || challengeHandle;

	    if (handleToUse) {
	      challengedWallet = await getWalletFromHandle(handleToUse);
	      if (!challengedWallet) {
	        return res.status(404).json({ success: false, error: `No wallet found for @${handleToUse}` });
	      }
	      challengedHandle = handleToUse;
	    }

    const challengerHandle = await getHandleFromWallet(wallet);

    // Create battle with atomic operations
    const battleCreation = await createBattle({
      challenger: wallet,
      challengerHandle,
      challengerTweetId: tweetId,
      acceptor: challengedWallet,
      acceptorHandle: challengedHandle,
      status: challengedWallet ? "pending" : "open",
      type: challengedWallet ? "challenge" : "open",
      createdAt: now.valueOf(),
      expiresAt: now.add(10, "hour").valueOf(),
      metadata: {
        startFee: feeWaldo,
        paymentRequired: true
      }
    });

    if (!battleCreation.success) {
      return res.status(400).json({
        success: false,
        error: battleCreation.error
      });
    }

    const { battleId } = battleCreation;

    // Mark this battle as the current featured battle (pending/open)
    await redis.set(BATTLE_KEYS.current(), battleId);

    // 🔐 WALDO payment payload - Send to dedicated Battle Escrow Wallet
    const BATTLE_ESCROW_WALLET = process.env.BATTLE_ESCROW_WALLET || "rfn7cG6qAQMuG97i9Nb5GxGdHbTjY7TzW";

    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: BATTLE_ESCROW_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 777,
        Memos: [{
          Memo: {
            MemoType: Buffer.from('BATTLE_START').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Battle start fee: ${battleId}`).toString('hex').toUpperCase()
          }
        }]
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

    // Battle data is already stored by createBattle() function
    // No need for additional storage here

    // Add activity notifications
    if (challengedWallet && challengedHandle) {
      // Targeted challenge - notify both challenger and challenged
      await addActivityNotification(
        wallet,
        'battle_challenge_sent',
        `You challenged @${challengedHandle} to a meme battle!`,
        0,
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
        0,
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


