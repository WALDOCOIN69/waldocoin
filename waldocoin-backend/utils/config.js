import { redis } from "../redisClient.js";

// Defaults per user's latest spec
const DEFAULTS = {
  battle: {
    startFeeWLO: 150000,  // 150K WLO
    acceptFeeWLO: 75000,  // 75K WLO
    voteFeeWLO: 30000,    // 30K WLO
    useDefaults: true
  },
	  claim: {
	    instantFeeRate: 0.10,
	    stakedFeeRate: 0.05,
	    burnRate: 0.0025,      // 0.25% burned (changed from 2%)
	    utilityPoolRate: 0.10,   // 10% to NFT holder utility pool (discretionary)
	    useDefaults: true
	  },
  nft: {
    mintCostWLO: 500,
    useDefaults: true
  },
  dao: {
    votingRequirementWLO: 50000, // 1 vote per 50k WALDO
    useDefaults: true
  },
	  staking: {
	    minimumAmountLongTerm: 1000,
	    longTermStakingFee: 0.02,  // 2% fee for long-term staking
	    earlyUnstakePenalty: 0.15,
	    maxActiveStakes: 10,
	    burnRate: 0.0025,          // 0.25% burned (changed from 2%)
	    revenueShareRate: 0.10,    // 10% to NFT holder revenue share
	    useDefaults: true
	  }
};

// Battle fees
export async function getBattleFees() {
  const useDefaultsRaw = await redis.get("config:battle:useDefaults");
  const useDefaults = useDefaultsRaw == null ? DEFAULTS.battle.useDefaults : (useDefaultsRaw === "true");
  if (useDefaults) return { ...DEFAULTS.battle };
  const start = parseFloat(await redis.get("config:battle:startFeeWLO"));
  const accept = parseFloat(await redis.get("config:battle:acceptFeeWLO"));
  const vote = parseFloat(await redis.get("config:battle:voteFeeWLO"));
  return {
    startFeeWLO: Number.isFinite(start) ? start : DEFAULTS.battle.startFeeWLO,
    acceptFeeWLO: Number.isFinite(accept) ? accept : DEFAULTS.battle.acceptFeeWLO,
    voteFeeWLO: Number.isFinite(vote) ? vote : DEFAULTS.battle.voteFeeWLO,
    useDefaults: false
  };
}
export async function setBattleFees({ useDefaults, startFeeWLO, acceptFeeWLO, voteFeeWLO }) {
  if (typeof useDefaults === 'boolean') await redis.set("config:battle:useDefaults", String(useDefaults));
  if (startFeeWLO !== undefined) await redis.set("config:battle:startFeeWLO", startFeeWLO);
  if (acceptFeeWLO !== undefined) await redis.set("config:battle:acceptFeeWLO", acceptFeeWLO);
  if (voteFeeWLO !== undefined) await redis.set("config:battle:voteFeeWLO", voteFeeWLO);
}

// Claim fees
export async function getClaimConfig() {
  const useDefaultsRaw = await redis.get("config:claim:useDefaults");
  const useDefaults = useDefaultsRaw == null ? DEFAULTS.claim.useDefaults : (useDefaultsRaw === "true");
  if (useDefaults) return { ...DEFAULTS.claim };
  const instant = parseFloat(await redis.get("config:claim:instantFeeRate"));
  const staked = parseFloat(await redis.get("config:claim:stakedFeeRate"));
  const burn = parseFloat(await redis.get("config:claim:burnRate"));
  const revenueShare = parseFloat(await redis.get("config:claim:revenueShareRate"));
  return {
    instantFeeRate: Number.isFinite(instant) ? instant : DEFAULTS.claim.instantFeeRate,
    stakedFeeRate: Number.isFinite(staked) ? staked : DEFAULTS.claim.stakedFeeRate,
    burnRate: Number.isFinite(burn) ? burn : DEFAULTS.claim.burnRate,
    revenueShareRate: Number.isFinite(revenueShare) ? revenueShare : DEFAULTS.claim.revenueShareRate,
    useDefaults: false
  };
}
export async function setClaimConfig({ useDefaults, instantFeeRate, stakedFeeRate, burnRate, revenueShareRate }) {
  if (typeof useDefaults === 'boolean') await redis.set("config:claim:useDefaults", String(useDefaults));
  if (instantFeeRate !== undefined) await redis.set("config:claim:instantFeeRate", instantFeeRate);
  if (stakedFeeRate !== undefined) await redis.set("config:claim:stakedFeeRate", stakedFeeRate);
  if (burnRate !== undefined) await redis.set("config:claim:burnRate", burnRate);
  if (revenueShareRate !== undefined) await redis.set("config:claim:revenueShareRate", revenueShareRate);
}

// NFT mint
export async function getNftConfig() {
  const useDefaultsRaw = await redis.get("config:nft:useDefaults");
  const useDefaults = useDefaultsRaw == null ? DEFAULTS.nft.useDefaults : (useDefaultsRaw === "true");
  if (useDefaults) return { ...DEFAULTS.nft };
  const mint = parseFloat(await redis.get("config:nft:mintCostWLO"));
  return {
    mintCostWLO: Number.isFinite(mint) ? mint : DEFAULTS.nft.mintCostWLO,
    useDefaults: false
  };
}
export async function setNftConfig({ useDefaults, mintCostWLO }) {
  if (typeof useDefaults === 'boolean') await redis.set("config:nft:useDefaults", String(useDefaults));
  if (mintCostWLO !== undefined) await redis.set("config:nft:mintCostWLO", mintCostWLO);
}

// DAO config
export async function getDaoConfig() {
  const useDefaultsRaw = await redis.get("config:dao:useDefaults");
  const useDefaults = useDefaultsRaw == null ? DEFAULTS.dao.useDefaults : (useDefaultsRaw === "true");
  if (useDefaults) return { ...DEFAULTS.dao };
  const reqWLO = parseFloat(await redis.get("config:dao:votingRequirementWLO"));
  return {
    votingRequirementWLO: Number.isFinite(reqWLO) ? reqWLO : DEFAULTS.dao.votingRequirementWLO,
    useDefaults: false
  };
}
export async function setDaoConfig({ useDefaults, votingRequirementWLO }) {
  if (typeof useDefaults === 'boolean') await redis.set("config:dao:useDefaults", String(useDefaults));
  if (votingRequirementWLO !== undefined) await redis.set("config:dao:votingRequirementWLO", votingRequirementWLO);
}

// Staking config
export async function getStakingConfig() {
  const useDefaultsRaw = await redis.get("config:staking:useDefaults");
  const useDefaults = useDefaultsRaw == null ? DEFAULTS.staking.useDefaults : (useDefaultsRaw === "true");
  if (useDefaults) return { ...DEFAULTS.staking };
  const min = parseFloat(await redis.get("config:staking:minimumAmountLongTerm"));
  const stakingFee = parseFloat(await redis.get("config:staking:longTermStakingFee"));
  const penalty = parseFloat(await redis.get("config:staking:earlyUnstakePenalty"));
  const max = parseInt(await redis.get("config:staking:maxActiveStakes"));
  const burn = parseFloat(await redis.get("config:staking:burnRate"));
  const revenueShare = parseFloat(await redis.get("config:staking:revenueShareRate"));
  return {
    minimumAmountLongTerm: Number.isFinite(min) ? min : DEFAULTS.staking.minimumAmountLongTerm,
    longTermStakingFee: Number.isFinite(stakingFee) ? stakingFee : DEFAULTS.staking.longTermStakingFee,
    earlyUnstakePenalty: Number.isFinite(penalty) ? penalty : DEFAULTS.staking.earlyUnstakePenalty,
    maxActiveStakes: Number.isFinite(max) ? max : DEFAULTS.staking.maxActiveStakes,
    burnRate: Number.isFinite(burn) ? burn : DEFAULTS.staking.burnRate,
    revenueShareRate: Number.isFinite(revenueShare) ? revenueShare : DEFAULTS.staking.revenueShareRate,
    useDefaults: false
  };
}
export async function setStakingConfig({ useDefaults, minimumAmountLongTerm, longTermStakingFee, earlyUnstakePenalty, maxActiveStakes, burnRate, revenueShareRate }) {
  if (typeof useDefaults === 'boolean') await redis.set("config:staking:useDefaults", String(useDefaults));
  if (minimumAmountLongTerm !== undefined) await redis.set("config:staking:minimumAmountLongTerm", minimumAmountLongTerm);
  if (longTermStakingFee !== undefined) await redis.set("config:staking:longTermStakingFee", longTermStakingFee);
  if (earlyUnstakePenalty !== undefined) await redis.set("config:staking:earlyUnstakePenalty", earlyUnstakePenalty);
  if (maxActiveStakes !== undefined) await redis.set("config:staking:maxActiveStakes", maxActiveStakes);
  if (burnRate !== undefined) await redis.set("config:staking:burnRate", burnRate);
  if (revenueShareRate !== undefined) await redis.set("config:staking:revenueShareRate", revenueShareRate);
}

export async function getPublicConfig() {
  const [battle, claim, nft, dao, staking] = await Promise.all([
    getBattleFees(),
    getClaimConfig(),
    getNftConfig(),
    getDaoConfig(),
    getStakingConfig()
  ]);
  return { battle, claim, nft, dao, staking };
}

export default {
  getBattleFees,
  setBattleFees,
  getClaimConfig,
  setClaimConfig,
  getNftConfig,
  setNftConfig,
  getDaoConfig,
  setDaoConfig,
  getStakingConfig,
  setStakingConfig,
  getPublicConfig,
  DEFAULTS
};

