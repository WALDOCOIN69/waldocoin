import { redis } from "../redisClient.js";

// Defaults per user's latest spec
const DEFAULTS = {
  battle: {
    startFeeWLO: 1000,
    acceptFeeWLO: 600,
    voteFeeWLO: 200,
    useDefaults: true
  }
};

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

export async function getPublicConfig() {
  const battle = await getBattleFees();
  return { battle };
}

export default {
  getBattleFees,
  setBattleFees,
  getPublicConfig,
  DEFAULTS
};

