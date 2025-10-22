import { redis } from "../redisClient.js";

console.log("🧩 Loaded: utils/feeCalculator.js");

/**
 * Universal Fee Calculator and Transparency System
 * 
 * Provides real-time fee calculations and transparent breakdowns
 * across all WALDOCOIN payment systems.
 */

// Fee structure definitions
const FEE_STRUCTURES = {
  BATTLE: {
    START: {
      base: 150000, // 150K WALDO
      destinationTag: 777,
      description: "Battle challenge creation fee"
    },
    ACCEPT: {
      base: 75000, // 75K WALDO
      destinationTag: 778,
      description: "Battle acceptance fee"
    },
    VOTE: {
      base: 30000, // 30K WALDO
      destinationTag: 779,
      description: "Battle voting fee"
    }
  },
  STAKING: {
    STAKE: {
      base: 0, // No fee for staking
      destinationTag: 780,
      description: "Long-term staking (no fee)"
    },
    UNSTAKE_EARLY: {
      percentage: 15, // 15% penalty
      destinationTag: 781,
      description: "Early unstaking penalty"
    }
  },
  CLAIM: {
    STANDARD: {
      base: 5000, // 5K WALDO
      destinationTag: 782,
      description: "Standard meme claim fee"
    },
    PREMIUM: {
      base: 2500, // 2.5K WALDO (50% discount)
      destinationTag: 783,
      description: "Premium tier claim fee (50% off)"
    },
    VIP: {
      base: 1250, // 1.25K WALDO (75% discount)
      destinationTag: 784,
      description: "VIP tier claim fee (75% off)"
    }
  },
  EXCHANGE: {
    BUY: {
      percentage: 3, // 3% fee
      destinationTag: 785,
      description: "Exchange buy fee"
    },
    SELL: {
      percentage: 3, // 3% fee
      destinationTag: 786,
      description: "Exchange sell fee"
    }
  },
  PRESALE: {
    PURCHASE: {
      base: 0, // No additional fee
      destinationTag: 787,
      description: "Presale purchase (no additional fee)"
    }
  }
};

/**
 * Calculate fees for a specific action
 * @param {string} category - Fee category (BATTLE, STAKING, etc.)
 * @param {string} action - Specific action (START, ACCEPT, etc.)
 * @param {Object} params - Calculation parameters
 * @returns {Object} - Fee calculation result
 */
export async function calculateFees(category, action, params = {}) {
  try {
    const feeStructure = FEE_STRUCTURES[category]?.[action];
    
    if (!feeStructure) {
      throw new Error(`Unknown fee structure: ${category}.${action}`);
    }

    const calculation = {
      category,
      action,
      feeStructure,
      breakdown: {},
      total: 0,
      currency: 'WLO',
      destinationTag: feeStructure.destinationTag,
      description: feeStructure.description
    };

    // Calculate base fee
    if (feeStructure.base) {
      calculation.breakdown.baseFee = feeStructure.base;
      calculation.total += feeStructure.base;
    }

    // Calculate percentage fee
    if (feeStructure.percentage && params.amount) {
      const percentageFee = Math.floor(params.amount * (feeStructure.percentage / 100));
      calculation.breakdown.percentageFee = percentageFee;
      calculation.total += percentageFee;
    }

    // Apply tier discounts for claims
    if (category === 'CLAIM' && params.tier) {
      const discounts = {
        'PREMIUM': 0.5, // 50% discount
        'VIP': 0.25     // 75% discount (25% of original)
      };
      
      if (discounts[params.tier]) {
        const originalTotal = calculation.total;
        calculation.total = Math.floor(calculation.total * discounts[params.tier]);
        calculation.breakdown.tierDiscount = originalTotal - calculation.total;
        calculation.breakdown.tierApplied = params.tier;
      }
    }

    // Apply staking discounts
    if (params.hasStaking && category === 'CLAIM') {
      const stakingDiscount = Math.floor(calculation.total * 0.5); // 50% discount
      calculation.total -= stakingDiscount;
      calculation.breakdown.stakingDiscount = stakingDiscount;
    }

    // Get current conversion rates for display
    const conversionRate = await getConversionRate();
    if (conversionRate) {
      calculation.xrpEquivalent = (calculation.total / conversionRate).toFixed(4);
      calculation.usdEquivalent = await getUSDEquivalent(calculation.total);
    }

    // Add burn information
    calculation.burnInfo = await getBurnInfo(category, action, calculation.total);

    return {
      success: true,
      calculation
    };

  } catch (error) {
    console.error('❌ Fee calculation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get conversion rate from WALDO to XRP
 * @returns {number|null} - Conversion rate or null if unavailable
 */
async function getConversionRate() {
  try {
    const rate = await redis.get("conversion:waldo_per_xrp");
    return rate ? parseFloat(rate) : null;
  } catch (error) {
    console.warn('Failed to get conversion rate:', error);
    return null;
  }
}

/**
 * Get USD equivalent of WALDO amount
 * @param {number} waldoAmount - Amount in WALDO
 * @returns {string|null} - USD equivalent or null if unavailable
 */
async function getUSDEquivalent(waldoAmount) {
  try {
    const waldoPerXrp = await redis.get("conversion:waldo_per_xrp");
    const xrpPrice = await redis.get("price:xrp_usd");
    
    if (waldoPerXrp && xrpPrice) {
      const xrpAmount = waldoAmount / parseFloat(waldoPerXrp);
      const usdAmount = xrpAmount * parseFloat(xrpPrice);
      return usdAmount.toFixed(2);
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to get USD equivalent:', error);
    return null;
  }
}

/**
 * Get burn information for fee calculation
 * @param {string} category - Fee category
 * @param {string} action - Fee action
 * @param {number} totalFee - Total fee amount
 * @returns {Object} - Burn information
 */
async function getBurnInfo(category, action, totalFee) {
  const burnRates = {
    BATTLE: 0.05, // 5% of battle pot burned
    CLAIM: 0.02,  // 2% of claim fees burned
    EXCHANGE: 0.01 // 1% of exchange fees burned
  };

  const burnRate = burnRates[category] || 0;
  const burnAmount = Math.floor(totalFee * burnRate);

  return {
    burnRate: burnRate * 100, // Convert to percentage
    burnAmount,
    description: burnAmount > 0 
      ? `${burnAmount} WALDO will be burned (${(burnRate * 100).toFixed(1)}% of fee)`
      : 'No tokens burned for this action'
  };
}

/**
 * Get fee breakdown for display in UI
 * @param {string} category - Fee category
 * @param {string} action - Fee action
 * @param {Object} params - Calculation parameters
 * @returns {Object} - Formatted fee breakdown for UI
 */
export async function getFeeBreakdownForUI(category, action, params = {}) {
  const result = await calculateFees(category, action, params);
  
  if (!result.success) {
    return {
      success: false,
      error: result.error
    };
  }

  const { calculation } = result;
  const breakdown = [];

  // Base fee
  if (calculation.breakdown.baseFee) {
    breakdown.push({
      label: 'Base Fee',
      amount: calculation.breakdown.baseFee,
      description: calculation.description
    });
  }

  // Percentage fee
  if (calculation.breakdown.percentageFee) {
    breakdown.push({
      label: `${calculation.feeStructure.percentage}% Fee`,
      amount: calculation.breakdown.percentageFee,
      description: `${calculation.feeStructure.percentage}% of ${params.amount?.toLocaleString()} WALDO`
    });
  }

  // Tier discount
  if (calculation.breakdown.tierDiscount) {
    breakdown.push({
      label: `${calculation.breakdown.tierApplied} Discount`,
      amount: -calculation.breakdown.tierDiscount,
      description: 'Tier-based fee reduction',
      isDiscount: true
    });
  }

  // Staking discount
  if (calculation.breakdown.stakingDiscount) {
    breakdown.push({
      label: 'Staking Discount',
      amount: -calculation.breakdown.stakingDiscount,
      description: '50% discount for staked users',
      isDiscount: true
    });
  }

  return {
    success: true,
    breakdown,
    total: calculation.total,
    currency: calculation.currency,
    xrpEquivalent: calculation.xrpEquivalent,
    usdEquivalent: calculation.usdEquivalent,
    burnInfo: calculation.burnInfo,
    destinationTag: calculation.destinationTag
  };
}

/**
 * Get all available fee structures for documentation
 * @returns {Object} - Complete fee structure documentation
 */
export function getFeeStructureDocumentation() {
  return {
    success: true,
    feeStructures: FEE_STRUCTURES,
    description: 'Complete WALDOCOIN fee structure documentation',
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Validate fee calculation parameters
 * @param {string} category - Fee category
 * @param {string} action - Fee action
 * @param {Object} params - Parameters to validate
 * @returns {Object} - Validation result
 */
export function validateFeeParams(category, action, params) {
  const feeStructure = FEE_STRUCTURES[category]?.[action];
  
  if (!feeStructure) {
    return {
      valid: false,
      error: `Unknown fee structure: ${category}.${action}`
    };
  }

  const errors = [];

  // Check required amount for percentage fees
  if (feeStructure.percentage && !params.amount) {
    errors.push('Amount is required for percentage-based fees');
  }

  // Validate amount is positive
  if (params.amount && params.amount <= 0) {
    errors.push('Amount must be positive');
  }

  // Validate tier for claim fees
  if (category === 'CLAIM' && params.tier && !['STANDARD', 'PREMIUM', 'VIP'].includes(params.tier)) {
    errors.push('Invalid tier. Must be STANDARD, PREMIUM, or VIP');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Get real-time fee estimate for quick display
 * @param {string} category - Fee category
 * @param {string} action - Fee action
 * @param {Object} params - Calculation parameters
 * @returns {Object} - Quick fee estimate
 */
export async function getQuickFeeEstimate(category, action, params = {}) {
  try {
    const validation = validateFeeParams(category, action, params);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join(', ')
      };
    }

    const result = await calculateFees(category, action, params);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      estimate: {
        total: result.calculation.total,
        currency: 'WLO',
        xrpEquivalent: result.calculation.xrpEquivalent,
        usdEquivalent: result.calculation.usdEquivalent,
        description: result.calculation.description
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
