// routes/xrpl/trade.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";
import getWaldoPerXrp from "../../utils/getWaldoPerXrp.js";
import { redis } from "../../redisClient.js";

import xrpl from "xrpl";

const router = express.Router();

// POST /api/xrpl/trade/offer
// Body: { side: "buy"|"sell", amountWlo?: number, amountXrp?: number, slippageBps?: number, destination?: string }
router.post("/offer", async (req, res) => {
  try {
    const { side, amountWlo, amountXrp, slippageBps, destination } = req.body || {};
    if (!side || !["buy", "sell"].includes(side)) {
      return res.status(400).json({ success: false, error: "side must be 'buy' or 'sell'" });
    }
    const DEST = (typeof destination === 'string' && destination.startsWith('r')) ? destination : undefined;
    const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || "WLO").toUpperCase();

    const waldoPerXrpRaw = await getWaldoPerXrp().catch(() => null);

    // Admin override via Redis: price:xrp_per_wlo:override (if present, use exactly)
    let overrideMid = null;
    try {
      overrideMid = Number(await redis.get('price:xrp_per_wlo:override'));
      if (!isFinite(overrideMid) || overrideMid <= 0) overrideMid = null;
    } catch (_) { overrideMid = null; }

    // Prefer Magnetic mid, then XRPL books; override always wins if present
    async function getPricesFromBooks() {
      const client = new xrpl.Client("wss://xrplcluster.com");
      await client.connect();
      const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
      const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || "WLO").toUpperCase();
      const a = await client.request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: { currency: CURRENCY, issuer: ISSUER }, limit: 5 });
      const b = await client.request({ command: 'book_offers', taker_gets: { currency: CURRENCY, issuer: ISSUER }, taker_pays: { currency: 'XRP' }, limit: 5 });
      await client.disconnect();
      let ask = null, bid = null;
      if (a.result?.offers?.length) { const o = a.result.offers[0]; const px = (Number(o.TakerGets) / 1_000_000) / Number(o.TakerPays.value); if (px > 0 && isFinite(px)) ask = px; }
      if (b.result?.offers?.length) { const o = b.result.offers[0]; const px = (Number(o.TakerPays) / 1_000_000) / Number(o.TakerGets.value); if (px > 0 && isFinite(px)) bid = px; }
      const mid = (bid && ask) ? (bid + ask) / 2 : (bid || ask || null);
      return { bid, ask, mid };
    }
    const magMid = (waldoPerXrpRaw && isFinite(waldoPerXrpRaw) && waldoPerXrpRaw !== 10000) ? (1 / waldoPerXrpRaw) : null;
    const bookPrices = await getPricesFromBooks().catch(() => ({ bid: null, ask: null, mid: null }));
    const baseMid = overrideMid ?? (magMid ?? bookPrices.mid ?? 0.00001); // XRP per WLO

    // Optional price adjustments (raise price) via env (skip if override specified)
    const multRaw = process.env.PRICE_MULTIPLIER_XRP_PER_WLO;
    const floorRaw = process.env.PRICE_FLOOR_XRP_PER_WLO;
    const multiplier = Number(multRaw);
    const floor = Number(floorRaw);
    let mid = baseMid;
    if (!overrideMid) {
      if (isFinite(multiplier) && multiplier > 0) mid = mid * multiplier;
      if (isFinite(floor) && floor > 0) mid = Math.max(mid, floor);
    }

    const bps = Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 0;
    const slip = Math.max(0, bps) / 10_000; // 0.01 = 1%
    const tradeFee = 0.03; // 3% fee on all trades

    // Optional default destination for SELL payouts (e.g., treasury)
    const DEFAULT_DEST = process.env.SWAP_DESTINATION || process.env.SWAP_PAYOUT_DESTINATION;

    // Payment via paths to use AMM LP + order book
    let txjson;
    if (side === "buy") {
      const xrp = Number(amountXrp);
      if (!Number.isFinite(xrp) || xrp <= 0) return res.status(400).json({ success: false, error: "amountXrp required for buy" });

      // For BUY: use ASK price (what sellers are asking) - user pays more
      const priceToUse = bookPrices.ask || mid;

      // For buy: Create a simple XRP to WLO payment
      // Apply 3% fee: user gets 3% less WLO
      const wloAmount = (xrp / priceToUse) * (1 - tradeFee);
      const distributorWallet = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.DISTRIBUTOR_WALLET || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
      txjson = {
        TransactionType: "Payment",
        Destination: distributorWallet,
        Amount: String(Math.round(xrp * 1_000_000)), // XRP in drops
        Memos: [{
          Memo: {
            MemoType: Buffer.from('WALDO_BUY').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Buy ${wloAmount.toFixed(6)} WLO for ${xrp} XRP (3% fee, ask price)`).toString('hex').toUpperCase()
          }
        }]
      };
    } else {
      const wlo = Number(amountWlo);
      if (!Number.isFinite(wlo) || wlo <= 0) return res.status(400).json({ success: false, error: "amountWlo required for sell" });

      // For SELL: use BID price (what buyers are bidding) - user gets less
      const priceToUse = bookPrices.bid || mid;

      // For sell: Create a simple WLO to distributor payment
      // Apply 3% fee: user gets 3% less XRP
      const xrpAmount = (wlo * priceToUse) * (1 - tradeFee);
      const distributorWallet = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.DISTRIBUTOR_WALLET || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
      txjson = {
        TransactionType: "Payment",
        Destination: distributorWallet,
        Amount: { currency: CURRENCY, issuer: ISSUER, value: String(wlo.toFixed(6)) },
        Memos: [{
          Memo: {
            MemoType: Buffer.from('WALDO_SELL').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Sell ${wlo} WLO for ${xrpAmount.toFixed(6)} XRP (3% fee, bid price)`).toString('hex').toUpperCase()
          }
        }]
      };
    }

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 300, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: { identifier: `WALDO_TRADE_${side.toUpperCase()}`, instruction: 'Sign in Xaman and stay in the app' }
    });

    // Store trade intent for later processing on /status
    try {
      const key = `trade:offer:${created.uuid}`;
      await redis.hSet(key, {
        side,
        amountXrp: side === 'buy' ? String(Number(amountXrp || 0)) : '',
        amountWlo: side === 'sell' ? String(Number(amountWlo || 0)) : '',
        slippageBps: String(bps),
        mid: String(mid),
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn('trade:offer store failed', e?.message || e);
    }

    return res.json({ success: true, uuid: created.uuid, refs: created.refs, next: created.next });
  } catch (err) {
    console.error("❌ Trade offer error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/xrpl/trade/status/:uuid
router.get('/status/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    if (!uuid) return res.status(400).json({ ok: false, error: 'missing uuid' });

    const p = await xummClient.payload.get(uuid).catch(() => null);
    if (!p) return res.json({ ok: true, found: false });

    const signed = !!p?.meta?.signed;
    const account = p?.response?.account || null;
    const txid = p?.response?.txid || null;
    if (!signed) return res.json({ ok: true, signed: false, account: null });

    const processedKey = `trade:processed:${uuid}`;
    const processed = await redis.get(processedKey);
    if (processed) return res.json({ ok: true, signed: true, account, txid, delivered: true });

    const offer = await redis.hGetAll(`trade:offer:${uuid}`);
    const side = offer?.side;

    // Auto-deliver on SELL (send XRP back)
    if (side === 'sell') {
      const amountWlo = Number(offer?.amountWlo || 0);
      const midSell = Number(offer?.mid || 0);
      const bpsSell = Number(offer?.slippageBps || 0);
      const slipSell = Math.max(0, bpsSell) / 10000;
      const xrpOutRaw = (amountWlo > 0 && midSell > 0) ? amountWlo * (midSell * (1 - slipSell)) : 0;
      const xrpOut = Math.max(0, Math.floor(xrpOutRaw * 1e6) / 1e6);
      if (!account || !(xrpOut > 0)) {
        return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'calc_invalid' });
      }
      const lockKeySell = `trade:processing:${uuid}`;
      const lockedSell = await redis.set(lockKeySell, '1', { NX: true, EX: 60 });
      if (!lockedSell) {
        return res.json({ ok: true, signed: true, account, txid, delivered: false, processing: true });
      }
      const EXPECTED = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.WALDO_DISTRIBUTOR_ADDRESS || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
      const distSecret = process.env.WALDO_DISTRIBUTOR_SECRET || null;
      const altSecret = process.env.WALDO_SENDER_SECRET || null;
      let chosenSecret = distSecret || altSecret;
      let distAddr = null, altAddr = null;
      try { if (distSecret) distAddr = xrpl.Wallet.fromSeed(distSecret).address; } catch (_) { }
      try { if (altSecret) altAddr = xrpl.Wallet.fromSeed(altSecret).address; } catch (_) { }
      if (EXPECTED) {
        if (distAddr === EXPECTED) chosenSecret = distSecret; else if (altAddr === EXPECTED) chosenSecret = altSecret;
      }
      if (!chosenSecret) {
        await redis.del(lockKeySell).catch(() => { });
        return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'missing_sender_secret' });
      }
      const reserve = Number(process.env.SELL_MIN_RESERVE_XRP || process.env.MIN_RESERVE_XRP || 2);
      const clientSell = new xrpl.Client('wss://xrplcluster.com');
      await clientSell.connect();
      let walletSell;
      try { walletSell = xrpl.Wallet.fromSeed(chosenSecret); } catch (e) {
        await clientSell.disconnect(); await redis.del(lockKeySell).catch(() => { });
        return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'invalid_sender_secret' });
      }
      try {
        const info = await clientSell.request({ command: 'account_info', account: walletSell.address, ledger_index: 'validated' });
        const balXrp = Number(xrpl.dropsToXrp(info.result.account_data.Balance));
        const available = Math.max(0, balXrp - reserve);
        const payXrp = Math.min(xrpOut, available);
        if (!(payXrp > 0)) {
          await clientSell.disconnect(); await redis.del(lockKeySell).catch(() => { });
          return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'insufficient_xrp', balance: balXrp, reserve, desired: xrpOut });
        }
        const payment = { TransactionType: 'Payment', Account: walletSell.address, Destination: account, Amount: xrpl.xrpToDrops(payXrp.toFixed(6)) };
        const prepared = await clientSell.autofill(payment);
        const signedTx = walletSell.sign(prepared);
        const submit = await clientSell.submitAndWait(signedTx.tx_blob);
        const engine = submit?.result?.engine_result || submit?.result?.meta?.TransactionResult;
        const hash = submit?.result?.tx_json?.hash || submit?.result?.hash;
        await clientSell.disconnect();
        if (engine !== 'tesSUCCESS') { await redis.del(lockKeySell).catch(() => { }); return res.json({ ok: true, signed: true, account, txid, delivered: false, error: engine || 'unknown_error' }); }
        await redis.set(processedKey, '1', { EX: 604800 }).catch(() => { }); await redis.del(lockKeySell).catch(() => { });
        return res.json({ ok: true, signed: true, account, txid, delivered: true, paidXrp: payXrp, hash });
      } catch (e) {
        await clientSell.disconnect().catch(() => { }); await redis.del(lockKeySell).catch(() => { });
        return res.json({ ok: true, signed: true, account, txid, delivered: false, error: e?.message || 'payout_failed' });
      }
    }

    const ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
    const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || 'WLO').toUpperCase();

    const amountXrp = Number(offer?.amountXrp || 0);
    const mid = Number(offer?.mid || 0);
    const bps = Number(offer?.slippageBps || 0);
    const slip = Math.max(0, bps) / 10000;
    const wloOut = (amountXrp > 0 && mid > 0) ? amountXrp / (mid * (1 + slip)) : 0;
    const value = Math.floor(wloOut * 1e6) / 1e6; // 6dp

    if (!account || !Number.isFinite(value) || value <= 0) {
      return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'calc_invalid' });
    }

    // Idempotency lock to prevent duplicate deliveries under concurrent polling
    const lockKey = `trade:processing:${uuid}`;
    const locked = await redis.set(lockKey, '1', { NX: true, EX: 60 });
    if (!locked) {
      return res.json({ ok: true, signed: true, account, txid, delivered: false, processing: true });
    }

    // Choose the correct sender secret, preferring the one that matches the expected distributor wallet
    const EXPECTED = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.WALDO_DISTRIBUTOR_ADDRESS || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
    const distSecret = process.env.WALDO_DISTRIBUTOR_SECRET || null;
    const altSecret = process.env.WALDO_SENDER_SECRET || null;

    let chosenSecret = distSecret || altSecret;
    let distAddr = null, altAddr = null;
    try { if (distSecret) distAddr = xrpl.Wallet.fromSeed(distSecret).address; } catch (_) { }
    try { if (altSecret) altAddr = xrpl.Wallet.fromSeed(altSecret).address; } catch (_) { }

    if (EXPECTED) {
      if (distAddr === EXPECTED) chosenSecret = distSecret;
      else if (altAddr === EXPECTED) chosenSecret = altSecret;
    }

    if (!chosenSecret) {
      return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'missing_sender_secret' });
    }

    // Send WLO to buyer
    const client = new xrpl.Client('wss://xrplcluster.com');
    await client.connect();
    let wallet;
    try {
      wallet = xrpl.Wallet.fromSeed(chosenSecret);
    } catch (e) {
      await client.disconnect();
      await redis.del(lockKey).catch(() => { });
      return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'invalid_sender_secret' });
    }
    // Validate sender: allow master (EXPECTED) or RegularKey of EXPECTED
    let allowed = true;
    if (EXPECTED) {
      if (wallet.address !== EXPECTED) {
        allowed = false;
        try {
          const info = await client.request({ command: 'account_info', account: EXPECTED, ledger_index: 'current' });
          const rk = info?.result?.account_data?.RegularKey;
          if (rk && rk === wallet.address) allowed = true;
        } catch (_) { }
      }
    }
    if (!allowed) {
      await client.disconnect();
      await redis.del(lockKey).catch(() => { });
      return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'sender_address_mismatch', expected: EXPECTED, senderAddress: wallet.address });
    }
    const sourceAccount = EXPECTED || wallet.address;
    // Log sender address (no secret)
    try { console.log('[TRADE_DELIVER] sender', sourceAccount, 'signedBy', wallet.address, 'dest', account, 'value', value.toFixed(6)); } catch (_) { }
    const payment = {
      TransactionType: 'Payment',
      Account: sourceAccount,
      Destination: account,
      Amount: { currency: CURRENCY, issuer: ISSUER, value: value.toFixed(6) }
    };
    let prepared;
    try {
      prepared = await client.autofill(payment);
    } catch (e) {
      await client.disconnect();
      await redis.del(lockKey).catch(() => { });
      return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'sender_account_not_found', senderAddress: wallet?.address || null });
    }
    const signedTx = wallet.sign(prepared);
    const result = await client.submitAndWait(signedTx.tx_blob);
    const ok = (result?.result?.meta?.TransactionResult === 'tesSUCCESS') || (result?.engine_result === 'tesSUCCESS');
    const deliveredHash = result?.result?.hash || result?.tx_json?.hash || null;
    await client.disconnect();

    if (ok) {
      await redis.set(processedKey, '1', { EX: 604800 });
      await redis.del(lockKey).catch(() => { });
      await redis.hSet(`trade:offer:${uuid}`, { deliveredTx: deliveredHash || '', deliveredAt: new Date().toISOString() });
      return res.json({ ok: true, signed: true, account, txid, delivered: true, deliveredTx: deliveredHash, deliveredFrom: wallet.address });
    } else {
      await redis.del(lockKey).catch(() => { });
      return res.json({ ok: true, signed: true, account, txid, delivered: false, error: 'send_failed', senderAddress: wallet.address });
    }
  } catch (e) {
    console.error('trade status error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/xrpl/trade/worker/status — lightweight visibility into payout worker
router.get('/worker/status', async (req, res) => {
  try {
    let status = null;
    let events = [];
    try { status = await redis.get('autodistribute:status'); } catch (_) { }
    try { events = await redis.lRange('autodistribute:events', 0, 19); } catch (_) { }
    const parsedStatus = (() => { try { return status ? JSON.parse(status) : null; } catch { return null; } })();
    const parsedEvents = events.map(e => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean);

    const distributor = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.DISTRIBUTOR_WALLET || null;
    const issuer = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
    const currency = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || 'WLO').toUpperCase();

    const now = Date.now();
    const lastTs = parsedStatus?.ts || 0;
    const aliveMs = now - lastTs;
    const healthy = Number.isFinite(aliveMs) && aliveMs < 120000; // < 2 minutes since last heartbeat

    return res.json({
      success: true,
      healthy,
      listening: parsedStatus?.listening || distributor,
      sender: parsedStatus?.sender || null,
      issuer,
      currency,
      recent: parsedEvents,
      now,
      lastHeartbeat: lastTs
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});



export default router;

