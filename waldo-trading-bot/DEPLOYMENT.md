# 🚀 WALDO TRADING BOT - DEPLOYMENT GUIDE

## 📋 Pre-Deployment Checklist

### **1. Create Telegram Bot**
- [ ] Message `@BotFather` on Telegram
- [ ] Run `/newbot` and follow instructions
- [ ] Save your bot token (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
- [ ] Create a public Telegram channel for trade announcements
- [ ] Add your bot as admin to the channel

### **2. Prepare Trading Wallet**
- [ ] Create new XRPL wallet for trading (don't use your main wallet)
- [ ] Fund wallet with XRP (minimum 100 XRP recommended)
- [ ] Add WALDO trustline to trading wallet
- [ ] Transfer WALDO tokens to trading wallet (minimum 100,000 WLO)
- [ ] Save wallet secret key securely

### **3. Set Up Redis**
- [ ] Sign up for Redis cloud service (Redis Labs, Upstash, etc.)
- [ ] Get Redis connection URL
- [ ] Test connection

## 🔧 Environment Configuration

Create `.env` file with these settings:

```env
# ===== TELEGRAM BOT =====
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHANNEL_ID=@waldocoin_trades
TELEGRAM_ADMIN_ID=your-telegram-user-id

# ===== XRPL CONFIGURATION =====
XRPL_NODE=wss://xrplcluster.com
TRADING_WALLET_SECRET=sYourTradingWalletSecret
TRADING_WALLET_ADDRESS=rYourTradingWalletAddress

# ===== WALDO TOKEN =====
WALDO_ISSUER=rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY
WALDO_CURRENCY=WLO

# ===== TRADING PARAMETERS =====
MIN_TRADE_AMOUNT_XRP=1
MAX_TRADE_AMOUNT_XRP=100
PRICE_SPREAD_PERCENTAGE=2.5
SLIPPAGE_TOLERANCE=1.0

# ===== MARKET MAKING =====
MARKET_MAKING_ENABLED=true
BASE_BUY_AMOUNT_XRP=10
BASE_SELL_AMOUNT_WLO=100000
PRICE_UPDATE_INTERVAL=30000

# ===== REDIS =====
REDIS_URL=redis://username:password@host:port

# ===== SAFETY LIMITS =====
MAX_DAILY_VOLUME_XRP=1000
MAX_POSITION_SIZE_WLO=1000000
EMERGENCY_STOP=false

# ===== ANNOUNCEMENTS =====
ANNOUNCE_TRADES=true
ANNOUNCE_PRICE_CHANGES=true
PRICE_CHANGE_THRESHOLD=5
```

## 🌐 Render.com Deployment

### **Step 1: Prepare Repository**
```bash
# Push your code to GitHub
git add .
git commit -m "Add WALDO Trading Bot"
git push origin main
```

### **Step 2: Create Render Service**
1. Go to **render.com** and sign in
2. Click **"New +"** → **"Background Worker"**
3. Connect your GitHub repository
4. Configure service:
   - **Name**: `waldo-trading-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### **Step 3: Set Environment Variables**
In Render dashboard, add all environment variables from your `.env` file:
- `TELEGRAM_BOT_TOKEN`
- `TRADING_WALLET_SECRET`
- `REDIS_URL`
- etc.

### **Step 4: Deploy**
- Click **"Create Background Worker"**
- Wait for deployment to complete
- Check logs for successful startup

## 🐳 Docker Deployment (Alternative)

### **Create Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p logs

EXPOSE 3000

CMD ["npm", "start"]
```

### **Build and Run:**
```bash
docker build -t waldo-trading-bot .
docker run -d --name waldo-bot --env-file .env waldo-trading-bot
```

## ✅ Post-Deployment Testing

### **1. Test Bot Commands**
```
/start          - Should show welcome message
/help           - Should show command list
/price          - Should show current WALDO price
/stats          - Should show trading statistics
```

### **2. Test Wallet Connection**
```
/wallet rYourTestWalletAddress
```
Should confirm wallet connection.

### **3. Test Small Trade**
```
/buy 1          - Buy WLO with 1 XRP
```
Should execute trade and announce in channel.

### **4. Monitor Logs**
Check Render logs for:
- ✅ XRPL connection successful
- ✅ Redis connection successful
- ✅ Price updates working
- ✅ Market making active (if enabled)

## 📊 Monitoring & Maintenance

### **Daily Checks:**
- [ ] Bot responding to commands
- [ ] Trading wallet has sufficient funds
- [ ] No error messages in logs
- [ ] Trade announcements working

### **Weekly Checks:**
- [ ] Review trading volume and statistics
- [ ] Adjust spread if needed
- [ ] Check market making effectiveness
- [ ] Update price calculation if needed

### **Monthly Checks:**
- [ ] Rotate trading wallet if needed
- [ ] Review and optimize parameters
- [ ] Update bot features based on usage
- [ ] Security audit of keys and access

## 🚨 Emergency Procedures

### **Stop Trading Immediately:**
Set environment variable:
```env
EMERGENCY_STOP=true
```
Redeploy service.

### **Wallet Compromise:**
1. **Stop the bot** immediately
2. **Transfer funds** to new wallet
3. **Update environment variables**
4. **Redeploy with new wallet**

### **Bot Malfunction:**
1. **Check logs** for error messages
2. **Restart service** in Render dashboard
3. **Verify XRPL and Redis connections**
4. **Test with small amounts**

## 🎯 Optimization Tips

### **Performance:**
- Monitor Redis memory usage
- Optimize price calculation frequency
- Use connection pooling for XRPL

### **Trading:**
- Adjust spread based on volatility
- Implement dynamic pricing
- Add more sophisticated market making

### **User Experience:**
- Add more detailed error messages
- Implement trade confirmations
- Add price alerts and notifications

## 📈 Scaling Up

### **Increased Volume:**
- Add multiple trading wallets
- Implement load balancing
- Use dedicated Redis instance

### **New Features:**
- Add limit orders
- Implement stop-loss orders
- Add technical analysis indicators
- Create web dashboard

## 🔐 Security Best Practices

### **Environment Variables:**
- Never commit secrets to Git
- Use strong, unique passwords
- Rotate keys regularly
- Monitor access logs

### **Wallet Security:**
- Use dedicated trading wallets
- Keep minimal funds in hot wallets
- Implement multi-signature if possible
- Regular security audits

## 📞 Troubleshooting

### **Common Issues:**

**Bot not responding:**
- Check Render service status
- Verify environment variables
- Check XRPL node connectivity

**Trades failing:**
- Verify wallet has sufficient funds
- Check XRPL network status
- Validate wallet addresses

**Price calculation errors:**
- Check XRPL API responses
- Verify transaction history access
- Update price calculation logic

**Redis connection issues:**
- Verify Redis URL format
- Check Redis service status
- Test connection manually

## 🎉 Launch Checklist

- [ ] Bot deployed and running
- [ ] All commands tested and working
- [ ] Trading wallet funded
- [ ] Channel announcements active
- [ ] Monitoring systems in place
- [ ] Emergency procedures documented
- [ ] Community announcement ready

**Your WALDO Trading Bot is ready to generate traffic and stabilize the token price!** 🚀
