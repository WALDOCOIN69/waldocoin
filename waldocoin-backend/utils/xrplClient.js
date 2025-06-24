// utils/xrplClient.js
import { Client } from "xrpl";

// Global XRPL client instance
let client;

/**
 * Returns a connected XRPL client.
 * Automatically reuses the existing connection if still valid.
 */
export async function getXrplClient() {
  try {
    if (!client || !client.isConnected()) {
      client = new Client("wss://xrplcluster.com"); // 🌐 XRPL MAINNET
      await client.connect();
      console.log("✅ Connected to XRPL mainnet");
    }
    return client;
  } catch (err) {
    console.error("❌ Failed to connect to XRPL:", err);
    throw err;
  }
}
