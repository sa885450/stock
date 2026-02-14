require('dotenv').config();
const YahooFinance = require('yahoo-finance2').default;
const { SMA, RSI } = require('technicalindicators'); // 引入指標套件

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

async function getStockAnalysis(symbol) {
  try {
    // 1. 抓取足夠天數的資料 (為了算 MA20 與 RSI14，抓 60 天最保險)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 60);

    const result = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    const quotes = result.quotes.filter(q => q.close !== null); // 過濾掉無效資料
    const closePrices = quotes.map(q => q.close);
    const latest = quotes[quotes.length - 1];
    const prev = quotes[quotes.length - 2];

    // 2. 計算技術指標
    // SMA: 移動平均線，公式為 $\text{SMA} = \frac{\sum_{i=1}^{n} P_i}{n}$
    const ma5 = SMA.calculate({ period: 5, values: closePrices });
    const ma20 = SMA.calculate({ period: 20, values: closePrices });
    const rsi = RSI.calculate({ period: 14, values: closePrices });

    // 取得最新數值
    const curMA5 = ma5[ma5.length - 1];
    const curMA20 = ma20[ma20.length - 1];
    const curRSI = rsi[rsi.length - 1];

    // 3. 多空局勢判斷
    let trendSignal = "盤整中 ⚖️";
    let rsiSignal = "";

    // 黃金交叉 / 死魚交叉判斷
    if (curMA5 > curMA20 && latest.close > curMA5) {
      trendSignal = "短線多頭趨勢 🔥";
    } else if (curMA5 < curMA20 && latest.close < curMA5) {
      trendSignal = "短線空頭趨勢 ❄️";
    }

    // RSI 過熱判斷
    if (curRSI > 70) rsiSignal = "⚠️ 市場過熱 (RSI > 70)";
    else if (curRSI < 30) rsiSignal = "🛡️ 跌深反彈機會 (RSI < 30)";
    else rsiSignal = "市場情緒穩定";

    // 4. 格式化 Discord 訊息
    const priceChange = latest.close - prev.close;
    const percentChange = (priceChange / prev.close) * 100;

    return `
**📊 【${symbol}】趨勢分析報告**
---
**💰 當前價位**: $${latest.close.toFixed(2)} (${priceChange >= 0 ? '🔺' : '🔻'} ${percentChange.toFixed(2)}%)
**📈 技術指標**:
• MA5: $${curMA5.toFixed(2)}
• MA20: $${curMA20.toFixed(2)}
• RSI(14): ${curRSI.toFixed(2)}

**🔍 局勢研判**: 
> **${trendSignal}**
> *${rsiSignal}*
---
    `.trim();

  } catch (error) {
    console.error(`分析 ${symbol} 失敗:`, error.message);
    return `⚠️ 分析 ${symbol} 失敗。`;
  }
}

// 發送到 Discord (與之前相同)
async function sendToDiscord(content) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    console.log('✅ 分析報告已送達 Discord');
  } catch (e) { console.error('Discord Error'); }
}

// 執行
(async () => {
  const report = await getStockAnalysis('2330.TW');
  await sendToDiscord(report);
})();