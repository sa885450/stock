/**
 * correlation-worker.js (v8.2 Final)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, StockData, RelationData } = require('./lib/database'); // 確保路徑指向 lib/database.js

const rawAnchors = process.env.ANCHOR_STOCKS || '2330.TW,2317.TW,2454.TW,2603.TW,2308.TW,3231.TW';
const ANCHOR_STOCKS = rawAnchors.split(',').map(s => s.trim()).filter(s => s.length > 0);
const LOOKBACK_DAYS = parseInt(process.env.CORRELATION_LOOKBACK || '60', 10);
const CORRELATION_THRESHOLD = parseFloat(process.env.CORRELATION_THRESHOLD || '0.75'); 
const MAX_LAG_DAYS = 3; 

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

function calculatePearson(x, y) {
  if (x.length !== y.length || x.length === 0) return 0;
  const muX = mean(x), muY = mean(y);
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - muX, dy = y[i] - muY;
    num += dx * dy; d1 += dx * dx; d2 += dy * dy;
  }
  const den = Math.sqrt(d1) * Math.sqrt(d2);
  return den === 0 ? 0 : num / den;
}

async function getReturnsSeries(symbol, limit) {
  const q = await StockData.find({ symbol }).sort({ date: -1 }).limit(limit + 10).select('date adjClose close').lean();
  if (q.length < limit) return null;
  q.sort((a, b) => a.date - b.date);
  const dates = [], returns = [];
  for (let i = 1; i < q.length; i++) {
    const p1 = q[i].adjClose || q[i].close, p0 = q[i-1].adjClose || q[i-1].close;
    if (p0 <= 0) continue;
    dates.push(q[i].date.toISOString().split('T')[0]);
    returns.push((p1 - p0) / p0);
  }
  return { dates, returns };
}

async function runDiscovery() {
  console.log('🔍 [偵探] 開始尋找市場隱藏滯後關係...');
  try {
    const allStocks = await StockData.distinct('symbol');
    // ✨ 檢查 StockData 是否有資料
    if (allStocks.length === 0) { 
        console.warn('⚠️ [偵探] StockData 為空，無法計算相關性。請先執行全網更新抓取 K 線。'); 
        return; 
    }

    const targetStocks = allStocks.filter(s => !ANCHOR_STOCKS.includes(s));
    const anchorCache = {};
    for (const anchor of ANCHOR_STOCKS) {
      const data = await getReturnsSeries(anchor, LOOKBACK_DAYS + MAX_LAG_DAYS);
      if (data) anchorCache[anchor] = data;
    }

    const bulkOps = [];
    for (const anchor of Object.keys(anchorCache)) {
      const { dates: datesA, returns: returnsA } = anchorCache[anchor];
      for (const target of targetStocks) {
        const targetData = await getReturnsSeries(target, LOOKBACK_DAYS + MAX_LAG_DAYS);
        if (!targetData) continue;
        const { dates: datesB, returns: returnsB } = targetData;
        const mapB = new Map(); datesB.forEach((d, i) => mapB.set(d, returnsB[i]));
        let bestLag = -1, maxCorr = -1;
        for (let lag = 0; lag <= MAX_LAG_DAYS; lag++) {
          const x = [], y = [];
          for (let i = 0; i < datesA.length - lag; i++) {
            const dateLagged = datesA[i + lag];
            if (mapB.has(dateLagged)) { x.push(returnsA[i]); y.push(mapB.get(dateLagged)); }
          }
          if (x.length < 30) continue;
          const corr = calculatePearson(x, y);
          if (corr > maxCorr) { maxCorr = corr; bestLag = lag; }
        }
        if (maxCorr > CORRELATION_THRESHOLD) {
          bulkOps.push({
            updateOne: {
              filter: { symbol: anchor, relatedSymbol: target },
              update: { $set: { type: 'Statistical', weight: parseFloat(maxCorr.toFixed(2)), lagDays: bestLag, leadScore: maxCorr } },
              upsert: true
            }
          });
        }
      }
    }
    if (bulkOps.length > 0) {
      await RelationData.bulkWrite(bulkOps);
      console.log(`💾 運算完成，更新 ${bulkOps.length} 筆資料`);
    } else {
      console.log('ℹ️ [偵探] 本次掃描未發現新的強相關組合。');
    }
  } catch (err) { console.error(err); }
}

// ✨ 模組導出
module.exports = { runDiscovery };

// 獨立執行支援
if (require.main === module) {
  (async () => {
    await connectDB();
    await runDiscovery();
    process.exit(0);
  })();
}