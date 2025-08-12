// 📝 PERSONAL MESSAGE GENERATOR FOR STEALTH TRADING

import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Generate natural-looking personal trading messages
export async function generatePersonalMessage() {
  try {
    const volume = await redis.get('waldo:daily_volume') || '0';
    const tradesCount = await redis.lLen('waldo:trades');
    const currentPrice = 0.00006400; // You can update this
    
    const messageTypes = [
      'trade_buy',
      'trade_sell', 
      'price_observation',
      'volume_comment',
      'market_analysis'
    ];
    
    const messageType = messageTypes[Math.floor(Math.random() * messageTypes.length)];
    
    switch (messageType) {
      case 'trade_buy':
        return generateBuyMessage(currentPrice);
      case 'trade_sell':
        return generateSellMessage(currentPrice);
      case 'price_observation':
        return generatePriceObservation(currentPrice);
      case 'volume_comment':
        return generateVolumeComment(volume);
      case 'market_analysis':
        return generateMarketAnalysis(currentPrice, volume, tradesCount);
      default:
        return generateBuyMessage(currentPrice);
    }
  } catch (error) {
    console.error('Error generating message:', error);
    return "WALDO looking good today 🚀";
  }
}

function generateBuyMessage(price) {
  const amount = Math.floor(1 + Math.random() * 20); // 1-20 XRP
  const waldoAmount = Math.floor((amount / price) * 0.975); // With spread
  
  const messages = [
    `Just grabbed ${waldoAmount.toLocaleString()} more WALDO for ${amount} XRP 💰`,
    `Added to my WALDO bag - ${amount} XRP worth at ${price.toFixed(8)} 🎯`,
    `Couldn't resist, bought more WALDO - ${waldoAmount.toLocaleString()} tokens secured 🚀`,
    `Loading up on WLO again, ${amount} XRP in at current levels 📈`,
    `Another ${amount} XRP into WALDO, this price won't last 💪`,
    `Picked up ${waldoAmount.toLocaleString()} WALDO tokens, feeling bullish 🔥`,
    `DCA'ing into WALDO - ${amount} XRP more today 📊`,
    `Can't stop buying WALDO at these levels - ${waldoAmount.toLocaleString()} added 🎯`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

function generateSellMessage(price) {
  const waldoAmount = Math.floor(50000 + Math.random() * 150000);
  const xrpAmount = (waldoAmount * price * 0.975).toFixed(2);
  
  const messages = [
    `Took some profits - sold ${waldoAmount.toLocaleString()} WALDO for ${xrpAmount} XRP 💸`,
    `Trimmed my WALDO position, ${xrpAmount} XRP secured 📊`,
    `Sold ${waldoAmount.toLocaleString()} WLO at ${price.toFixed(8)} - good exit 🎯`,
    `Taking profits on WALDO - ${xrpAmount} XRP out, keeping the rest 💰`,
    `Reduced WALDO holdings by ${waldoAmount.toLocaleString()}, still holding strong 📉`,
    `Partial sell on WALDO - ${xrpAmount} XRP profit locked in 🔒`,
    `Sold some WLO to rebalance portfolio - ${waldoAmount.toLocaleString()} tokens 📈`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

function generatePriceObservation(price) {
  const change = (Math.random() - 0.5) * 8; // -4% to +4%
  const emoji = change >= 0 ? '📈' : '📉';
  
  const messages = [
    `WALDO holding steady around ${price.toFixed(8)} XRP ${emoji}`,
    `Nice price action on WLO today ${emoji} ${price.toFixed(8)} XRP`,
    `WALDO looking strong at current levels 💪`,
    `Good support on WALDO at ${price.toFixed(8)} XRP 🎯`,
    `WLO price discovery happening, liking what I see ${emoji}`,
    `WALDO chart looking clean at ${price.toFixed(8)} 📊`,
    `Solid price action on WALDO, no major dumps 🔥`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

function generateVolumeComment(volume) {
  const vol = parseFloat(volume);
  
  const messages = [
    `Nice volume on WALDO today - ${vol.toFixed(0)} XRP traded 📊`,
    `WALDO getting some good volume, ${vol.toFixed(0)} XRP so far 💪`,
    `Trading activity picking up on WLO - ${vol.toFixed(0)} XRP volume 🚀`,
    `Healthy volume on WALDO, people are noticing 👀`,
    `Good liquidity building on WLO - ${vol.toFixed(0)} XRP traded 🎯`,
    `WALDO volume looking solid today 📈`,
    `More people discovering WALDO - volume increasing 🔥`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

function generateMarketAnalysis(price, volume, trades) {
  const messages = [
    `WALDO fundamentals looking strong - price stable, volume growing 💪`,
    `WLO market depth improving, good signs for price stability 📊`,
    `WALDO ecosystem growing - more traders joining daily 🚀`,
    `Bullish on WALDO long term, accumulating on dips 🎯`,
    `WALDO tokenomics are solid, deflationary supply working 🔥`,
    `WLO community growing, organic demand increasing 📈`,
    `WALDO utility expanding, price should follow eventually 💰`,
    `Good entry levels on WALDO for long-term holders 🔒`
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

// Generate and log a message (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  const message = await generatePersonalMessage();
  console.log('\n📝 Personal message ready to post:');
  console.log(`"${message}"`);
  console.log('\nCopy and paste this into your Telegram channel! 🚀\n');
  process.exit(0);
}
