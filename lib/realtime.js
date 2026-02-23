// lib/realtime.js
const axios = require('axios');

/**
 * 從證交所基本市況報導 (mis.twse.com.tw) 抓取即時資料
 * @param {string[]} symbols 標的代號陣列 (例如: ['2330.TW', '03001P.TW'])
 */
async function fetchRealtimeData(symbols) {
    if (!symbols || symbols.length === 0) return [];

    const queryString = symbols.map(s => {
        const code = s.split('.')[0].toLowerCase();
        let market = 'tse';
        if (code.startsWith('7')) market = 'otc';
        return `${market}_${code}.tw`;
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
            // 🐛 診斷日誌：紀錄第一筆資料的所有欄位，幫助確認欄位名稱
            console.log('📝 [交易所原始資料範例]:', JSON.stringify(response.data.msgArray[0]));

            return response.data.msgArray.map(m => {
                // 🛡️ 多重欄位匹配
                const code = m.c || m.ch || s.split('.')[0];
                const name = m.n || m.nf || `權證 ${code}`;

                // z: 最新成交, y: 昨收, tv: 累計成交量
                const currentPrice = parseFloat(m.z) || parseFloat(m.y) || 0;
                const yesterdayPrice = parseFloat(m.y) || 0;
                const totalVolume = parseInt(m.tv) || 0;

                let changePercent = 0;
                if (yesterdayPrice > 0) {
                    changePercent = ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100;
                }

                return {
                    symbol: `${(code || '').toUpperCase()}.TW`,
                    name: name,
                    price: isFinite(currentPrice) ? currentPrice : 0,
                    changePercent: parseFloat((isFinite(changePercent) ? changePercent : 0).toFixed(2)),
                    volume: isFinite(totalVolume) ? totalVolume : 0,
                    amount: parseFloat((isFinite(currentPrice * totalVolume) ? (currentPrice * totalVolume * 1000) / 10000 : 0).toFixed(2)),
                    lastUpdate: m.tlong ? new Date(parseInt(m.tlong)) : new Date()
                };
            });
        }

        console.warn(`⚠️ [交易所] 回傳無效結構:`, JSON.stringify(response.data));
        return [];
    } catch (error) {
        console.error(`❌ 即時資料抓取失敗: ${error.message}`);
        return [];
    }
}

module.exports = { fetchRealtimeData };
