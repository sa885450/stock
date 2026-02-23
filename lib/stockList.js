// lib/stockList.js
const axios = require('axios');

/**
 * 抓取上市櫃全市場標的清單 (股票 + 權證)
 */
async function getAllSymbols() {
  console.log('📋 [系統] 正在彙整全市場標的清單 (上市+上櫃+權證)...');
  try {
    // 1. 同時對接證交所 (TWSE) 與 櫃買中心 (TPEx) 的 Open API
    const urls = [
      'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', // 上市股票
      'https://openapi.twse.com.tw/v1/warrant/all',                // 上市權證
      'https://openapi.tpex.org.tw/v1/stock/aftertrading/otc_quotes_no1', // 上櫃股票 (部分清單)
    ];

    const results = await Promise.allSettled(urls.map(url => axios.get(url, { timeout: 5000 })));

    let allSymbols = new Set();

    // 處理上市股票與權證
    if (results[0].status === 'fulfilled') {
      results[0].value.data.forEach(item => {
        if (item.Code && (item.Code.length === 4 || item.Code.length === 6)) {
          allSymbols.add(`${item.Code}.TW`);
        }
      });
    }

    if (results[1].status === 'fulfilled') {
      results[1].value.data.forEach(item => {
        if (item.Code) allSymbols.add(`${item.Code}.TW`);
      });
    }

    // 處理上櫃標的 (這部分 API 回傳欄位稍有不同)
    if (results[2].status === 'fulfilled') {
      results[2].value.data.forEach(item => {
        const code = item.SecuritiesCode || item.Code;
        if (code && (code.length === 4 || code.length === 6)) {
          allSymbols.add(`${code}.TW`);
        }
      });
    }

    const symbols = Array.from(allSymbols);
    console.log(`✅ 標的彙整完成，共 ${symbols.length} 檔 (含上市櫃股票與權證)`);

    // 如果結果太少（代表 API 可能被擋），回傳預設值
    if (symbols.length < 10) throw new Error('API 回傳資料異常過少');

    return symbols;
  } catch (error) {
    console.error('❌ 取得標的清單失敗:', error.message);
    // 備援方案：至少包含權證測試標的
    return [
      '2330.TW', '2317.TW', '2454.TW',
      '05165C.TW', '03001P.TW', '70001P.TW', '03002P.TW'
    ];
  }
}

module.exports = { getAllSymbols };