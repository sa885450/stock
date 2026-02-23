// lib/realtime.js
const axios = require('axios');

/**
 * 從證交所基本市況報導 (mis.twse.com.tw) 抓取即時資料
 * @param {string[]} symbols 標的代號陣列 (例如: ['2330.TW', '03001P.TW'])
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // 自動偵測市場 (上市 tse / 上櫃 otc)
    // 規則：6 碼代號中，開頭為 7 的通常是上櫃 (OTC)，其餘多為上市 (TSE)
    // 為了保險，對於權證我們可以同時查詢兩個市場
    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toUpperCase();
        if (code.length === 6 && code.startsWith('7')) {
            return `otc_${code.toLowerCase()}.tw|tse_${code.toLowerCase()}.tw`;
        }
        return `tse_${code.toLowerCase()}.tw|otc_${code.toLowerCase()}.tw`;
    }).join('|');

    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${queryString}&json=1&delay=0`;

    try {
        const response = await axios.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (response.data && response.data.msgArray) {
            // 過濾掉無效的回傳 (名稱為空的)
            return response.data.msgArray
                .filter(m => m.n && m.n.trim() !== '')
                .map(m => {
                    const currentPrice = parseFloat(m.z) || parseFloat(m.y) || 0;
                    const yesterdayPrice = parseFloat(m.y) || 0;
                    const totalVolume = parseInt(m.tv) || 0;

                    let changePercent = 0;
                    if (yesterdayPrice > 0) {
                        changePercent = ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100;
                    }

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
