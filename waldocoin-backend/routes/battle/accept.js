import express from "express";
import dayjs from "dayjs";
import { redis } from "../../redisClient.js";
import { xummClient } from "../../utils/xummClient.js";
import dotenv from "dotenv";
import { addActivityNotification } from "../activity.js";
import { validateTweetForBattle } from "../../utils/tweetValidator.js";
import { updateBattle, getBattle, BATTLE_KEYS } from "../../utils/battleStorage.js";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/accept.js");

router.post("/", async (req, res) => {
  const { wallet, tweetId, battleId } = req.body;

  if (!wallet || !tweetId || !battleId) {
    return res.status(400).json({ success: false, error: "Missing wallet, tweetId, or battleId" });
  }

  try {
    // 🔍 Validate tweet before processing payment
    const tweetValidation = await validateTweetForBattle(tweetId, wallet);
    if (!tweetValidation.valid) {
      return res.status(400).json({
        success: false,
        error: tweetValidation.reason
      });
    }

    // Get battle data using standardized storage
    const battle = await getBattle(battleId);

    if (!battle) {
      return res.status(404).json({ success: false, error: "Battle not found" });
    }

    if (battle.status !== "pending" && battle.status !== "open") {
      return res.status(400).json({ success: false, error: "Battle is not available for acceptance" });
    }

    if (battle.acceptedAt) {
      return res.status(400).json({ success: false, error: "Battle already accepted" });
    }

    // Prevent self-acceptance
    if (battle.challenger === wallet) {
      return res.status(400).json({ success: false, error: "You cannot accept your own battle" });
    }

    const { acceptFeeWLO } = await (await import("../../utils/config.js")).getBattleFees();
    const feeWaldo = acceptFeeWLO;
    const now = dayjs();

    // 🔐 WALDO payment payload - Send to dedicated Battle Escrow Wallet
    const BATTLE_ESCROW_WALLET = process.env.BATTLE_ESCROW_WALLET || "rfn7cG6qAQMuG97i9Nb5GxGdHbTjY7TzW";

    const payload = {
      txjson: {
        TransactionType: "Payment",
        Destination: BATTLE_ESCROW_WALLET,
        Amount: String(feeWaldo * 1_000_000),
        DestinationTag: 778,
        Memos: [{
          Memo: {
            MemoType: Buffer.from('BATTLE_ACCEPT').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Battle accept fee: ${battleId}`).toString('hex').toUpperCase()
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
      if (event.data.signed === false) throw new Error("User rejected battle accept payment");
    });

    // Update battle data atomically
    const updateResult = await updateBattle(battleId, {
      acceptor: wallet,
      acceptorTweetId: tweetId,
      acceptedAt: now.valueOf(),
      endsAt: now.add(24, "hour").valueOf(),
      status: "accepted",
      votes: 0
    });

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        error: updateResult.error || "Failed to accept battle"
      });
    }

    // Add activity notifications
    const challengerHandle = battle.challengerHandle || 'Unknown';

    // Notify acceptor
    await addActivityNotification(
      wallet,
      'battle_accepted',
      `You accepted a meme battle challenge! Let the voting begin!`,
      0,
      { battleId, challengerHandle }
    );

    // Notify challenger
    if (battle.challenger) {
      await addActivityNotification(
        battle.challenger,
        'battle_accepted',
        `Your battle challenge was accepted! Voting has started!`,
        0,
        { battleId }
      );
    }

    return res.json({
      success: true,
      uuid,
      next,
      battleId,
      fee: feeWaldo
    });

  } catch (err) {
    console.error("❌ Accept battle error:", err);
    return res.status(500).json({
      success: false,
      error: "Accept battle failed",
      detail: err.message
    });
  }
});

export default router;

