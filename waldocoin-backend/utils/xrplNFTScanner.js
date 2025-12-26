/**
 * 🔍 XRPL NFT Scanner for WALDO Lottery System
 * Scans the XRPL blockchain to find all wallets holding WALDO NFTs
 */

import xrpl from 'xrpl';
import { redis, connectRedis } from '../redisClient.js';
import dotenv from 'dotenv';

dotenv.config();

const WALDO_ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const DISTRIBUTOR = process.env.DISTRIBUTOR_WALLET || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
const WALDO_NFT_IPFS_CID = 'QmbMEsDMd3XEHEVEtbZQdfXegERhHoXkW9a39C4BQRmKjY';
const CACHE_KEY = 'lottery:nft_holders';
const CACHE_TTL = 3600;
const LAST_SCAN_KEY = 'lottery:last_scan';

function isWaldoNFT(nft) {
  if (!nft.URI) return false;
  try {
    const uri = Buffer.from(nft.URI, 'hex').toString();
    return uri.includes('waldo') || uri.includes(WALDO_NFT_IPFS_CID);
  } catch { return false; }
}

function isKingNFT(nft) {
  if (!nft.URI) return false;
  try {
    const uri = Buffer.from(nft.URI, 'hex').toString().toLowerCase();
    return uri.includes('king') || uri.includes('monarch') || uri.includes('royal');
  } catch { return false; }
}

function getTierInfo(nftCount, hasKingNFT) {
  if (hasKingNFT) return { tier: 'KING', ticketsPerNFT: 10, emoji: '👑', guaranteed: true };
  if (nftCount >= 10) return { tier: 'Platinum', ticketsPerNFT: 3, emoji: '💎', guaranteed: false };
  if (nftCount >= 3) return { tier: 'Gold', ticketsPerNFT: 2, emoji: '🥇', guaranteed: false };
  return { tier: 'Silver', ticketsPerNFT: 1, emoji: '🥈', guaranteed: false };
}

export async function scanXRPLForNFTHolders() {
  const client = new xrpl.Client('wss://xrplcluster.com');
  try {
    await client.connect();
    console.log('✅ Connected to XRPL for NFT scan');

    let allHolders = [];
    let marker = undefined;
    do {
      const resp = await client.request({
        command: 'account_lines',
        account: WALDO_ISSUER,
        limit: 400,
        marker
      });
      allHolders = allHolders.concat(resp.result.lines.map(l => l.account));
      marker = resp.result.marker;
    } while (marker);

    console.log(`📋 Found ${allHolders.length} WALDO trustline holders`);

    const nftHolders = [];
    let scanned = 0;

    for (const wallet of allHolders) {
      if (wallet === DISTRIBUTOR || wallet === WALDO_ISSUER) continue;
      scanned++;

      try {
        const nfts = await client.request({ command: 'account_nfts', account: wallet, limit: 100 });
        if (nfts.result.account_nfts?.length > 0) {
          let waldoNFTCount = 0;
          let hasKingNFT = false;
          const nftIds = [];

          for (const nft of nfts.result.account_nfts) {
            if (isWaldoNFT(nft)) {
              waldoNFTCount++;
              nftIds.push(nft.NFTokenID);
              if (isKingNFT(nft)) hasKingNFT = true;
            }
          }

          if (waldoNFTCount > 0) {
            const tierInfo = getTierInfo(waldoNFTCount, hasKingNFT);
            nftHolders.push({
              wallet,
              nftCount: waldoNFTCount,
              hasKingNFT,
              tier: tierInfo.tier,
              tierEmoji: tierInfo.emoji,
              ticketsPerNFT: tierInfo.ticketsPerNFT,
              totalTickets: waldoNFTCount * tierInfo.ticketsPerNFT,
              guaranteed: tierInfo.guaranteed,
              nftIds
            });
            console.log(`✅ ${tierInfo.emoji} ${wallet.slice(0,12)}... : ${waldoNFTCount} NFT(s)`);
          }
        }
      } catch (e) { /* skip */ }

      if (scanned % 100 === 0) console.log(`  Progress: ${scanned}/${allHolders.length}`);
    }

    await client.disconnect();
    return nftHolders;
  } catch (error) {
    console.error('❌ XRPL scan error:', error.message);
    await client.disconnect();
    throw error;
  }
}

export async function scanAndCacheNFTHolders(forceRefresh = false) {
  await connectRedis();
  if (!forceRefresh) {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      console.log('📦 Using cached NFT holder data');
      return JSON.parse(cached);
    }
  }

  console.log('🔄 Scanning XRPL for NFT holders...');
  const holders = await scanXRPLForNFTHolders();

  await redis.set(CACHE_KEY, JSON.stringify(holders), { EX: CACHE_TTL });
  await redis.set(LAST_SCAN_KEY, new Date().toISOString());

  for (const holder of holders) {
    await redis.hSet(`lottery:holder:${holder.wallet}`, {
      nftCount: holder.nftCount.toString(),
      hasKingNFT: holder.hasKingNFT ? '1' : '0',
      tier: holder.tier,
      totalTickets: holder.totalTickets.toString(),
      guaranteed: holder.guaranteed ? '1' : '0'
    });
    await redis.expire(`lottery:holder:${holder.wallet}`, CACHE_TTL);
  }

  console.log(`✅ Cached ${holders.length} NFT holders in Redis`);
  return holders;
}

export async function getNFTHolders(forceRefresh = false) {
  return await scanAndCacheNFTHolders(forceRefresh);
}

export async function getLastScanTime() {
  await connectRedis();
  return await redis.get(LAST_SCAN_KEY);
}

export async function runMonthlyLottery() {
  await connectRedis();

  const holders = await getNFTHolders(true);
  if (holders.length === 0) throw new Error('No NFT holders found');

  const poolStr = await redis.get('lottery:pool') || '0';
  const totalPool = parseFloat(poolStr);
  if (totalPool <= 0) throw new Error('Lottery pool is empty');

  const kingHolders = holders.filter(h => h.guaranteed || h.hasKingNFT);
  const regularHolders = holders.filter(h => !h.guaranteed && !h.hasKingNFT);

  const kingPoolShare = kingHolders.length > 0 ? totalPool * 0.5 : 0;
  const lotteryPoolShare = totalPool - kingPoolShare;

  const kingWinners = kingHolders.map(h => ({
    wallet: h.wallet,
    tier: 'KING',
    emoji: '👑',
    nftCount: h.nftCount,
    prize: kingHolders.length > 0 ? kingPoolShare / kingHolders.length : 0,
    guaranteed: true
  }));

  const ticketPool = [];
  for (const holder of regularHolders) {
    for (let i = 0; i < holder.totalTickets; i++) {
      ticketPool.push(holder.wallet);
    }
  }

  const numWinners = Math.min(5, regularHolders.length);
  const selectedWallets = new Set();
  const lotteryWinners = [];

  for (let i = ticketPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ticketPool[i], ticketPool[j]] = [ticketPool[j], ticketPool[i]];
  }

  for (const wallet of ticketPool) {
    if (selectedWallets.size >= numWinners) break;
    if (!selectedWallets.has(wallet)) {
      selectedWallets.add(wallet);
      const holder = regularHolders.find(h => h.wallet === wallet);
      lotteryWinners.push({
        wallet,
        tier: holder.tier,
        emoji: holder.tierEmoji,
        nftCount: holder.nftCount,
        tickets: holder.totalTickets,
        prize: lotteryPoolShare / numWinners,
        guaranteed: false
      });
    }
  }

  const lotteryResult = {
    date: new Date().toISOString(),
    totalPool,
    kingPoolShare,
    lotteryPoolShare,
    kingWinners,
    lotteryWinners,
    totalHolders: holders.length,
    totalTickets: ticketPool.length
  };

  await redis.lPush('lottery:history', JSON.stringify(lotteryResult));
  await redis.set('lottery:last_result', JSON.stringify(lotteryResult));
  await redis.set('lottery:pool', '0');

  console.log('🎰 LOTTERY COMPLETE!');
  console.log(`👑 KING Winners: ${kingWinners.length}`);
  console.log(`🎲 Lottery Winners: ${lotteryWinners.length}`);
  console.log(`💰 Total Distributed: ${totalPool} WALDO`);

  return lotteryResult;
}

export async function getLotteryStatus() {
  await connectRedis();

  const [holders, poolStr, lastResult, lastScan] = await Promise.all([
    getNFTHolders(),
    redis.get('lottery:pool'),
    redis.get('lottery:last_result'),
    redis.get(LAST_SCAN_KEY)
  ]);

  const totalPool = parseFloat(poolStr || '0') || 0;
  const kingHolders = holders.filter(h => h.hasKingNFT || h.guaranteed);
  const regularHolders = holders.filter(h => !h.hasKingNFT && !h.guaranteed);
  const totalTickets = regularHolders.reduce((sum, h) => sum + h.totalTickets, 0);
  const totalNFTs = holders.reduce((sum, h) => sum + h.nftCount, 0);

  return {
    pool: totalPool,
    lastScan,
    holders: holders.map(h => ({
      wallet: h.wallet,
      nftCount: h.nftCount,
      tier: h.tier,
      tierEmoji: h.tierEmoji,
      tickets: h.totalTickets,
      hasKingNFT: h.hasKingNFT,
      guaranteed: h.guaranteed
    })),
    stats: {
      totalHolders: holders.length,
      totalNFTs,
      totalTickets,
      kingHolders: kingHolders.length,
      regularHolders: regularHolders.length
    },
    lastResult: lastResult ? JSON.parse(lastResult) : null
  };
}

export async function addToLotteryPool(amount) {
  await connectRedis();
  const current = parseFloat(await redis.get('lottery:pool') || '0');
  const newTotal = current + amount;
  await redis.set('lottery:pool', newTotal.toString());
  return newTotal;
}

export async function getLotteryHistory(limit = 10) {
  await connectRedis();
  const history = await redis.lRange('lottery:history', 0, limit - 1);
  return history.map(h => JSON.parse(h));
}
