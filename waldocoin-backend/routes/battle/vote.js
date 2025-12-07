// routes/battle/vote.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";
import { redis } from "../../redisClient.js";
import { addXP } from "../../utils/xpManager.js";
import { recordVote, getBattle, BATTLE_KEYS } from "../../utils/battleStorage.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

console.log("🧩 Loaded: routes/battle/vote.js");

router.post("/", async (req, res) => {
	  try {
	    const { wallet } = req.body;
	    let { battleId, vote, meme } = req.body;

	    // Backwards compatibility: allow { wallet, meme: "meme1" | "meme2" }
	    if (!vote && meme) {
	      if (meme === "meme1") vote = "A";
	      else if (meme === "meme2") vote = "B";
	    }

	    // If no battleId provided, fall back to the current featured battle
	    if (!battleId) {
	      battleId = await redis.get(BATTLE_KEYS.current());
	    }

	    if (!wallet || !battleId || !vote || !["A", "B"].includes(vote)) {
	      return res.status(400).json({
	        success: false,
	        error: "Invalid vote payload. Provide wallet and either (battleId + vote 'A'|'B') or (meme 'meme1'|'meme2') with an active battle."
	      });
	    }

	    // Load battle from standardized storage
	    const battleData = await getBattle(battleId);

	    if (!battleData || battleData.status !== "accepted") {
	      return res.status(400).json({ success: false, error: "No active battle to vote in." });
	    }

	    const voteKey = BATTLE_KEYS.vote(battleId, wallet);
	    const alreadyVoted = await redis.get(voteKey);
	    if (alreadyVoted) {
	      return res.status(403).json({ success: false, error: "You have already voted." });
	    }

	    const { voteFeeWLO } = await (await import("../../utils/config.js")).getBattleFees();
	    const feeWaldo = voteFeeWLO;

	    // 🔐 WALDO payment payload - Send to dedicated Battle Escrow Wallet
	    const BATTLE_ESCROW_WALLET = process.env.BATTLE_ESCROW_WALLET || "rfn7cG6qAQMuG97i9Nb5GxGdHbTjY7TzW";

	    const payload = {
	      txjson: {
	        TransactionType: "Payment",
	        Destination: BATTLE_ESCROW_WALLET,
	        Amount: String(feeWaldo * 1_000_000),
	        DestinationTag: 779,
	        Memos: [{
	          Memo: {
	            MemoType: Buffer.from('BATTLE_VOTE').toString('hex').toUpperCase(),
	            MemoData: Buffer.from(`Battle vote fee: ${battleId} - ${vote}`).toString('hex').toUpperCase()
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
	      if (event.data.signed === false) throw new Error("User rejected voting payment");
	    });

	    // Record vote atomically (prevents double voting and race conditions)
	    const voteResult = await recordVote(battleId, wallet, vote);

	    if (!voteResult.success) {
	      return res.status(400).json({
	        success: false,
	        error: voteResult.error
	      });
	    }

	    // ⭐ Award XP for voting (whitepaper compliant: 2 XP)
	    await addXP(wallet, 2);

	    return res.json({
	      success: true,
	      uuid,
	      next,
	      vote,
	      fee: feeWaldo
	    });

	  } catch (err) {
	    console.error("❌ Vote error:", err);
	    return res.status(500).json({ success: false, error: "Vote failed.", detail: err.message });
	  }
});

export default router;

