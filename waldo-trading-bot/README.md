# 🤖 WALDOCOIN AUTOMATED TRADING BOT

A fully automated Telegram bot that creates trading activity for WLO tokens on XRPL. Generates constant buy/sell activity, announcements, and market data to create traffic and stabilize WALDO price - **NO USER INTERACTION REQUIRED**.

## 🎯 Features

### ✅ **Automated Trading:**
- **Automated buy/sell orders** every 2-5 minutes
- **Realistic trade volumes** (1-25 XRP per trade)
- **Dynamic pricing** based on market conditions
- **No user interaction** required
- **24/7 operation** with error handling

### ✅ **Automated Announcements:**
- **Trade alerts** posted immediately after each automated trade
- **Price updates** every 30 minutes with market data
- **Volume milestones** announced hourly (50, 100, 500+ XRP)
- **Market statistics** and trading summaries

### ✅ **Traffic Generation:**
- **Constant activity** - never looks dead or inactive
- **Professional appearance** with regular market updates
- **Community engagement** through public channel
- **Volume tracking** shows healthy trading ecosystem

## 🚀 Quick Setup

### **1. Create Telegram Bot**
1. Message `@BotFather` on Telegram
2. Create new bot: `/newbot`
3. Get your bot token
4. Create a public channel for trade announcements

### **2. Configure Environment**
```bash
cp .env.example .env
# Edit .env with your settings
```

### **3. Install & Run**
```bash
npm install
npm start
```

## ⚙️ Configuration

### **Required Environment Variables:**
```env
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TRADING_WALLET_SECRET=your-trading-wallet-secret
WALDO_ISSUER=rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY
```

### **Optional Settings:**
```env
TELEGRAM_CHANNEL_ID=@waldocoin_trades
MIN_TRADE_AMOUNT_XRP=1
MAX_TRADE_AMOUNT_XRP=100
PRICE_SPREAD_PERCENTAGE=2.5
MARKET_MAKING_ENABLED=true
```

## 🎮 Bot Commands

### **Setup:**
- `/start` - Welcome message and instructions
- `/wallet [address]` - Connect your XRPL wallet
- `/help` - Show all commands

### **Trading:**
- `/buy [XRP amount]` - Buy WLO tokens
- `/sell [WLO amount]` - Sell WLO tokens
- `/price` - Current WLO price and spread
- `/balance` - Your wallet balance

### **Information:**
- `/stats` - Trading statistics and volume
- `/help` - Command reference

## 💡 Usage Examples

```
/wallet rYourXRPLWalletAddress123...
/buy 10          (buy WLO with 10 XRP)
/sell 50000      (sell 50,000 WLO)
/price           (check current price)
/balance         (check your balances)
```

## 🔧 Trading Logic

### **Price Calculation:**
- Analyzes recent WALDO trades on XRPL
- Calculates average price from transaction history
- Applies configurable spread (default 2.5%)

### **Buy Orders:**
- User sends XRP amount (1-100 XRP)
- Bot calculates WLO amount at current price + spread
- Executes XRPL payment transaction
- Announces trade in public channel

### **Sell Orders:**
- User specifies WLO amount to sell
- Bot calculates XRP payout at current price - spread
- Executes XRPL payment transaction
- Updates volume and statistics

## 📊 Market Making (Optional)

### **Automated Trading:**
- Monitors trading volume every 30 seconds
- Creates buy/sell activity during low volume periods
- Helps maintain price stability
- Configurable parameters and safety limits

### **Safety Features:**
- Daily volume limits
- Maximum position size limits
- Emergency stop functionality
- Transaction logging and monitoring

## 🚀 Deployment

### **Local Development:**
```bash
npm run dev
```

### **Production (Render.com):**
1. Connect GitHub repository
2. Set environment variables
3. Deploy as background worker
4. Monitor logs for activity

### **Docker:**
```bash
docker build -t waldo-trading-bot .
docker run -d --env-file .env waldo-trading-bot
```

## 📈 Benefits

### **For WALDO Token:**
- ✅ **Increased trading volume** and activity
- ✅ **Price stability** through market making
- ✅ **Easy access** for users to trade
- ✅ **Public visibility** of trades

### **For Users:**
- ✅ **Simple trading** through Telegram
- ✅ **No complex DEX interfaces**
- ✅ **Real-time price information**
- ✅ **Transparent trade execution**

## ⚠️ Important Notes

### **Trading Wallet:**
- Bot needs a funded XRPL wallet with WLO tokens
- Wallet should have sufficient XRP for transaction fees
- Keep private keys secure and use environment variables

### **Spread & Fees:**
- Default 2.5% spread covers operational costs
- XRPL transaction fees (~0.00001 XRP per transaction)
- Adjust spread based on market conditions

### **Security:**
- Never share private keys or bot tokens
- Use Redis for secure data storage
- Monitor bot activity and set limits
- Implement emergency stop procedures

## 🔍 Monitoring

### **Logs:**
- All trades logged with timestamps
- Error handling and recovery
- Performance metrics tracking

### **Statistics:**
- Daily trading volume
- Number of active users
- Price movement tracking
- Market making effectiveness

## 📞 Support

- Check logs for error messages
- Verify XRPL connectivity
- Ensure wallet has sufficient funds
- Test with small amounts first

## 🎯 Next Steps

1. **Deploy the bot** to production
2. **Fund the trading wallet** with WLO and XRP
3. **Announce to community** and share bot link
4. **Monitor activity** and adjust parameters
5. **Scale up** based on usage and feedback
