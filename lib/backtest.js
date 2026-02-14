// lib/backtest.js
const YahooFinance = require('yahoo-finance2').default;
const { RSI } = require('technicalindicators');

async function runBacktest(symbol) {
  let targetSymbol = symbol.toUpperCase();
  if (targetSymbol.match(/^\d+$/) && targetSymbol.length >= 4) targetSymbol = `${targetSymbol}.TW`;

  try {
    const result = await YahooFinance.chart(targetSymbol, { 
      period1: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), 
      interval: '1d' 
    }, { validateResult: false });

    if (!result || !result.quotes || result.quotes.length < 50) return { signals: 0, winRate: 0 };

    const quotes = result.quotes.filter(q => q.close !== null);
    const prices = quotes.map(q => q.close);
    const rsiArray = RSI.calculate({ period: 14, values: prices });
    const priceOffset = prices.slice(14); 

    let signals = 0, wins = 0;
    for (let i = 0; i < rsiArray.length - 10; i++) {
      if (rsiArray[i] < 40) {
        signals++;
        if (priceOffset[i + 10] > priceOffset[i]) wins++;
      }
    }
    return { signals, winRate: signals > 0 ? ((wins / signals) * 100).toFixed(1) : 0 };
  } catch (e) { return { signals: 0, winRate: 0 }; }
}

module.exports = { runBacktest };