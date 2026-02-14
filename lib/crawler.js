// lib/crawler.js
const YahooFinance = require('yahoo-finance2').default;
const axios = require('axios');
const { StockData, MarketData, GlobalMarketData, RelationData, SentimentData, EventData, ChipData, MarginData, FundamentalData, RevenueData, IntradaySnapshot } = require('./database');

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

async function withRetry(task, retries = 3, delay = 2000) {
  try { return await task(); } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(r => setTimeout(r, delay));
    return withRetry(task, retries - 1, delay);
  }
}

function getTwseDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchTwseDailyClose() {
  try {
    const res = await axios.get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { timeout: 15000 });
    const priceMap = new Map();
    res.data.forEach(item => {
      const price = parseFloat(item.ClosingPrice);
      if (!isNaN(price)) priceMap.set(`${item.Code}.TW`, price);
    });
    return priceMap;
  } catch (e) { return null; }
}

async function updateIntradayQuotes(watchList) {
  const chunkSize = 50;
  for (let i = 0; i < watchList.length; i += chunkSize) {
    const chunk = watchList.slice(i, i + chunkSize);
    try {
      const results = await yahooFinance.quote(chunk);
      if (results) {
        const bulkOps = results.map(q => ({
          updateOne: {
            filter: { symbol: q.symbol },
            update: { $set: { price: q.regularMarketPrice, changePercent: q.regularMarketChangePercent, volume: q.regularMarketVolume, lastUpdate: new Date() } },
            upsert: true
          }
        }));
        await IntradaySnapshot.bulkWrite(bulkOps);
      }
    } catch (e) { }
  }
}

async function updateFundamentals(symbol) {
  let t = symbol.match(/^\d+$/) ? `${symbol}.TW` : symbol;
  try {
    const r = await withRetry(() => yahooFinance.quoteSummary(t, { modules: ['summaryDetail', 'defaultKeyStatistics', 'summaryProfile', 'majorHoldersBreakdown', 'financialData'] }), 2, 1000);
    if (r) {
      const s = r.summaryDetail || {}, p = r.summaryProfile || {}, h = r.majorHoldersBreakdown || {}, f = r.financialData || {};
      const d = new Date();
      await FundamentalData.updateOne({ symbol: t, date: { $gte: new Date(d.setHours(0,0,0,0)), $lt: new Date(d.setHours(23,59,59,999)) } }, { $set: { peRatio: s.trailingPE || 0, sector: p.sector || '', institutionHeld: h.institutionsPercentHeld || 0, freeCashFlow: f.freeCashFlow || 0, debtToEquity: f.debtToEquity || 0 } }, { upsert: true });
    } 
  } catch (e) {} 
}

// ✨ [v8.3 新增] 更新情緒指標 (利用分析師評級)
async function updateSentiment(symbol) {
  let t = symbol.match(/^\d+$/) ? `${symbol}.TW` : symbol;
  try {
    // 取得推薦趨勢 (Analyst Recommendation)
    const r = await withRetry(() => yahooFinance.quoteSummary(t, { modules: ['recommendationTrend'] }), 1, 1000);
    if (r && r.recommendationTrend && r.recommendationTrend.trend && r.recommendationTrend.trend.length > 0) {
      const latest = r.recommendationTrend.trend[0]; // 取得最新一期
      const buys = (latest.strongBuy || 0) + (latest.buy || 0);
      const sells = (latest.sell || 0) + (latest.strongSell || 0);
      const total = buys + sells + (latest.hold || 0);
      
      // 計算情緒分數 (0-100)
      let score = 50; 
      if (total > 0) {
        // 簡單算法：買進佔比越高，分數越高
        score = Math.round((buys / total) * 100);
      }

      await SentimentData.updateOne(
        { symbol: t }, 
        { $set: { score, analystBuy: buys, analystSell: sells, date: new Date() } }, 
        { upsert: true }
      );
    }
  } catch (e) { 
    // 若無資料則忽略，許多台股可能無分析師數據
  }
}

async function initRelationData() {
  console.log(`🔗 [關聯] 檢查並同步種子資料...`);
  const relations = [
    { symbol: '2330.TW', relatedSymbol: '2404.TW', type: 'Supplier', weight: 0.8 },
    { symbol: '2330.TW', relatedSymbol: '6196.TW', type: 'Supplier', weight: 0.8 },
    { symbol: '2330.TW', relatedSymbol: '3131.TW', type: 'Supplier', weight: 0.7 },
    { symbol: '2317.TW', relatedSymbol: '2328.TW', type: 'Group', weight: 0.9 },
    { symbol: '2317.TW', relatedSymbol: '6414.TW', type: 'Group', weight: 0.9 },
    { symbol: '2382.TW', relatedSymbol: '3231.TW', type: 'Competitor', weight: 0.5 },
    { symbol: '2382.TW', relatedSymbol: '2376.TW', type: 'Competitor', weight: 0.5 },
  ];
  const bulkOps = [];
  relations.forEach(r => {
    bulkOps.push({ updateOne: { filter: { symbol: r.symbol, relatedSymbol: r.relatedSymbol }, update: { $set: { type: r.type, weight: r.weight }, $setOnInsert: { lagDays: 0, leadScore: 0 } }, upsert: true } });
    let revType = r.type === 'Supplier' ? 'Customer' : r.type;
    bulkOps.push({ updateOne: { filter: { symbol: r.relatedSymbol, relatedSymbol: r.symbol }, update: { $set: { type: revType, weight: r.weight }, $setOnInsert: { lagDays: 0, leadScore: 0 } }, upsert: true } });
  });
  try {
    await RelationData.bulkWrite(bulkOps);
  } catch (e) {}
}

async function updateStockHistory(symbol) {
  let t = symbol.match(/^\d+$/) ? `${symbol}.TW` : symbol;
  try {
    const l = await StockData.findOne({ symbol: t }).sort({ date: -1 });
    const d = new Date();
    let s = l ? new Date(new Date(l.date).setDate(new Date(l.date).getDate() + 1)) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    if (l && s > d) return 'SKIP';
    const r = await withRetry(() => yahooFinance.historical(t, { period1: s, period2: d, interval: '1d' }), 2, 1000);
    if (!r || !r.length) return false;
    const b = r.map(q => ({ updateOne: { filter: { symbol: t, date: q.date }, update: { $set: { open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume, adjClose: q.adjClose || q.close } }, upsert: true } }));
    await StockData.bulkWrite(b);
    return true;
  } catch (e) { return false; }
}

// ✨ [v8.3] 擴充全球商品監控清單
async function updateGlobalMarkets() { 
  const targets=[
    {symbol:'^SOX',name:'費城半導體'},
    {symbol:'^IXIC',name:'納斯達克'},
    {symbol:'TSM',name:'台積電ADR'},
    {symbol:'TWD=X',name:'美金台幣匯率'},
    {symbol:'^TNX',name:'10年期美債'},
    {symbol:'CL=F',name:'原油期貨'}, // ✨ 新增
    {symbol:'GC=F',name:'黃金期貨'}, // ✨ 新增
    {symbol:'HG=F',name:'銅期貨'}    // ✨ 新增
  ]; 
  for(const target of targets){ 
    try{ 
      const l=await GlobalMarketData.findOne({symbol:target.symbol}).sort({date:-1}); 
      const d=new Date(); 
      let s=l?new Date(new Date(l.date).setDate(new Date(l.date).getDate()+1)):new Date(Date.now()-30*24*3600*1000); 
      if(l&&s>d)continue; 
      const r=await withRetry(()=>yahooFinance.historical(target.symbol,{period1:s,period2:d,interval:'1d'})); 
      if(r&&r.length) await GlobalMarketData.bulkWrite(r.map(q=>({updateOne:{filter:{symbol:target.symbol,date:q.date},update:{$set:{close:q.close,changePercent:q.open?((q.close-q.open)/q.open)*100:0}},upsert:true}}))); 
    }catch(e){} 
  } 
}

async function updateMarketIndex() { const s='^TWII'; try{ const l=await MarketData.findOne({symbol:s}).sort({date:-1}); const d=new Date(); let st=l?new Date(new Date(l.date).setDate(new Date(l.date).getDate()+1)):new Date(Date.now()-365*24*3600*1000); if(l&&st>d)return; const r=await withRetry(()=>yahooFinance.historical(s,{period1:st,period2:d,interval:'1d'})); if(r&&r.length) await MarketData.bulkWrite(r.map(q=>({updateOne:{filter:{symbol:s,date:q.date},update:{$set:{open:q.open,close:q.close,volume:q.volume}},upsert:true}}))); }catch(e){} }
async function updateDividendSchedule() { try{const r=await axios.get('https://openapi.twse.com.tw/v1/opendata/t187ap45_L',{timeout:10000});if(Array.isArray(r.data))await EventData.bulkWrite(r.data.map(i=>{if(!i.除權息日期)return null;const y=parseInt(i.除權息日期.substring(0,3))+1911;const d=`${y}-${i.除權息日期.substring(3,5)}-${i.除權息日期.substring(5,7)}`;return {updateOne:{filter:{symbol:`${i.股票代號}.TW`,date:d,type:'Dividend'},update:{$set:{details:`合計:${i.股利合計}`,value:parseFloat(i.股利合計)||0}},upsert:true}}}).filter(x=>x));}catch(e){} }
async function updateDailyChips() { try{const r=await axios.get(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${getTwseDate()}&selectType=ALL&response=json`);if(r.data.stat==='OK')await ChipData.bulkWrite(r.data.data.filter(x=>x[0].length===4).map(x=>({updateOne:{filter:{symbol:`${x[0]}.TW`,date:{$gte:new Date(new Date().setHours(0,0,0,0)),$lt:new Date(new Date().setHours(23,59,59,999))}},update:{$set:{foreignBuy:parseInt(x[4].replace(/,/g,''))||0,investmentBuy:parseInt(x[10].replace(/,/g,''))||0}},upsert:true}})));}catch(e){} }
async function updateMarginData() { try{const r=await axios.get(`https://www.twse.com.tw/rwd/zh/margin/MI_MARGN?date=${getTwseDate()}&selectType=ALL&response=json`);if(r.data.stat==='OK'){const t=r.data.tables.find(x=>x.title.includes("信用交易"));if(t)await MarginData.bulkWrite(t.data.filter(x=>x[0].length===4).map(x=>({updateOne:{filter:{symbol:`${x[0]}.TW`,date:{$gte:new Date(new Date().setHours(0,0,0,0)),$lt:new Date(new Date().setHours(23,59,59,999))}},update:{$set:{marginBalance:parseInt(x[6].replace(/,/g,''))||0}},upsert:true}})));}}catch(e){} }
async function updateMonthlyRevenue() { try{const r=await axios.get('https://openapi.twse.com.tw/v1/opendata/t187ap05_L');if(Array.isArray(r.data))await RevenueData.bulkWrite(r.data.map(i=>({updateOne:{filter:{symbol:`${i.公司代號}.TW`,date:`${parseInt(i.出表日期.substring(0,3))+1911}-${i.出表日期.substring(3,5)}`},update:{$set:{yoY:parseFloat(i.營業收入_去年同月增減百分比)||0}},upsert:true}})));}catch(e){} }

async function updateAllStocks(watchList) {
  console.log('🔄 啟動資料更新管道 v8.3...');
  try {
    await updateGlobalMarkets(); 
    await initRelationData();
    await updateMarketIndex();
    await updateDailyChips();
    await updateMarginData();
    await updateMonthlyRevenue();
    await updateDividendSchedule();
  } catch (e) {}
  
  if (!watchList || !watchList.length) return;
  let processed = 0;
  for (const symbol of watchList) {
    processed++;
    process.stdout.write(`\r🚀 [${processed}/${watchList.length}] 掃描 ${symbol}...       `);
    const kSuccess = await updateStockHistory(symbol);
    if (kSuccess === true) {
      await updateFundamentals(symbol);
      // ✨ 順便更新情緒
      await updateSentiment(symbol);
    }
    await new Promise(r => setTimeout(r, 100)); 
  }
  console.log(`\n🎉 資料更新完成`);
}

module.exports = { updateAllStocks, updateIntradayQuotes, initRelationData, fetchTwseDailyClose, updateFundamentals, updateSentiment };