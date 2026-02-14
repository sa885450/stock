// lib/maintenance.js
const { StockData, StockDataArchive, FundamentalData, DataAuditLog } = require('./database');
const crawler = require('./crawler');

/**
 * 1. 冷熱資料分離 (Data Tiering)
 * 將 2 年前 (730天) 的 K 線資料搬移至 Archive，減輕主表壓力
 */
async function runDataArchiving() {
  console.log('🧊 [維護] 開始執行冷熱資料分離...');
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 730); // 2年前

  try {
    // 1. 找出過期資料
    const oldDocs = await StockData.find({ date: { $lt: cutoffDate } }).lean();
    if (oldDocs.length === 0) {
      console.log('✅ [維護] 無需歸檔資料 (全為熱資料)');
      return;
    }

    console.log(`📦 [維護] 發現 ${oldDocs.length} 筆冷資料，準備歸檔...`);

    // 2. 批次寫入 Archive
    // 為了避免記憶體爆掉，分批處理
    const batchSize = 1000;
    for (let i = 0; i < oldDocs.length; i += batchSize) {
      const chunk = oldDocs.slice(i, i + batchSize);
      await StockDataArchive.insertMany(chunk, { ordered: false }).catch(() => {}); // 忽略重複錯誤
    }

    // 3. 刪除主表資料
    const res = await StockData.deleteMany({ date: { $lt: cutoffDate } });
    console.log(`✅ [維護] 歸檔完成，已從主表移除 ${res.deletedCount} 筆資料`);

  } catch (err) {
    console.error(`❌ [維護] 歸檔失敗: ${err.message}`);
  }
}

/**
 * 2. 異源校對 (Cross-Source Verification)
 * 比對 Yahoo Finance (來自 DB) 與 TWSE (官方) 的收盤價
 */
async function runCrossVerification(watchList) {
  console.log('🛡️ [審計] 開始執行異源數據校對...');
  
  // 1. 取得證交所官方報價 (真理來源)
  const twseMap = await crawler.fetchTwseDailyClose();
  if (!twseMap) return; // 沒抓到 (可能休市或API掛了)

  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  let errorCount = 0;

  // 2. 逐一檢查 DB 中的數據
  for (const symbol of watchList) {
    // 抓取 DB 中最新的一筆 (通常是昨天或今天的收盤)
    const dbStock = await StockData.findOne({ symbol }).sort({ date: -1 });
    if (!dbStock) continue;

    const officialPrice = twseMap.get(symbol);
    
    // 如果官方有報價，且 DB 也有數據
    if (officialPrice && dbStock.close) {
      // 誤差容許值 1.5% (Yahoo 有時會有微小誤差或延遲)
      const diff = Math.abs(dbStock.close - officialPrice);
      const diffPercent = (diff / officialPrice) * 100;

      if (diffPercent > 1.5) {
        console.warn(`⚠️ [異常] ${symbol} 報價誤差: Yahoo(${dbStock.close}) vs TWSE(${officialPrice}) Diff: ${diffPercent.toFixed(2)}%`);
        
        // 寫入審計日誌
        await DataAuditLog.updateOne(
          { date: dateStr, symbol: symbol },
          { 
            $set: { 
              yahooPrice: dbStock.close, 
              twsePrice: officialPrice, 
              diffPercent: diffPercent,
              status: 'ERROR'
            } 
          },
          { upsert: true }
        );
        errorCount++;
      }
    }
  }

  if (errorCount === 0) {
    console.log('✅ [審計] 數據一致性檢查通過，無異常。');
  } else {
    console.log(`🚨 [審計] 發現 ${errorCount} 檔股票數據異常，已記錄於 AuditLog。`);
  }
}

// 既有的補漏檢查
async function runHealthCheck(watchList) {
  console.log('🏥 [系統] 啟動健康檢查...');
  let fixCount = 0;
  for (const symbol of watchList) {
    const hasData = await FundamentalData.exists({ symbol: symbol });
    if (!hasData) {
      // console.log(`🩹 [修復] ${symbol} 缺失基本面，補抓中...`);
      await crawler.updateFundamentals(symbol);
      fixCount++;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  // ✨ 新增: 執行進階維護
  await runCrossVerification(watchList); // 校對
  await runDataArchiving();              // 歸檔
}

module.exports = { runHealthCheck, runDataArchiving, runCrossVerification };