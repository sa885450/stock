// lib/realtime.js
const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default; // 使用專案已有的套件

/**
 * 抓取即時資料 (優先使用證交所，失效則切換至 Yahoo)
 * @param {string[]} symbols 標的代號陣列
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // 1. 嘗試證交所 API (最即時但易被擋)
    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toLowerCase();
        let market = code.startsWith('7') ? 'otc' : 'tse';
        return `${market}_${code}.tw`;
    }).join('|');

    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queryString}&json=1&delay=0`;

    try {
        const response = await axios.get(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://mis.twse.com.tw/',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
            }
        });

        if (response.data && response.data.msgArray && response.data.msgArray.length > 0) {
            console.log('✅ [交易所] 抓取成功');
            return response.data.msgArray.map((m, index) => {
                const code = (m.c || symbols[index].split('.')[0]).toUpperCase();
                const cur = parseFloat(m.z) || parseFloat(m.y) || 0;
                const prev = parseFloat(m.y) || cur;
                const vol = parseInt(m.tv) || 0;
                return {
                    symbol: `${code}.TW`,
                    name: m.n || m.nf || `權證 ${code}`,
                    price: cur,
                    changePercent: prev !== 0 ? parseFloat((((cur - prev) / prev) * 100).toFixed(2)) : 0,
                    volume: vol,
                    amount: parseFloat(((cur * vol * 1000) / 10000).toFixed(2)),
                    lastUpdate: new Date()
                };
            }).filter(item => item.price > 0);
        }
    } catch (e) {
        console.warn('⚠️ [交易所] 失敗，準備切換備援...');
    }

    // 2. 備援方案：Yahoo Finance (延遲約 15 分鐘但保證有資料)
    console.log(`📡 [備援] 正在從 Yahoo Finance 抓取 ${symbols.length} 檔代號...`);
    try {
        // Yahoo 建議分批，這裡我們直接抓
        const results = await Promise.all(symbols.map(async (s) => {
            try {
                const quote = await yahooFinance.quote(s);
                return {
                    symbol: s,
                    name: quote.longName || quote.shortName || s.split('.')[0],
                    price: quote.regularMarketPrice || 0,
                    changePercent: quote.regularMarketChangePercent || 0,
                    volume: (quote.regularMarketVolume || 0) / 1000, // Yahoo 回傳的是股數，轉成張
                    amount: (quote.regularMarketPrice * (quote.regularMarketVolume || 0)) / 10000,
                    lastUpdate: quote.regularMarketTime || new Date()
                };
            } catch (err) { return null; }
        }));
        return results.filter(r => r !== null && r.price > 0);
    } catch (err) {
        console.error('❌ [備援] 全部失敗:', err.message);
        return [];
    }
}

module.exports = { fetchRealtimeData };
