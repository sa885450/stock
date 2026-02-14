// lib/optimizer.js
const YahooFinance = require('yahoo-finance2').default;
const { RSI } = require('technicalindicators');

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

async function runOptimization(symbol) {
  let targetSymbol = symbol.toUpperCase();
  if (targetSymbol.match(/^\d+$/) && targetSymbol.length >= 4) targetSymbol = `${targetSymbol}.TW`;

  try {
    // 1. 抓取過去 3 年的歷史資料 (大樣本回測)
    const result = await yahooFinance.chart(targetSymbol, { 
      period1: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000), 
      interval: '1d' 
    }, { validateResult: false });

    if (!result || !result.quotes || result.quotes.length < 100) return null;

    const quotes = result.quotes.filter(q => q.close !== null);
    const prices = quotes.map(q => q.close);
    const rsiArray = RSI.calculate({ period: 14, values: prices });
    const alignedRSI = [...new Array(14).fill(null), ...rsiArray];

    // 2. 定義我們要測試的參數範圍 (Grid Search)
    const rsiThresholds = [20, 25, 30, 35, 40]; // 測試不同的「超跌」定義
    const holdDaysList = [3, 5, 10, 15, 20];    // 測試抱幾天最容易賺錢

    let results = [];

    // 3. 雙重迴圈暴力測試所有組合
    for (const rsiLimit of rsiThresholds) {
      for (const holdDays of holdDaysList) {
        let signals = 0;
        let winCount = 0;
        let totalProfit = 0;

        for (let i = 14; i < quotes.length - holdDays; i++) {
          // 進場條件：今天 RSI 跌破測試門檻，且昨天還在門檻之上
          if (alignedRSI[i] < rsiLimit && alignedRSI[i - 1] >= rsiLimit) {
            signals++;
            const buyPrice = prices[i];
            const sellPrice = prices[i + holdDays];
            const profitPercent = ((sellPrice - buyPrice) / buyPrice) * 100;

            if (profitPercent > 0) winCount++;
            totalProfit += profitPercent;
          }
        }

        if (signals > 5) { // 樣本數太少 (低於 5 次) 的不具參考價值，直接捨棄
          results.push({
            rsiLimit,
            holdDays,
            signals,
            winRate: ((winCount / signals) * 100).toFixed(1),
            avgProfit: (totalProfit / signals).toFixed(2)
          });
        }
      }
    }

    // 4. 依照「平均報酬率」進行排序，由高到低
    results.sort((a, b) => parseFloat(b.avgProfit) - parseFloat(a.avgProfit));

    return {
      symbol: targetSymbol,
      dataPoints: quotes.length, // 總交易天數
      topStrategies: results.slice(0, 3) // 只回傳最強的前 3 名
    };

  } catch (e) {
    console.error(`最佳化運算失敗: ${e.message}`);
    return null;
  }
}

module.exports = { runOptimization };