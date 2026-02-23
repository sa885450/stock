// lib/stockList.js
const axios = require('axios');

/**
 * 抓取上市櫃全市場標的清單 (股票 + 權證)
 */
async function getAllSymbols() {
  console.log('📋 [系統] 正在彙整全市場標的清單...');
  try {
    const [stocks, warrants] = await Promise.allSettled([
      axios.get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { timeout: 5000 }),
      axios.get('https://openapi.twse.com.tw/v1/warrant/all', { timeout: 5000 })
    ]);

    let allSymbols = new Set();

    if (stocks.status === 'fulfilled') {
      stocks.value.data.forEach(item => {
        if (item.Code && item.Code.length === 4) allSymbols.add(`${item.Code}.TW`);
      });
    }

    if (warrants.status === 'fulfilled') {
      warrants.value.data.forEach(item => {
        if (item.Code) allSymbols.add(`${item.Code}.TW`);
      });
    }

    const symbols = Array.from(allSymbols);
    if (symbols.length < 50) throw new Error('API 資料量異常');

    console.log(`✅ 標定清單更新完成: ${symbols.length} 檔`);
    return symbols;
  } catch (error) {
    console.warn('⚠️ [系統] API 下載失敗，使用精選備援清單');
    return [
      '2330.TW', '2317.TW', '2454.TW', '2603.TW', '2308.TW',
      // 熱門權證備援
      '05165C.TW', '08873P.TW', '08875P.TW', '70001P.TW', '70002P.TW',
      '03001P.TW', '03002P.TW', '03003P.TW', '03004P.TW', '03005P.TW',
      '05166C.TW', '05167C.TW', '05168C.TW', '05169C.TW'
    ];
  }
}

module.exports = { getAllSymbols };