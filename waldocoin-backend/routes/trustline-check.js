const xrpl = require('xrpl');

app.get('/api/trustline-check', async (req, res) => {
  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ error: 'Missing wallet param' });
  }

  try {
    const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233"); // Use mainnet if live
    await client.connect();

    const lines = await client.request({
      command: 'account_lines',
      account: wallet
    });

    const hasWaldo = lines.result.lines.some(line =>
      line.currency === 'WLO' && line.account === 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'
    );

    res.json({ hasWaldoTrustline: hasWaldo });
    await client.disconnect();
  } catch (err) {
    console.error("Trustline check error:", err);
    res.status(500).json({ error: 'Trustline check failed' });
  }
});
