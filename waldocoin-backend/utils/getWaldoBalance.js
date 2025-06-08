// utils/getWaldoBalance.js
import { Client } from "xrpl";

const ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY"; // WALDO issuer
const CURRENCY = "WLO"; // or "WLD" if you're using the short name

export default async function getWaldoBalance(wallet) {
  const client = new Client("wss://s1.ripple.com"); // Mainnet; use testnet if needed
  await client.connect();

  try {
    const response = await client.request({
      command: "account_lines",
      account: wallet
    });

    const line = response.result.lines.find(
      l => l.currency === CURRENCY && l.account === ISSUER
    );

    return line ? parseFloat(line.balance) : 0;
  } catch (err) {
    console.error("Failed to fetch WALDO balance:", err.message);
    return 0;
  } finally {
    client.disconnect();
  }
}
