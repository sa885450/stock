// lib/realtime.js
const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default || require('yahoo-finance2');

/**
 * 抓取即時資料 (優先使用證交所，失效或資料損毀則強制切換至 Yahoo)
 * @param {string[]} symbols 標的代號陣列 (Yahoo 格式，例如: 05165C.TW)
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
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://mis.twse.com.tw/'
            }
        });

        if (response.data && response.data.msgArray && response.data.msgArray.length > 0) {
            results = response.data.msgArray.map((m, index) => {
                const code = (m.c || symbols[index].split('.')[0]).toUpperCase();
                const parseSafe = (v) => (!v || v === '-' ? 0 : parseFloat(v));
                const cur = parseSafe(m.z) || parseSafe(m.y) || 0;
                const prev = parseSafe(m.y) || cur;
                const vol = parseSafe(m.tv);
                return {
                    symbol: `${code}.TW`,
                    name: m.n || m.nf || `權證 ${code}`,
                    price: cur,
                    changePercent: prev !== 0 ? parseFloat((((cur - prev) / prev) * 100).toFixed(2)) : 0,
                    volume: vol,
                    amount: parseFloat(((cur * vol * 1000) / 10000).toFixed(2)),
                    lastUpdate: new Date()
                };
            }).filter(item => item.name && !item.name.includes('undefined') && item.price > 0);
        }
    } catch (e) { }

    // 2. 🛡️ 強制備援邏輯：切換 Yahoo Finance
    if (results.length === 0) {
        console.log(`📡 [備援] 證交所無效，切換 Yahoo Finance (代號數: ${symbols.length})...`);
        try {
            const yahooResults = await Promise.all(symbols.map(async (s) => {
                const baseCode = s.split('.')[0];
                // 🛡️ 判定 Yahoo 代號後綴：7 開頭通常是 .TWO (上櫃)
                const yahooSymbol = baseCode.startsWith('7') ? `${baseCode}.TWO` : `${baseCode}.TW`;

                try {
                    const quote = await yahooFinance.quote(yahooSymbol);
                    if (!quote) return null;

                    const price = quote.regularMarketPrice || quote.previousClose || 0;
                    const changePercent = quote.regularMarketChangePercent || 0;
                    const volume = quote.regularMarketVolume || 0;

                    return {
                        symbol: s, // 保持原始清單格式
                        name: quote.longName || quote.shortName || baseCode,
                        price: price,
                        changePercent: changePercent,
                        volume: volume / 1000,
                        amount: (price * volume) / 10000,
                        lastUpdate: quote.regularMarketTime || new Date()
                    };
                } catch (err) {
                    // 如果 .TW 失敗，嘗試切換一次另一種後綴
                    try {
                        const altSymbol = yahooSymbol.endsWith('.TW') ? `${baseCode}.TWO` : `${baseCode}.TW`;
                        const altQuote = await yahooFinance.quote(altSymbol);
                        if (altQuote) {
                            return {
                                symbol: s,
                                name: altQuote.longName || altQuote.shortName || baseCode,
                                price: altQuote.regularMarketPrice || 0,
                                changePercent: altQuote.regularMarketChangePercent || 0,
                                volume: (altQuote.regularMarketVolume || 0) / 1000,
                                amount: (altQuote.regularMarketPrice * (altQuote.regularMarketVolume || 0)) / 10000,
                                lastUpdate: altQuote.regularMarketTime || new Date()
                            };
                        }
                    } catch (e2) { }
                    return null;
                }
            }));
            results = yahooResults.filter(r => r !== null);
            console.log(`✅ [備援] Yahoo 回傳 ${results.length} 筆資料`);
        } catch (err) {
            console.error('❌ [備援] Yahoo 嚴重錯誤:', err.message);
        }
    }

    return results;
}

module.exports = { fetchRealtimeData };
