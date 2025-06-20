import { Client } from "xrpl";

let client;

export async function getXrplClient() {
  if (!client || !client.isConnected()) {
    client = new Client("wss://xrplcluster.com"); // 🌐 MAINNET
    await client.connect();
  }
  return client;
}
