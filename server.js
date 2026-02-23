// server.js
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { connectDB, AnalysisSnapshot, IntradaySnapshot, BacktestResult, RelationData } = require('./lib/database');
const { updateAllStocks, updateIntradayQuotes, initRelationData } = require('./lib/crawler');
const { runDailyBatchAnalysis, runBacktestAudit } = require('./lib/monitor');
const { runHealthCheck } = require('./lib/maintenance');
const { getAllSymbols } = require('./lib/stockList');
const { fetchRealtimeData } = require('./lib/realtime');
const correlationWorker = require('./correlation-worker');

const app = express();
const PORT = 3001;

connectDB().then(async () => {
  console.log('🔗 資料庫連線確認，啟動初始化...');
  await initSystem();
  app.listen(PORT, () => console.log(`🚀 AI 戰情室 v8.4 已啟動：http://localhost:${PORT}`));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let watchList = [];

async function initSystem() {
  try {
    watchList = await getAllSymbols();
    console.log(`🚀 監控清單初始化完成: ${watchList.length} 檔`);

    // 檢查權證代號是否存在
    const warrants = watchList.filter(s => s.split('.')[0].length === 6);
    console.log(`🔍 偵測到 ${warrants.length} 檔權證標的於清單中`);

    await initRelationData();
    const count = await RelationData.countDocuments();
    if (count < 20) {
      console.log('🤖 啟動 AI 滯後偵測...');
      correlationWorker.runDiscovery().catch(() => { });
    }
  } catch (e) { console.error("初始化失敗:", e); }
}

// 排程與 API
cron.schedule('30 14 * * 1-5', async () => {
  console.log('⏰ [排程] 啟動盤後作業...');
  watchList = await getAllSymbols();
  await updateAllStocks(watchList);
  await runHealthCheck(watchList);
  console.log('🔗 [排程] 啟動關聯偵測...');
  await correlationWorker.runDiscovery();
  await runDailyBatchAnalysis(watchList);
  await runBacktestAudit();
});

cron.schedule('*/30 9-13 * * 1-5', async () => {
  console.log('⚡ [排程] 啟動盤中即時報價更新...');
  if (watchList.length === 0) watchList = await getAllSymbols();
  await updateIntradayQuotes(watchList);
});

let isUpdating = false;
app.post('/api/update', async (req, res) => {
  if (isUpdating) return res.status(429).json({ success: false, message: '更新進行中' });
  isUpdating = true;
  res.json({ success: true, message: '全量作業啟動...' });
  try {
    if (watchList.length < 10) watchList = await getAllSymbols();
    await updateAllStocks(watchList);
    await runHealthCheck(watchList);
    await runDailyBatchAnalysis(watchList);
    await runBacktestAudit();
  } catch (e) { console.error(e); } finally { isUpdating = false; }
});

app.post('/api/intraday', async (req, res) => {
  res.json({ success: true, message: '正在抓取盤中即時價...' });
  if (watchList.length < 10) watchList = await getAllSymbols();
  await updateIntradayQuotes(watchList);
});

app.post('/api/screen', async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    let results = await AnalysisSnapshot.find({ date: todayStr }).sort({ score: -1 }).limit(300).lean();
    if (results.length === 0) {
      const lastData = await AnalysisSnapshot.findOne().sort({ date: -1 });
      if (lastData) results = await AnalysisSnapshot.find({ date: lastData.date }).sort({ score: -1 }).limit(300).lean();
    }
    const intradayData = await IntradaySnapshot.find({}).lean();
    const intradayMap = new Map(intradayData.map(i => [i.symbol, i]));
    results.forEach(r => {
      const live = intradayMap.get(r.symbol);
      if (live) {
        r.price = live.price;
        r.percent = live.changePercent;
        r.isLive = true;
      }
    });
    const { rsiThreshold } = req.body;
    const filtered = results.filter(r => r.score >= 70 || parseFloat(r.details.rsi) <= parseFloat(rsiThreshold));
    res.json({ success: true, data: filtered });
  } catch (e) { res.json({ success: false, data: [] }); }
});

app.get('/api/backtest', async (req, res) => {
  try {
    const reports = await BacktestResult.find().sort({ date: -1 }).limit(5).lean();
    res.json({ success: true, data: reports });
  } catch (e) { res.json({ success: false, data: [] }); }
});

// ✨ [v8.4] 權證熱度即時 API (增強偵錯版)
app.get('/api/warrants/hot', async (req, res) => {
  try {
    if (watchList.length === 0) {
      console.log('📋 [權證] API 呼叫但 watchList 尚未備妥，觸發初始化...');
      watchList = await getAllSymbols();
    }

    const warrants = watchList.filter(s => s.split('.')[0].length === 6);

    // 1. 先抓快照
    let topWarrants = await IntradaySnapshot.find({ symbol: { $in: warrants } })
      .sort({ volume: -1 }).limit(50).lean();

    if (targetSymbols.length === 0) {
      console.log('💡 [權證] 資料庫無快照，嘗試從清單直接抓取即時數據...');
      targetSymbols = warrants.slice(0, 50);
    }

    if (targetSymbols.length === 0) {
      console.warn('⚠️ [權證] 系統內找不到任何權證標的，請檢查 lib/stockList.js 的過濾邏輯');
      return res.json({ success: true, data: [] });
    }

    // 3. 獲取即時資料
    console.log(`📡 [權證] 正在向交易所抓取即時資料: ${targetSymbols.length} 檔`);
    const liveData = await fetchRealtimeData(targetSymbols);

    if (liveData.length > 0) {
      console.log(`✅ [權證] 成功抓取 ${liveData.length} 檔即時數據`);
      const maxAmount = Math.max(...liveData.map(d => d.amount));
      liveData.forEach(d => {
        d.hotScore = maxAmount > 0 ? (d.amount / maxAmount) * 100 : 0;
      });
      liveData.sort((a, b) => b.amount - a.amount);

      // 4. 背景更新快照
      const bulkOps = liveData.map(d => ({
        updateOne: {
          filter: { symbol: d.symbol },
          update: { $set: { price: d.price, changePercent: d.changePercent, volume: d.volume, lastUpdate: new Date() } },
          upsert: true
        }
      }));
      IntradaySnapshot.bulkWrite(bulkOps).catch(e => console.error("快照同步失敗:", e));
    } else {
      console.warn('⚠️ [權證] 交易所回傳空資料，請檢查代號格式或是否非交易開盤盤時段');
    }
    res.json({ success: true, data: liveData });
  } catch (e) {
    console.error("❌ 權證 API 嚴重錯誤:", e);
    res.json({ success: false, data: [] });
  }
});