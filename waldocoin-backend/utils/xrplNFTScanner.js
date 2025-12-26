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
const WALDO_NFT_IPFS_CID_ALT = 'QmT1K3mkcpZRyHyiFm7iwsMRtE1bqA64iPCkuJ29Gi2bDu';
const CACHE_KEY = 'lottery:nft_holders';
const CACHE_TTL = 3600;
const LAST_SCAN_KEY = 'lottery:last_scan';

// KING NFTs are #1, #2, #3, #4, #5 (verified from metadata: "Bonus Group": "king")
const KING_NFT_NUMBERS = [1, 2, 3, 4, 5];

function isWaldoNFT(nft) {
  if (!nft.URI) return false;
  try {
    const uri = Buffer.from(nft.URI, 'hex').toString();
    return uri.includes('waldo') || uri.includes(WALDO_NFT_IPFS_CID) || uri.includes(WALDO_NFT_IPFS_CID_ALT);
  } catch { return false; }
}

function getWaldoNFTInfo(nft) {
  if (!nft.URI) return null;
  try {
    const uri = Buffer.from(nft.URI, 'hex').toString();
    if (!uri.includes('waldo') && !uri.includes(WALDO_NFT_IPFS_CID) && !uri.includes(WALDO_NFT_IPFS_CID_ALT)) {
      return null;
    }

    // Extract NFT number from URI (e.g., "/165.json" -> 165)
    const match = uri.match(/\/([0-9]+)\.json/);
    const nftNumber = match ? parseInt(match[1]) : null;

    // KING NFTs are #1-5
    const isKing = nftNumber !== null && KING_NFT_NUMBERS.includes(nftNumber);

    return {
      uri,
      nftNumber,
      isKing,
      nftId: nft.NFTokenID
    };
  } catch { return null; }
}

function getTierInfo(nftCount, hasKingNFT) {
  // KING NFT holders get most tickets but are NOT guaranteed winners
  if (hasKingNFT) return { tier: 'KING', ticketsPerNFT: 5, emoji: '👑', guaranteed: false };
  if (nftCount >= 10) return { tier: 'Platinum', ticketsPerNFT: 3, emoji: '💎', guaranteed: false };
  if (nftCount >= 3) return { tier: 'Gold', ticketsPerNFT: 2, emoji: '🥇', guaranteed: false };
  return { tier: 'Silver', ticketsPerNFT: 1, emoji: '🥈', guaranteed: false };
}

export async function scanXRPLForNFTHolders() {
  const client = new xrpl.Client('wss://xrplcluster.com');
  try {
    await client.connect();
    console.log('✅ Connected to XRPL for NFT scan');

    // Step 1: Get all WALDO trustline holders
    let walletsToCheck = new Set();
    let marker = undefined;
    do {
      const resp = await client.request({
        command: 'account_lines',
        account: WALDO_ISSUER,
        limit: 400,
        marker
      });
      resp.result.lines.forEach(l => walletsToCheck.add(l.account));
      marker = resp.result.marker;
    } while (marker);

    console.log(`📋 Found ${walletsToCheck.size} WALDO trustline holders`);

    // Step 2: Also get NFT buyers from distributor transaction history
    console.log('📋 Scanning distributor transaction history for NFT buyers...');
    marker = undefined;
    do {
      const txs = await client.request({
        command: 'account_tx',
        account: DISTRIBUTOR,
        limit: 400,
        marker
      });
      for (const item of txs.result.transactions) {
        const tx = item.tx_json || item.tx || {};
        // NFTokenAcceptOffer = confirmed NFT purchase
        if (tx.TransactionType === 'NFTokenAcceptOffer' && tx.Account) {
          walletsToCheck.add(tx.Account);
        }
        // Also check offer destinations
        if (tx.Destination) {
          walletsToCheck.add(tx.Destination);
        }
      }
      marker = txs.result.marker;
    } while (marker);

    console.log(`📋 Total wallets to scan: ${walletsToCheck.size}`);

    const nftHolders = [];
    let scanned = 0;
    const totalWallets = walletsToCheck.size;

    for (const wallet of walletsToCheck) {
      if (wallet === DISTRIBUTOR || wallet === WALDO_ISSUER) continue;
      scanned++;

      try {
        const nfts = await client.request({ command: 'account_nfts', account: wallet, limit: 400 });
        if (nfts.result.account_nfts?.length > 0) {
          let waldoNFTCount = 0;
          let hasKingNFT = false;
          let kingNFTCount = 0;
          const nftIds = [];
          const nftNumbers = [];

          for (const nft of nfts.result.account_nfts) {
            const nftInfo = getWaldoNFTInfo(nft);
            if (nftInfo) {
              waldoNFTCount++;
              nftIds.push(nftInfo.nftId);
              if (nftInfo.nftNumber) nftNumbers.push(nftInfo.nftNumber);
              if (nftInfo.isKing) {
                hasKingNFT = true;
                kingNFTCount++;
                console.log(`👑 KING NFT #${nftInfo.nftNumber} found on ${wallet.slice(0,12)}...`);
              }
            }
          }

          if (waldoNFTCount > 0) {
            const tierInfo = getTierInfo(waldoNFTCount, hasKingNFT);
            nftHolders.push({
              wallet,
              nftCount: waldoNFTCount,
              hasKingNFT,
              kingNFTCount,
              tier: tierInfo.tier,
              tierEmoji: tierInfo.emoji,
              ticketsPerNFT: tierInfo.ticketsPerNFT,
              totalTickets: waldoNFTCount * tierInfo.ticketsPerNFT,
              guaranteed: tierInfo.guaranteed,
              nftIds,
              nftNumbers
            });
            console.log(`✅ ${tierInfo.emoji} ${wallet.slice(0,12)}... : ${waldoNFTCount} NFT(s)${hasKingNFT ? ' (includes ' + kingNFTCount + ' KING)' : ''}`);
          }
        }
      } catch (e) { /* skip */ }

      if (scanned % 100 === 0) console.log(`  Progress: ${scanned}/${totalWallets}`);
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
