import express from "express";
import dotenv from "dotenv";
import pkg from "xumm-sdk";
const { XummSdk } = pkg; // ✅ GOOD

import { Client } from "xrpl";
import path from "path";
import { fileURLToPath } from "url";

console.log("🧼 Login route confirmed patched");

// ✅ Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Patch router for invalid route patterns
const patchRouter = (router, file) => {
  const methods = ["get", "post", "use"];
  for (const method of methods) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      if (typeof path === "string" && /:[^\/]+:/.test(path)) {
        console.error(`❌ BAD ROUTE in ${file}: ${method.toUpperCase()} ${path}`);
      }
      return original.call(this, path, ...handlers);
    };
  }
};

dotenv.config();

const router = express.Router();
patchRouter(router, path.basename(__filename));

const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
const CURRENCY = "WLO";

// 🔐 Create XUMM Sign-In Payload
router.get("/", async (req, res) => {
  try {
    const payload = await xumm.payload.create({
      txjson: {
        TransactionType: "SignIn",
      },
    });

    res.json({
      qr: payload.refs.qr_png,
      uuid: payload.uuid,
    });
  } catch (err) {
    console.error("❌ Error creating XUMM payload:", err);
    res.status(500).json({ error: "Failed to create XUMM sign-in." });
  }
});

// 🔁 Poll Sign-In Status
router.get("/status/:uuid", async (req, res) => {
  const { uuid } = req.params;

  try {
    const result = await xumm.payload.get(uuid);

    if (result.meta.signed === true && result.response.account) {
      return res.json({
        signed: true,
        wallet: result.response.account
      });
    }

    res.json({ signed: false });
  } catch (err) {
    console.error("❌ Error checking login status:", err);
    res.status(500).json({ error: "Failed to check sign-in status." });
  }
});

// ✅ WALDO Trustline Check
router.get("/trustline-check", async (req, res) => {
  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ hasWaldoTrustline: false, error: "Missing wallet parameter." });
  }

  const client = new Client("wss://s1.ripple.com"); // ✅ XRPL MAINNET

  try {
    await client.connect();

    const response = await client.request({
      command: "account_lines",
      account: wallet
    });

    const hasWaldoTrustline = response.result.lines.some(
      line => line.currency === CURRENCY && line.account === WALDO_ISSUER
    );

    res.json({ hasWaldoTrustline });
  } catch (err) {
    console.error("❌ Trustline check failed:", err);
    res.status(500).json({
      hasWaldoTrustline: false,
      error: "Trustline check failed. Try again later."
    });
  } finally {
    await client.disconnect();
  }
});

export default router;

