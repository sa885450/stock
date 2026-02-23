// lib/realtime.js
const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default || require('yahoo-finance2');

/**
 * 抓取即時資料 (優先使用證交所，失效或資料損毀則強制切換至 Yahoo)
 * @param {string[]} symbols 標的代號陣列
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    let results = [];

    // 1. 嘗試證交所 API
    try {
        const queryString = symbols.map(s => {
            const code = s.split('.')[0].toLowerCase();
            let market = code.startsWith('7') ? 'otc' : 'tse';
            return `${market}_${code}.tw`;
        }).join('|');

        const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queryString}&json=1&delay=0`;

        const response = await axios.get(url, {
            timeout: 6000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://mis.twse.com.tw/'
            }
        });

        if (response.data && response.data.msgArray && response.data.msgArray.length > 0) {
            results = response.data.msgArray.map((m, index) => {
                const originalSymbol = symbols[index] ? symbols[index].split('.')[0] : '';
                const code = (m.c || originalSymbol).toUpperCase();
                const name = m.n || m.nf || `權證 ${code}`;

                const parseSafe = (val) => {
                    if (!val || val === '-' || val === '--') return 0;
                    const n = parseFloat(val);
                    return isNaN(n) ? 0 : n;
                };

                const cur = parseSafe(m.z) || parseSafe(m.y) || 0;
                const prev = parseSafe(m.y) || cur;
                const vol = parseSafe(m.tv);

                return {
                    symbol: `${code}.TW`,
                    name: name,
                    price: cur,
                    changePercent: prev !== 0 ? parseFloat((((cur - prev) / prev) * 100).toFixed(2)) : 0,
                    volume: vol,
                    amount: parseFloat(((cur * vol * 1000) / 10000).toFixed(2)),
                    lastUpdate: new Date()
                };
            }).filter(item => item.name && !item.name.includes('undefined'));
        }
    } catch (e) {
        console.warn('⚠️ [交易所] 連線異常:', e.message);
    }

    // 2. 🛡️ 強制備援邏輯：如果證交所沒回來、或回來後全為空，則請求 Yahoo
    if (results.length === 0) {
        console.log(`📡 [備援] 證交所資料無效，切換 Yahoo Finance (代號數: ${symbols.length})...`);
        try {
            // 分批處理避免 Yahoo 封鎖
            const yahooResults = await Promise.all(symbols.map(async (s) => {
                try {
                    const quote = await yahooFinance.quote(s);
                    if (!quote) return null;
                    return {
                        symbol: s,
                        name: quote.longName || quote.shortName || s.split('.')[0],
                        price: quote.regularMarketPrice || 0,
                        changePercent: quote.regularMarketChangePercent || 0,
                        volume: (quote.regularMarketVolume || 0) / 1000,
                        amount: (quote.regularMarketPrice * (quote.regularMarketVolume || 0)) / 10000,
                        lastUpdate: quote.regularMarketTime || new Date()
                    };
                } catch (err) {
                    console.log(`❌ [Yahoo] ${s} 抓取失敗:`, err.message);
                    return null;
                }
            }));
            results = yahooResults.filter(r => r !== null);
            console.log(`✅ [備援] Yahoo 成功回傳 ${results.length} 筆資料`);
        } catch (err) {
            console.error('❌ [備援] Yahoo 批量抓取失敗:', err.message);
        }
    }

    return results;
}

module.exports = { fetchRealtimeData };
