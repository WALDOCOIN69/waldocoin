// routes/dao/expire.js
import express from "express";
import { readData, writeData } from "../../utils/datastore.js";
const router = express.Router();

router.post("/", async (req, res) => {
  const { proposalId } = req.body;
  const db = await readData();
  const proposal = db.dao?.proposals?.find(p => p.id === proposalId);

  if (!proposal) {
    return res.status(404).json({ error: "Proposal not found." });
  }

  proposal.status = "expired";
  await writeData(db);
  res.json({ message: "Proposal expired." });
});

export default router;
