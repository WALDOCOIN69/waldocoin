# Trading Bot Testing Checklist

## Pre-Deployment Verification ✅

### Code Quality
- [x] No syntax errors in bot.js
- [x] All wallet parameters properly passed to functions
- [x] Bot 2 settings applied in all trade functions
- [x] Balance checking implemented for both BUY and SELL
- [x] Trade recording tracks both bots correctly
- [x] Error handling in place for all trade paths

### Logic Verification
- [x] BUY trades: Check XRP balance → Calculate WLO amount → Execute
- [x] SELL trades: Check WLO balance → Create offer → Record trade
- [x] buy_sell mode: Balances trades correctly (SELL when buyCount > sellCount)
- [x] Bot 2 uses own trading mode from Redis
- [x] Bot 2 uses own min/max trade sizes from Redis
- [x] Both bots use correct wallet for signing

## Post-Deployment Testing

### Immediate Checks (First 5 minutes)
- [ ] Bot starts without errors
- [ ] Logs show: "✅ Bot 1 (Primary): rNGY9xXoGmSukMizW19qAHdHjz7SAAuyVR"
- [ ] Logs show: "✅ Bot 2 (Secondary): rNNUUC8v8jgvpnqGKfywhCWKqbu5o2SQrn"
- [ ] No connection errors in logs
- [ ] Redis connection successful

### Trade Execution Tests (First 30 minutes)
- [ ] Logs show: "🤖 BOT 1 (Primary): Executing trade..."
- [ ] Logs show: "🤖 BOT 2 (Secondary): Executing trade..."
- [ ] Both BUY and SELL trades appear in logs
- [ ] No "Insufficient balance" errors
- [ ] No wallet signing errors
- [ ] No LastLedgerSequence errors

### Admin Panel Verification
- [ ] Bot 1 metrics display correctly
- [ ] Bot 2 metrics display correctly
- [ ] Bot 1 trade count increasing
- [ ] Bot 2 trade count increasing
- [ ] Balances showing positive values
- [ ] Both bots show in side-by-side layout

### Trade Type Verification
- [ ] Bot 1 executing BUY trades (logs show "🔄 Executing REAL BUY")
- [ ] Bot 1 executing SELL trades (logs show "🔄 Executing REAL SELL")
- [ ] Bot 2 executing BUY trades (logs show "🔄 Executing REAL BUY")
- [ ] Bot 2 executing SELL trades (logs show "🔄 Executing REAL SELL")

### Settings Application
- [ ] Bot 1 respects trading mode setting
- [ ] Bot 2 respects trading mode setting
- [ ] Bot 1 respects min/max trade size
- [ ] Bot 2 respects min/max trade size
- [ ] Pause/Resume controls work for both bots
- [ ] Enable/Disable controls work for Bot 2

## Troubleshooting Guide

### If Bot 2 shows 0 trades:
1. Check logs for "BOT 2 (Secondary): Executing trade..."
2. Verify Bot 2 is enabled in admin panel
3. Verify Bot 2 is not paused
4. Check Bot 2 has sufficient balance
5. Check for wallet signing errors in logs

### If only BUY trades execute:
1. Check trading mode is set to "buy_sell" or "automated"
2. Verify buy_sell logic: should SELL when buyCount > sellCount
3. Check WLO balance is sufficient for SELL
4. Look for "Insufficient WLO balance" warnings

### If only SELL trades execute:
1. Check trading mode setting
2. Verify XRP balance is sufficient for BUY
3. Look for "Insufficient XRP balance" warnings
4. Check price is valid (not zero or NaN)

## Success Criteria
✅ Both bots executing trades
✅ Both BUY and SELL trades happening
✅ Trade counts increasing for both bots
✅ Balances updating correctly
✅ No errors in logs
✅ Admin panel showing accurate metrics

