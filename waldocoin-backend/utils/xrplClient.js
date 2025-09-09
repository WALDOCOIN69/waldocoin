import { Client } from "xrpl";

let client;

export async function getXrplClient() {
  try {
    if (!client || !client.isConnected()) {
      client = new Client(process.env.XRPL_ENDPOINT || process.env.XRPL_NODE || "wss://xrplcluster.com"); // 🌐 XRPL MAINNET
      await client.connect();
      console.log("✅ Connected to XRPL mainnet");
      // Attach disconnect handler once
      client.on("disconnected", () => {
        console.warn("⚠️ XRPL connection lost. Will reconnect on next request.");
        client = undefined;
      });
    }
    return client;
  } catch (err) {
    console.error("❌ Failed to connect to XRPL:", err);
    throw err;
  }
}

