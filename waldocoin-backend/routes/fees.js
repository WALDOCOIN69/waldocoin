import express from 'express';
import { 
  calculateFees, 
  getFeeBreakdownForUI, 
  getFeeStructureDocumentation,
  getQuickFeeEstimate,
  validateFeeParams
} from '../utils/feeCalculator.js';

const router = express.Router();

console.log("💰 Loaded: routes/fees.js");

// GET /api/fees/calculate - Calculate fees for specific action
router.get('/calculate', async (req, res) => {
  try {
    const { category, action, amount, tier, hasStaking } = req.query;

    if (!category || !action) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: category, action"
      });
    }

    const params = {
      amount: amount ? parseInt(amount) : undefined,
      tier: tier || undefined,
      hasStaking: hasStaking === 'true'
    };

    const result = await calculateFees(category.toUpperCase(), action.toUpperCase(), params);

    return res.json(result);
  } catch (error) {
    console.error('❌ Fee calculation error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to calculate fees"
    });
  }
});

// GET /api/fees/breakdown - Get formatted fee breakdown for UI
router.get('/breakdown', async (req, res) => {
  try {
    const { category, action, amount, tier, hasStaking } = req.query;

    if (!category || !action) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: category, action"
      });
    }

    const params = {
      amount: amount ? parseInt(amount) : undefined,
      tier: tier || undefined,
      hasStaking: hasStaking === 'true'
    };

    const result = await getFeeBreakdownForUI(category.toUpperCase(), action.toUpperCase(), params);

    return res.json(result);
  } catch (error) {
    console.error('❌ Fee breakdown error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get fee breakdown"
    });
  }
});

// GET /api/fees/estimate - Get quick fee estimate
router.get('/estimate', async (req, res) => {
  try {
    const { category, action, amount, tier, hasStaking } = req.query;

    if (!category || !action) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: category, action"
      });
    }

    const params = {
      amount: amount ? parseInt(amount) : undefined,
      tier: tier || undefined,
      hasStaking: hasStaking === 'true'
    };

    const result = await getQuickFeeEstimate(category.toUpperCase(), action.toUpperCase(), params);

    return res.json(result);
  } catch (error) {
    console.error('❌ Fee estimate error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get fee estimate"
    });
  }
});

// GET /api/fees/structure - Get complete fee structure documentation
router.get('/structure', async (req, res) => {
  try {
    const result = getFeeStructureDocumentation();
    return res.json(result);
  } catch (error) {
    console.error('❌ Fee structure error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get fee structure"
    });
  }
});

// POST /api/fees/validate - Validate fee calculation parameters
router.post('/validate', async (req, res) => {
  try {
    const { category, action, params } = req.body;

    if (!category || !action) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: category, action"
      });
    }

    const validation = validateFeeParams(category.toUpperCase(), action.toUpperCase(), params || {});

    return res.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('❌ Fee validation error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to validate fee parameters"
    });
  }
});

// GET /api/fees/battle - Get all battle-related fees
router.get('/battle', async (req, res) => {
  try {
    const { wallet } = req.query;
    
    const [startFee, acceptFee, voteFee] = await Promise.all([
      getQuickFeeEstimate('BATTLE', 'START'),
      getQuickFeeEstimate('BATTLE', 'ACCEPT'),
      getQuickFeeEstimate('BATTLE', 'VOTE')
    ]);

    return res.json({
      success: true,
      battleFees: {
        start: startFee.success ? startFee.estimate : { error: startFee.error },
        accept: acceptFee.success ? acceptFee.estimate : { error: acceptFee.error },
        vote: voteFee.success ? voteFee.estimate : { error: voteFee.error }
      },
      wallet: wallet || null
    });
  } catch (error) {
    console.error('❌ Battle fees error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get battle fees"
    });
  }
});

// GET /api/fees/claim - Get claim fees with tier calculations
router.get('/claim', async (req, res) => {
  try {
    const { wallet, tier, hasStaking } = req.query;
    
    const params = {
      tier: tier || 'STANDARD',
      hasStaking: hasStaking === 'true'
    };

    const feeBreakdown = await getFeeBreakdownForUI('CLAIM', 'STANDARD', params);

    return res.json({
      success: true,
      claimFee: feeBreakdown.success ? feeBreakdown : { error: feeBreakdown.error },
      wallet: wallet || null,
      appliedTier: params.tier,
      stakingDiscount: params.hasStaking
    });
  } catch (error) {
    console.error('❌ Claim fees error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get claim fees"
    });
  }
});

// GET /api/fees/exchange - Get exchange fees
router.get('/exchange', async (req, res) => {
  try {
    const { amount, action } = req.query;
    
    if (!amount || !action) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: amount, action (buy/sell)"
      });
    }

    const params = { amount: parseInt(amount) };
    const feeBreakdown = await getFeeBreakdownForUI('EXCHANGE', action.toUpperCase(), params);

    return res.json({
      success: true,
      exchangeFee: feeBreakdown.success ? feeBreakdown : { error: feeBreakdown.error },
      amount: parseInt(amount),
      action: action.toUpperCase()
    });
  } catch (error) {
    console.error('❌ Exchange fees error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get exchange fees"
    });
  }
});

// GET /api/fees/staking - Get staking-related fees
router.get('/staking', async (req, res) => {
  try {
    const { amount, action } = req.query;
    
    const params = amount ? { amount: parseInt(amount) } : {};
    const actionType = action ? action.toUpperCase() : 'STAKE';
    
    const feeBreakdown = await getFeeBreakdownForUI('STAKING', actionType, params);

    return res.json({
      success: true,
      stakingFee: feeBreakdown.success ? feeBreakdown : { error: feeBreakdown.error },
      amount: amount ? parseInt(amount) : null,
      action: actionType
    });
  } catch (error) {
    console.error('❌ Staking fees error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking fees"
    });
  }
});

export default router;
