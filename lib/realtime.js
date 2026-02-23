// lib/realtime.js
const axios = require('axios');

/**
 * 從證交所基本市況報導 (mis.twse.com.tw) 抓取即時資料
 * @param {string[]} symbols 標的代號陣列 (例如: ['2330.TW', '03001P.TW'])
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // 建立查詢字串，同時包含 tse 與 otc 通用判斷
    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toLowerCase();
        // 判定市場 (上市 tse / 上櫃 otc)
        // 規則：開頭為 7 的權證多為上櫃 (otc)，其他多為上市 (tse)
        let market = code.startsWith('7') ? 'otc' : 'tse';
        return `${market}_${code}.tw`;
    }).join('|');

    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queryString}&json=1&delay=0`;
    console.log(`🌐 [交易所] 請求 URL: ${url}`);

    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
            }
        });

        if (response.data && response.data.msgArray && response.data.msgArray.length > 0) {
            return response.data.msgArray.map((m, index) => {
                // 🛡️ 修復 s is not defined 與 欄位缺失問題
                const originalSymbol = symbols[index] ? symbols[index].split('.')[0] : '';
                const code = m.c || originalSymbol;
                const name = m.n || m.nf || `權證 ${code}`;

                // 清理數值：交易所可能回傳 "-"
                const parseSafe = (val) => {
                    const n = parseFloat(val);
                    return isNaN(n) ? 0 : n;
                };

                const currentPrice = parseSafe(m.z) || parseSafe(m.y);
                const yesterdayPrice = parseSafe(m.y);
                const totalVolume = parseSafe(m.tv);

                let changePercent = 0;
                if (yesterdayPrice > 0) {
                    changePercent = ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100;
                }

                return {
                    symbol: `${(code || '').toUpperCase()}.TW`,
                    name: name,
                    price: currentPrice,
                    changePercent: parseFloat(changePercent.toFixed(2)),
                    volume: totalVolume,
                    amount: parseFloat(((currentPrice * totalVolume * 1000) / 10000).toFixed(2)),
                    lastUpdate: m.tlong ? new Date(parseInt(m.tlong)) : new Date()
                };
            }).filter(item => item.price > 0 || item.volume > 0); // 過濾掉完全沒資料的
        }
        return [];
    } catch (error) {
        console.error(`❌ [交易所] 抓取過程錯誤: ${error.message}`);
        return [];
    }
}

module.exports = { fetchRealtimeData };
