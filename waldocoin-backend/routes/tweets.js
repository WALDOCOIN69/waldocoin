// 📁 routes/tweets.js
import express from "express"
import fs from "fs"
import path from "path"

const router = express.Router()

router.get("/", (req, res) => {
  const dataPath = path.resolve("db.json")

  fs.readFile(dataPath, "utf8", (err, json) => {
    if (err) {
      return res.status(500).json({ error: "Failed to load tweet data." })
    }

    const data = JSON.parse(json)
    const allTweets = []

    for (const wallet of data.wallets) {
      for (const meme of wallet.memes) {
        allTweets.push({
          tweet_id: meme.url.split("/").pop(),
          url: meme.url,
          wallet: wallet.address,
          likes: meme.likes,
          retweets: meme.retweets,
          xp: meme.xp,
          level: meme.level,
          image_url: meme.image_url || "https://via.placeholder.com/500",
          waldo_amount: meme.likes / 50 // Example WALDO payout formula
        })
      }
    }

    res.json(allTweets)
  })
})

export default router
