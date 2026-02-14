// lib/monitor.js
const { StockData, MarketData, GlobalMarketData, RelationData, SentimentData, EventData, ChipData, MarginData, FundamentalData, RevenueData, AnalysisSnapshot, IntradaySnapshot, BacktestResult, DataAuditLog } = require('./database');
const { RSI, MACD, SMA } = require('technicalindicators');

function calculateVolatility(prices) {
  if (prices.length < 20) return 0;
  const returns = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function calculateBeta(stockQuotes, marketMap) {
  const len = stockQuotes.length;
  if (len < 20) return 1;
  const stockRet = (stockQuotes[len-1].close - stockQuotes[len-20].close) / stockQuotes[len-20].close;
  const marketRet = marketMap.perf20 || 0.01;
  return stockRet / marketRet;
}

// ✨ [v8.3] 擴充宏觀數據：讀取原油、黃金、銅
async function getMacroContext() {
  const context = { sox: 0, adr: 0, twd: 0, tnx: 0, oil: 0, gold: 0, copper: 0 };
  try {
    const getData = async (sym) => (await GlobalMarketData.findOne({ symbol: sym }).sort({ date: -1 }).lean())?.changePercent || 0;
    context.sox = await getData('^SOX');
    context.adr = await getData('TSM');
    context.twd = await getData('TWD=X');
    context.tnx = await getData('^TNX');
    context.oil = await getData('CL=F'); // 原油
    context.gold = await getData('GC=F'); // 黃金
    context.copper = await getData('HG=F'); // 銅
  } catch (e) { }
  return context;
}

// 🧠 評分引擎 v8.3
function calculateScore(indicators, macro, relations, sentiment) {
  let score = 0;
  let reasons = [];
  let macroView = "";

  if (indicators.dataError) return { total: 0, tags: ["⛔數據異常"], macroView: "暫停交易" };

  // 1. 宏觀 & 產業連動 (Commodity Linkage)
  if (indicators.sector && indicators.sector.includes('Technology')) {
    if (macro.sox > 1) { score += 10; reasons.push("🌎費半助攻"); macroView = "費半連動+"; }
    else if (macro.sox < -1) { score -= 5; macroView = "費半逆風"; }
  }
  
  // ✨ 原物料連動邏輯
  if (indicators.industry) {
    // 塑化/航運 vs 油價 (簡單邏輯：油漲利於塑化報價，不利於航運成本，但航運有時因運價上漲而漲，這裡假設油價上漲代表需求回溫對塑化有利)
    if (indicators.industry.includes('Chemical') || indicators.sector.includes('Basic Materials')) {
        if (macro.oil > 1.5) { score += 5; reasons.push("🛢️油價連動"); }
    }
    // 電線電纜 vs 銅價
    if (indicators.industry.includes('Electrical') || indicators.symbol === '1605.TW') {
        if (macro.copper > 1.0) { score += 10; reasons.push("🥉銅價受惠"); }
    }
  }

  if (indicators.symbol === '2330.TW' && macro.adr > 2) { score += 10; reasons.push("🇺🇸ADR大漲"); }
  
  // 2. 情緒指標 (Sentiment Analysis)
  if (sentiment) {
    if (sentiment.score > 80) { score -= 5; reasons.push("🔥情緒過熱"); } // 逆勢思考：過熱時減分
    else if (sentiment.score < 20) { score += 5; reasons.push("🧊情緒冰點"); } // 恐慌時加分
    
    if (sentiment.analystBuy > 5) { score += 5; reasons.push("👍法人喊買"); }
  }

  // 3. 關聯網 (滯後補漲)
  if (relations.customerPerf > 0) { score += 5; reasons.push(`🔗客戶強勢`); }
  if (relations.lagEffect) {
    const { leaderSymbol, lagDays, leaderReturn } = relations.lagEffect;
    if (leaderReturn > 1.5) {
      score += 20; 
      reasons.push(`⏱️落後${leaderSymbol}`); 
      macroView = `補漲效應(${lagDays}日)`;
    }
  }
  
  // 4. 技術
  if (indicators.price > indicators.ma20 && indicators.ma5 > indicators.ma20) { score += 10; reasons.push("📈多頭"); }
  if (indicators.macdStatus === "多頭交叉") { score += 10; reasons.push("⚡金叉"); }
  
  // 5. 風險
  if (indicators.volatility > 60 && indicators.rsValue < 0) { score -= 10; reasons.push("⚠️高波動風險"); }
  else if (indicators.volatility < 20) { score += 5; reasons.push("🛡️低波動"); }
  
  // 6. 籌碼
  if (indicators.trustBuyDays >= 3) { score += 15; reasons.push("🔥投信連買"); }
  
  // 7. 財務
  if (indicators.freeCashFlow > 0) { score += 5; } 
  if (indicators.debtToEquity > 150) { score -= 10; reasons.push("💸高負債"); }
  if (indicators.revenueYoY > 20) { score += 10; reasons.push("🚀營收爆發"); }

  return { total: score, tags: reasons.slice(0, 4), macroView };
}

async function analyzeStock(symbol, marketMap, macroContext) {
  let targetSymbol = symbol.toUpperCase();
  if (targetSymbol.match(/^\d+$/)) targetSymbol = `${targetSymbol}.TW`;

  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const auditError = await DataAuditLog.findOne({ date: todayStr, symbol: targetSymbol, status: 'ERROR' }).lean();

    let quotes = await StockData.find({ symbol: targetSymbol }).sort({ date: 1 }).limit(120).lean();
    if (!quotes || quotes.length < 60) return null;

    const fundamental = await FundamentalData.findOne({ symbol: targetSymbol }).sort({ date: -1 }).lean() || {};
    const chips = await ChipData.find({ symbol: targetSymbol }).sort({ date: -1 }).limit(5).lean() || [];
    const revenue = await RevenueData.findOne({ symbol: targetSymbol }).sort({ date: -1 }).lean() || {};
    const event = await EventData.findOne({ symbol: targetSymbol, date: { $gte: todayStr }, type: 'Dividend' }).lean();
    const sentiment = await SentimentData.findOne({ symbol: targetSymbol }).sort({ date: -1 }).lean(); // ✨ 讀取情緒
    
    const intraday = await IntradaySnapshot.findOne({ symbol: targetSymbol }).lean();
    const currentPrice = intraday ? intraday.price : quotes[quotes.length - 1].close;

    const relatedLinks = await RelationData.find({ symbol: targetSymbol }).lean(); 
    const myLeaders = await RelationData.find({ relatedSymbol: targetSymbol }).lean(); 

    let customerPerf = 0;
    if (relatedLinks.length > 0 && marketMap.perf20 > 0.05) customerPerf = 1;

    let lagEffect = null;
    for (const link of myLeaders) {
      if (link.lagDays > 0) { 
        const leaderQuote = await StockData.findOne({ symbol: link.symbol }).sort({ date: -1 }).skip(link.lagDays - 1).limit(1).lean();
        if (leaderQuote) {
          const leaderRet = ((leaderQuote.close - leaderQuote.open) / leaderQuote.open) * 100;
          if (leaderRet > 1.5) {
             lagEffect = { leaderSymbol: link.symbol, lagDays: link.lagDays, leaderReturn: leaderRet };
             break; 
          }
        }
      }
    }

    const prices = quotes.map(q => q.adjClose || q.close);
    const ma5 = SMA.calculate({ period: 5, values: prices }).pop() || 0;
    const ma20 = SMA.calculate({ period: 20, values: prices }).pop() || 0;
    const rsiVal = RSI.calculate({ period: 14, values: prices }).pop() || 0;
    const macdArr = MACD.calculate({ values: prices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const curMACD = macdArr[macdArr.length - 1];
    const volatility = calculateVolatility(prices.slice(-20));
    const beta = calculateBeta(quotes, marketMap);
    const startPrice = quotes[quotes.length - 20]?.close || currentPrice;
    const stockPerf = (currentPrice - startPrice) / startPrice;
    const rsValue = (stockPerf - marketMap.perf20) * 100;

    const indicators = {
      symbol: targetSymbol,
      price: currentPrice,
      ma5, ma20,
      macdStatus: (curMACD && curMACD.MACD > curMACD.signal) ? "多頭交叉" : "空頭排列",
      rsValue, volatility, beta,
      trustBuyDays: chips.filter(c => c.investmentBuy > 0).length,
      institutionHeld: fundamental.institutionHeld || 0,
      revenueYoY: revenue.yoY || 0,
      sector: fundamental.sector || '',
      industry: fundamental.industry || '', // ✨ 需要產業別
      freeCashFlow: fundamental.freeCashFlow,
      debtToEquity: fundamental.debtToEquity,
      dataError: !!auditError 
    };

    const aiResult = calculateScore(indicators, macroContext, { customerPerf, lagEffect }, sentiment);

    if (indicators.dataError) return null;

    return {
      symbol: targetSymbol,
      score: aiResult.total,
      price: currentPrice,
      percent: intraday ? intraday.changePercent : stockPerf * 100,
      tags: aiResult.tags,
      sector: fundamental.sector || '其他', 
      rsValue: rsValue.toFixed(2),
      beta: beta.toFixed(2),
      volatility: volatility.toFixed(1),
      macroView: aiResult.macroView, 
      details: {
        rsi: rsiVal.toFixed(2),
        revYoY: (indicators.revenueYoY).toFixed(1) + '%',
        event: event ? event.date : ''
      }
    };
  } catch (err) { return null; }
}

async function runDailyBatchAnalysis(watchList) {
  console.log(`🧠 [AI] 啟動 v8.3 運算 (含滯後套利、情緒、原物料)...`);
  const macroContext = await getMacroContext();
  let marketMap = { perf20: 0 };
  const marketQuotes = await MarketData.find({ symbol: '^TWII' }).sort({ date: 1 }).limit(30).lean();
  if (marketQuotes.length > 20) {
    const last = marketQuotes[marketQuotes.length - 1];
    const start = marketQuotes[marketQuotes.length - 20];
    marketMap.perf20 = (last.close - start.close) / start.close;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  await AnalysisSnapshot.deleteMany({ date: todayStr });

  let bulkOps = [];
  let processed = 0;
  for (const symbol of watchList) {
    const result = await analyzeStock(symbol, marketMap, macroContext);
    if (result) {
      bulkOps.push({ insertOne: { document: { date: todayStr, ...result } } });
    }
    processed++;
    if (processed % 50 === 0) process.stdout.write(`\r計算進度: ${processed}/${watchList.length}`);
  }
  if (bulkOps.length > 0) await AnalysisSnapshot.bulkWrite(bulkOps);
  console.log(`\n🎉 運算完成。`);
}

async function runBacktestAudit() { /* 保持原樣，省略以節省篇幅 */ 
  console.log('⚖️ [審計] 執行自動回測...'); const periods=[5,20]; const today=new Date(); let hasData=false; for(const d of periods){ const t=new Date(today); t.setDate(t.getDate()-d); const ts=t.toISOString().split('T')[0]; const s=await AnalysisSnapshot.find({date:ts,score:{$gte:75}}).lean(); if(s.length===0)continue; hasData=true; let w=0,tr=0,det=[]; for(const snap of s){ const q=await StockData.findOne({symbol:snap.symbol}).sort({date:-1}).select('close').lean(); if(!q)continue; const p=(q.close-snap.price)/snap.price; if(p>0)w++; tr+=p; det.push({symbol:snap.symbol,profit:(p*100).toFixed(2)}); } if(det.length>0){ const ar=(tr/det.length)*100, wr=(w/det.length)*100; await BacktestResult.updateOne({date:today.toISOString().split('T')[0],lookbackDays:d},{$set:{targetDate:ts,winRate:wr.toFixed(2),avgReturn:ar.toFixed(2),topStocksCount:det.length}},{upsert:true}); console.log(`✅ [審計] ${d}日前預測勝率: ${wr.toFixed(1)}%`); } } if(!hasData)console.log('ℹ️ [審計] 目前無歷史快照可供回測。'); console.log('🏁 [系統] 全量作業執行完畢。');
}

module.exports = { runDailyBatchAnalysis, runBacktestAudit };