// routes/dao/archive.js
import express from "express";
import { readData, writeData } from "../../utils/dataStore.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { proposalId } = req.body;
  if (!proposalId) {
    return res.status(400).json({ error: "Missing proposalId" });
  }

  const db = await readData();
  db.dao = db.dao || {};
  db.dao.archived = db.dao.archived || [];

  const allProposals = db.dao.proposals || [];
  const index = allProposals.findIndex(p => p.id === proposalId);
  if (index === -1) {
    return res.status(404).json({ error: "Proposal not found" });
  }

  const [archivedProposal] = allProposals.splice(index, 1);
  db.dao.proposals = allProposals;
  db.dao.archived.push({ ...archivedProposal, archivedAt: Date.now() });

  await writeData(db);
  res.json({ success: true, archived: archivedProposal });
});

export default router;
