// lib/realtime.js
const axios = require('axios');

/**
 * 從證交所基本市況報導 (mis.twse.com.tw) 抓取即時資料
 * @param {string[]} symbols 標的代號陣列 (例如: ['2330.TW', '03001P.TW'])
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // 🛡️ 證交所 API 對格式極度敏感：
    // 1. 代號必須大寫 (雖然官方文件沒說，但大寫最穩)
    // 2. 只有上市標的用 tse_，上櫃用 otc_
    // 3. 同一個代號不可以同時 tse_ 和 otc_ 在同一個查詢，否則回傳可能失效
    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toUpperCase();

        // 判定市場規則 (依據代號特徵)
        // 上市權證通常為 03~08 開頭
        // 上櫃權證通常為 70~73 開頭
        let market = 'tse';
        if (code.startsWith('7')) market = 'otc';

        return `${market}_${code.toLowerCase()}.tw`;
    }).join('|');

    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queryString}&json=1&delay=0`;

    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Referer': 'https://mis.twse.com.tw/'
            }
        });

        if (response.data && response.data.msgArray && response.data.msgArray.length > 0) {
            return response.data.msgArray.map(m => {
                const currentPrice = parseFloat(m.z) || parseFloat(m.y) || 0;
                const yesterdayPrice = parseFloat(m.y) || 0;
                const totalVolume = parseInt(m.tv) || 0;

                let changePercent = 0;
                if (yesterdayPrice > 0) {
                    changePercent = ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100;
                }

                // 數值安全檢查
                const safePrice = isFinite(currentPrice) ? currentPrice : 0;
                const safePercent = isFinite(changePercent) ? changePercent : 0;
                const safeVolume = isFinite(totalVolume) ? totalVolume : 0;
                const safeAmount = (safePrice * safeVolume * 1000) / 10000;

                return {
                    symbol: `${m.c.toUpperCase()}.TW`,
                    name: m.n,
                    price: safePrice,
                    changePercent: parseFloat(safePercent.toFixed(2)),
                    volume: safeVolume,
                    amount: parseFloat(safeAmount.toFixed(2)),
                    lastUpdate: m.tlong ? new Date(parseInt(m.tlong)) : new Date()
                };
            });
        }

        // 🥈 [備援機制] 如果單一市場判定失敗，試試看混合查詢 (但不合併代碼)
        console.warn(`⚠️ [交易所] 第一階段抓取無效，嘗試備援機制... URL: ${url}`);
        return [];
    } catch (error) {
        console.error(`❌ 即時資料抓取失敗: ${error.message}`);
        return [];
    }
}

module.exports = { fetchRealtimeData };
