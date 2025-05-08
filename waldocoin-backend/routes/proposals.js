import express from "express";
const router = express.Router();

let proposals = [
  {
    id: "p1",
    title: "Should WALDO list on XRPL DEX?",
    description: "Let the community decide if we go full degen now.",
    options: ["Yes", "No"],
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  }
];

router.get("/", (req, res) => {
  res.json(proposals);
});

router.post("/", (req, res) => {
  const { title, description, options, duration, wallet } = req.body;
  const newProposal = {
    id: "p" + Date.now(),
    title,
    description,
    options,
    wallet,
    createdAt: Date.now(),
    expiresAt: Date.now() + (duration || 24) * 60 * 60 * 1000
  };
  proposals.push(newProposal);
  res.json({ success: true, id: newProposal.id });
});

router.get("/:id", (req, res) => {
  const p = proposals.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Proposal not found" });
  res.json(p);
});

export default router;
