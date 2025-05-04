const express = require("express");
const router = express.Router();
const db = require("../utils/db");
const getWaldoBalance = require("../utils/getWaldoBalance");

const MIN_REQUIRED_WALDO = 10000;

router.post("/", async (req, res) => {
  const { wallet, proposalId, choice } = req.body;
  if (!wallet || !proposalId || !choice) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  const proposal = db.proposals[proposalId];
  if (!proposal) {
    return res.status(404).json({ success: false, error: "Proposal not found" });
  }

  const now = new Date();
  if (now < new Date(proposal.start) || now > new Date(proposal.end)) {
    return res.status(403).json({ success: false, error: "Voting closed" });
  }

  const balance = await getWaldoBalance(wallet);
  if (balance < MIN_REQUIRED_WALDO) {
    return res.status(403).json({ success: false, error: "Must hold ≥ 10,000 WALDO to vote" });
  }

  proposal.votes = proposal.votes || {};
  if (proposal.votes[wallet]) {
    return res.status(403).json({ success: false, error: "Wallet already voted" });
  }

  proposal.votes[wallet] = choice;
  db.proposals[proposalId] = proposal;

  return res.json({ success: true });
});

module.exports = router;