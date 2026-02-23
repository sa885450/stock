// lib/stockList.js
const axios = require('axios'); // 需安裝 axios: npm install axios

async function getAllSymbols() {
  console.log('📋 [系統] 正在向證交所索取全市場股票清單...');
  try {
    // 證交所 Open API (每日收盤行情)
    const response = await axios.get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    const data = response.data;

    // 過濾出正常的股票代號 (包含 4 碼股票與 6 碼權證)
    const symbols = data
      .filter(item => item.Code.length === 4 || item.Code.length === 6)
      .map(item => `${item.Code}.TW`); // 轉成 Yahoo Finance 格式

    console.log(`✅ 成功取得 ${symbols.length} 檔上市股票代號`);
    return symbols;
  } catch (error) {
    console.error('❌ 取得股票清單失敗，切換回預設清單:', error.message);
    // 如果證交所 API 掛了，回傳預設重點股
    return ['2330.TW', '2317.TW', '2454.TW', '2308.TW', '2603.TW'];
  }
}

module.exports = { getAllSymbols };