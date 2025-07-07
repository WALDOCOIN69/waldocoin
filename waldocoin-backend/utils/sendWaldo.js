import xrpl from "xrpl";
import { WALDOCOIN_TOKEN, WALDO_ISSUER, WALDO_DISTRIBUTOR_SECRET } from "../constants.js";

export async function xrpSendWaldo(wallet, amount) {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();

  const sender = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);

  const tx = {
    TransactionType: "Payment",
    Account: sender.classicAddress,
    Destination: wallet,
    Amount: {
      currency: WALDOCOIN_TOKEN,
      issuer: WALDO_ISSUER,
      value: amount.toString()
    }
  };

  const prepared = await client.autofill(tx);
  const signed = sender.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  await client.disconnect();

  if (result.result.meta.TransactionResult !== "tesSUCCESS") {
    throw new Error(`XRPL transaction failed: ${result.result.meta.TransactionResult}`);
  }

  return result.result.hash;
}
