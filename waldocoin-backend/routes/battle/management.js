import express from "express";
import { redis } from "../../redisClient.js";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";

const router = express.Router();

// GET /api/battle/management/active - Get all active battles
router.get("/active", async (req, res) => {
  try {
    const battleKeys = await redis.keys("battle:*:data");
    const activeBattles = [];

    for (const key of battleKeys) {
      const battleData = await redis.hGetAll(key);
      if (battleData && battleData.status === "accepted") {
        const battleId = key.split(":")[1];
        
        // Get vote counts
        const [votesA, votesB] = await Promise.all([
          redis.get(`battle:${battleId}:count:A`),
          redis.get(`battle:${battleId}:count:B`)
        ]);

        // Get tweet data for both memes
        const [challengerTweet, acceptorTweet] = await Promise.all([
          redis.hGetAll(`meme:${battleData.challengerTweetId}`),
          redis.hGetAll(`meme:${battleData.acceptorTweetId}`)
        ]);

        activeBattles.push({
          battleId,
          challenger: battleData.challenger,
          acceptor: battleData.acceptor,
          challengerHandle: battleData.challengerHandle,
          acceptorHandle: battleData.acceptorHandle,
          challengerTweet: {
            id: battleData.challengerTweetId,
            text: challengerTweet.text || "Loading...",
            image: challengerTweet.image_url || null,
            likes: parseInt(challengerTweet.likes) || 0,
            retweets: parseInt(challengerTweet.retweets) || 0
          },
          acceptorTweet: {
            id: battleData.acceptorTweetId,
            text: acceptorTweet.text || "Loading...",
            image: acceptorTweet.image_url || null,
            likes: parseInt(acceptorTweet.likes) || 0,
            retweets: parseInt(acceptorTweet.retweets) || 0
          },
          votes: {
            A: parseInt(votesA) || 0,
            B: parseInt(votesB) || 0,
            total: (parseInt(votesA) || 0) + (parseInt(votesB) || 0)
          },
          status: battleData.status,
          createdAt: battleData.createdAt,
          acceptedAt: battleData.acceptedAt,
          endsAt: battleData.endsAt,
          timeRemaining: battleData.endsAt ? Math.max(0, parseInt(battleData.endsAt) - Date.now()) : 0
        });
      }
    }

    // Sort by most recent
    activeBattles.sort((a, b) => new Date(b.acceptedAt) - new Date(a.acceptedAt));

    res.json({
      success: true,
      battles: activeBattles,
      count: activeBattles.length
    });

  } catch (error) {
    console.error("❌ Error fetching active battles:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch active battles"
    });
  }
});

// GET /api/battle/management/pending - Get pending battles waiting for acceptance
router.get("/pending", async (req, res) => {
  try {
    const battleKeys = await redis.keys("battle:*:data");
    const pendingBattles = [];

    for (const key of battleKeys) {
      const battleData = await redis.hGetAll(key);
      if (battleData && (battleData.status === "pending" || battleData.status === "open")) {
        const battleId = key.split(":")[1];
        
        // Get challenger tweet data
        const challengerTweet = await redis.hGetAll(`meme:${battleData.challengerTweetId}`);

	        pendingBattles.push({
	          battleId,
	          challenger: battleData.challenger,
	          challengerHandle: battleData.challengerHandle,
	          challengerTweet: {
	            id: battleData.challengerTweetId,
	            text: challengerTweet.text || "Loading...",
	            image: challengerTweet.image_url || null,
	            likes: parseInt(challengerTweet.likes) || 0,
	            retweets: parseInt(challengerTweet.retweets) || 0
	          },
	          // For pending/open battles, treat any without an acceptor as an open invite
	          challenged: battleData.acceptor,
	          challengedHandle: battleData.acceptorHandle,
	          status: battleData.status,
	          createdAt: battleData.createdAt,
	          expiresAt: battleData.expiresAt,
	          timeRemaining: battleData.expiresAt ? Math.max(0, new Date(battleData.expiresAt) - new Date()) : 0,
	          openInvite: battleData.type === "open" || !battleData.acceptor
	        });
      }
    }

    // Sort by most recent
    pendingBattles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      battles: pendingBattles,
      count: pendingBattles.length
    });

  } catch (error) {
    console.error("❌ Error fetching pending battles:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch pending battles"
    });
  }
});

// GET /api/battle/management/completed - Get completed battles with results
router.get("/completed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const battleKeys = await redis.keys("battle:*:data");
    const completedBattles = [];

    for (const key of battleKeys) {
      const battleData = await redis.hGetAll(key);
      if (battleData && (battleData.status === "paid" || battleData.status === "ended")) {
        const battleId = key.split(":")[1];
        
        // Get vote counts
        const [votesA, votesB] = await Promise.all([
          redis.get(`battle:${battleId}:count:A`),
          redis.get(`battle:${battleId}:count:B`)
        ]);

        const votesACount = parseInt(votesA) || 0;
        const votesBCount = parseInt(votesB) || 0;
        const winner = votesACount > votesBCount ? "A" : votesBCount > votesACount ? "B" : "tie";

        // Get tweet data
        const [challengerTweet, acceptorTweet] = await Promise.all([
          redis.hGetAll(`meme:${battleData.challengerTweetId}`),
          redis.hGetAll(`meme:${battleData.acceptorTweetId}`)
        ]);

        completedBattles.push({
          battleId,
          challenger: battleData.challenger,
          acceptor: battleData.acceptor,
          challengerHandle: battleData.challengerHandle,
          acceptorHandle: battleData.acceptorHandle,
          challengerTweet: {
            id: battleData.challengerTweetId,
            text: challengerTweet.text || "Loading...",
            image: challengerTweet.image_url || null
          },
          acceptorTweet: {
            id: battleData.acceptorTweetId,
            text: acceptorTweet.text || "Loading...",
            image: acceptorTweet.image_url || null
          },
          votes: {
            A: votesACount,
            B: votesBCount,
            total: votesACount + votesBCount
          },
          winner,
          winnerWallet: winner === "A" ? battleData.challenger : winner === "B" ? battleData.acceptor : null,
          status: battleData.status,
          createdAt: battleData.createdAt,
          acceptedAt: battleData.acceptedAt,
          completedAt: battleData.payoutAt || battleData.endedAt,
          totalPot: parseInt(battleData.totalPot) || 0,
          prizePool: parseInt(battleData.prizePool) || 0,
          voterCount: parseInt(battleData.voterCount) || 0
        });
      }
    }

    // Sort by most recent completion
    completedBattles.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    res.json({
      success: true,
      battles: completedBattles.slice(0, limit),
      count: completedBattles.length
    });

  } catch (error) {
    console.error("❌ Error fetching completed battles:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch completed battles"
    });
  }
});

// GET /api/battle/management/stats - Get battle system statistics
router.get("/stats", async (req, res) => {
  try {
    const battleKeys = await redis.keys("battle:*:data");
    
    let totalBattles = 0;
    let activeBattles = 0;
    let pendingBattles = 0;
    let completedBattles = 0;
    let totalVotes = 0;
    let totalPrizePool = 0;
    let totalBurned = 0;

    for (const key of battleKeys) {
      const battleData = await redis.hGetAll(key);
      if (battleData && battleData.status) {
        totalBattles++;
        
        if (battleData.status === "accepted") activeBattles++;
        else if (battleData.status === "pending" || battleData.status === "open") pendingBattles++;
        else if (battleData.status === "paid" || battleData.status === "ended") {
          completedBattles++;
          totalPrizePool += parseInt(battleData.prizePool) || 0;
          totalBurned += parseInt(battleData.burnAmount) || 0;
        }

        // Count votes for this battle
        const battleId = key.split(":")[1];
        const [votesA, votesB] = await Promise.all([
          redis.get(`battle:${battleId}:count:A`),
          redis.get(`battle:${battleId}:count:B`)
        ]);
        totalVotes += (parseInt(votesA) || 0) + (parseInt(votesB) || 0);
      }
    }

    res.json({
      success: true,
      stats: {
        totalBattles,
        activeBattles,
        pendingBattles,
        completedBattles,
        totalVotes,
        totalPrizePool,
        totalBurned,
        averageVotesPerBattle: totalBattles > 0 ? Math.round(totalVotes / totalBattles) : 0
      }
    });

  } catch (error) {
    console.error("❌ Error fetching battle stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch battle statistics"
    });
  }
});

export default router;
