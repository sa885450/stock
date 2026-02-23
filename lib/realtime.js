// lib/realtime.js
const axios = require('axios');

/**
 * 從證交所基本市況報導 (mis.twse.com.tw) 抓取即時資料
 * @param {string[]} symbols 標的代號陣列 (例如: ['2330.TW', '03001P.TW'])
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // 將代號轉換為 mis.twse 格式 (例如: tse_2330.tw)
    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toLowerCase();
        return `tse_${code}.tw`;
    }).join('|');

    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queryString}&json=1&delay=0`;

    try {
        const response = await axios.get(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (response.data && response.data.msgArray) {
            return response.data.msgArray.map(m => {
                // v: 當前成交量(單筆), tv: 當日累計成交量, z: 最近成交價, high/low/open
                // n: 股票名稱, c: 代號
                const currentPrice = parseFloat(m.z) || parseFloat(m.y); // z 是最新成交, y 是昨收
                const totalVolume = parseInt(m.tv) || 0;
                const change = currentPrice - parseFloat(m.y);
                const changePercent = (change / parseFloat(m.y)) * 100;

                return {
                    symbol: `${m.c}.TW`,
                    name: m.n,
                    price: currentPrice,
                    changePercent: changePercent,
                    volume: totalVolume,
                    amount: (currentPrice * totalVolume * 1000) / 10000, // 概算成交值(萬元)，假設單位是張(1000股)
                    lastUpdate: new Date(parseInt(m.tlong) || Date.now())
                };
            });
        }
        return [];
    } catch (error) {
        console.error(`❌ 即時資料抓取失敗: ${error.message}`);
        return [];
    }
}

module.exports = { fetchRealtimeData };
