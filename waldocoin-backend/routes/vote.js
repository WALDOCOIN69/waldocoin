app.post("/api/vote", async (req, res) => {
  const { proposalId, choice, wallet } = req.body;
  if (!proposalId || !choice || !wallet) return res.status(400).json({ success: false, error: "Missing fields" });

  try {
    // Fetch WALDO balance from XRPL
    const response = await fetch("https://s1.ripple.com:51234", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_lines",
        params: [{ account: wallet }]
      })
    });
    const data = await response.json();
    const lines = data?.result?.lines || [];

    const waldoLine = lines.find(
      l => l.currency === "WALDO" && l.account === "rf97bQQbqztUnL1BYB5ti4rC691e7u5C8F"
    );

    const waldoBalance = parseFloat(waldoLine?.balance || "0");

    // Fixed price logic
    const WALDO_PRICE_XRP = 0.01;
    const REQUIRED_XRP = 100;
    const requiredWaldo = REQUIRED_XRP / WALDO_PRICE_XRP;

    if (waldoBalance < requiredWaldo) {
      return res.status(403).json({
        success: false,
        error: `You need at least ${requiredWaldo.toLocaleString()} WALDO to vote (≈${REQUIRED_XRP} XRP)`
      });
    }

    // ... existing vote storage logic here ...

    return res.json({ success: true });
  } catch (err) {
    console.error("Voting error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});


