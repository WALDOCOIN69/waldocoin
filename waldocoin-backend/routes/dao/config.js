// routes/dao/config.js
import express from "express";
import { readData, writeData } from "../../utils/dataStore.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { minWaldo } = req.body;
  if (typeof minWaldo !== "number") {
    return res.status(400).json({ error: "minWaldo must be a number" });
  }

  const db = await readData();
  db.dao = db.dao || {};
  db.dao.minWaldoToVote = minWaldo;
  await writeData(db);

  res.json({ success: true, minWaldo });
});

export default router;
