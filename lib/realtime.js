// lib/realtime.js
const axios = require('axios');

/**
 * 從證交所基本市況報導 (mis.twse.com.tw) 抓取即時資料
 * @param {string[]} symbols 標的代號陣列 (例如: ['2330.TW', '03001P.TW'])
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // 🛡️ 最終查詢格式建議：市場小寫 + 代號大寫 (例如: tse_2330.tw)
    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toUpperCase();
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
                const originalSymbol = symbols[index] ? symbols[index].split('.')[0] : (m.c || '');
                const code = (m.c || originalSymbol).toUpperCase();
                const name = m.n || m.nf || `權證 ${code}`;

                const parseSafe = (val) => {
                    if (!val || val === '-') return 0;
                    const n = parseFloat(val);
                    return isNaN(n) ? 0 : n;
                };

                // z 是當前成交價, y 是昨收價
                const currentPrice = parseSafe(m.z) || parseSafe(m.y) || 0;
                const yesterdayPrice = parseSafe(m.y) || currentPrice || 0;
                const totalVolume = parseSafe(m.tv);

                let changePercent = 0;
                if (yesterdayPrice > 0) {
                    changePercent = ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100;
                }

                const safeAmount = (currentPrice * totalVolume * 1000) / 10000;

                return {
                    symbol: `${code}.TW`,
                    name: name,
                    price: currentPrice,
                    changePercent: parseFloat((isFinite(changePercent) ? changePercent : 0).toFixed(2)),
                    volume: totalVolume,
                    amount: parseFloat((isFinite(safeAmount) ? safeAmount : 0).toFixed(2)),
                    lastUpdate: m.tlong ? new Date(parseInt(m.tlong)) : new Date()
                };
            }).filter(item => item.price > 0 || item.volume > 0);
        }
        return [];
    } catch (error) {
        console.error(`❌ [交易所] 抓取過程錯誤: ${error.message}`);
        return [];
    }
}

module.exports = { fetchRealtimeData };
