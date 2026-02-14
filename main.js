// main.js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const { runAnalysis } = require('./lib/monitor');
const { runBacktest } = require('./lib/backtest');
const { runOptimization } = require('./lib/optimizer'); // ✅ 已經正確移到最上方
require('dotenv').config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const watchList = ['2330.TW', '2454.TW', 'NVDA'];

// 產生即時分析的圖文卡片
function createReportEmbed(report) {
  return new EmbedBuilder()
    .setColor(report.percent >= 0 ? 0xff0000 : 0x00ff00)
    .setTitle(`📈 ${report.symbol} 整合大數據報告`)
    .addFields(
      { name: '💰 最新價格', value: `$${report.price} (${report.percent >= 0 ? '+' : ''}${report.percent}%)`, inline: true },
      { name: '📉 技術指標', value: `RSI: ${report.rsi}\n${report.bbStatus}`, inline: true },
      { name: '🌬️ 局勢風向', value: report.sentiment, inline: true },
      { name: '📢 系統警報', value: `**${report.alert}**` },
      { name: '📰 近期局勢', value: report.newsText || '暫無新聞' }
    )
    .setImage(report.chart)
    .setFooter({ text: '自動化量化分析系統' })
    .setTimestamp();
}

client.on('messageCreate', async (msg) => {
  // 忽略機器人自己的訊息
  if (msg.author.bot) return;
  
  // ==============================
  // 1. 即時分析指令 (!check)
  // ==============================
  if (msg.content.startsWith('!check')) {
    const symbol = msg.content.split(' ')[1];
    if (!symbol) return msg.reply('請提供代號，例如：`!check 2317`');

    const replyMsg = await msg.channel.send(`🔍 正在繪製 **${symbol}** 布林通道走勢...`);
    const report = await runAnalysis(symbol);
    
    if (report) await replyMsg.edit({ content: '', embeds: [createReportEmbed(report)] });
    else await replyMsg.edit('❌ 暫時無法獲取資料。');
  }

  // ==============================
  // 2. 歷史回測指令 (!backtest)
  // ==============================
  else if (msg.content.startsWith('!backtest')) {
    const symbol = msg.content.split(' ')[1];
    if (!symbol) return msg.reply('請提供代號，例如：`!backtest 2330`');

    const replyMsg = await msg.channel.send(`⏳ 正在回測 **${symbol}** 過去一年的「RSI 超跌進場」勝率...`);
    const result = await runBacktest(symbol);
    
    if (!result) return replyMsg.edit('❌ 回測失敗，資料不足。');
    if (result.signals === 0) return replyMsg.edit(`📊 **${result.symbol}** 過去一年從未發生過 RSI < 30 的超跌訊號。`);

    const btEmbed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`🧪 ${result.symbol} 歷史回測報告 (過去1年)`)
      .setDescription(`**測試策略**：當 RSI 跌破 30 時買進，觀察後續勝率。`)
      .addFields(
        { name: '🎯 觸發次數', value: `${result.signals} 次`, inline: true },
        { name: '📈 放 5 天勝率', value: `${result.winRate5}%`, inline: true },
        { name: '🚀 放 10 天勝率', value: `${result.winRate10}%`, inline: true },
        { name: '💰 放 10 天平均報酬', value: `${result.avgProfit10}%`, inline: false }
      )
      .setTimestamp();
    
    await replyMsg.edit({ content: '', embeds: [btEmbed] });
  }

  // ==============================
  // 3. 參數最佳化指令 (!optimize)
  // ==============================
  else if (msg.content.startsWith('!optimize')) {
    const symbol = msg.content.split(' ')[1];
    if (!symbol) return msg.reply('請提供代號，例如：`!optimize 2330`');

    const replyMsg = await msg.channel.send(`⚙️ 啟動運算引擎... 正在對 **${symbol}** 過去 3 年的數據進行網格搜索 (Grid Search)...`);
    const optResult = await runOptimization(symbol);
    
    if (!optResult || optResult.topStrategies.length === 0) {
      return replyMsg.edit(`❌ **${symbol}** 資料不足，或找不到具備統計意義的獲利參數。`);
    }

    const optEmbed = new EmbedBuilder()
      .setColor(0xf1c40f) // 金色
      .setTitle(`⚙️ ${optResult.symbol} 策略參數最佳化報告`)
      .setDescription(`分析過去 3 年共 **${optResult.dataPoints}** 個交易日，暴力運算出的最佳進場參數：`)
      .setTimestamp();

    optResult.topStrategies.forEach((strat, index) => {
      let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
      optEmbed.addFields({
        name: `${medal} 最佳策略 ${index + 1}`,
        value: `**條件**：當 RSI 跌破 **${strat.rsiLimit}** 時買進\n` +
               `**出場**：持有 **${strat.holdDays}** 天後賣出\n` +
               `**勝率**：${strat.winRate}% (觸發 ${strat.signals} 次)\n` +
               `**平均報酬**：**${strat.avgProfit}%**`
      });
    });

    await replyMsg.edit({ content: '', embeds: [optEmbed] });
  }
});

// 定時廣播排程 (選項)
cron.schedule('30 14 * * 1-5', async () => {
  console.log('⏰ 執行例行性監控報告...');
  const channel = client.channels.cache.find(c => c.name === '股票通知'); 
  if (!channel) return;

  for (const s of watchList) {
    const report = await runAnalysis(s);
    if (report) channel.send({ embeds: [createReportEmbed(report)] });
    await new Promise(r => setTimeout(r, 2000));
  }
}, { timezone: "Asia/Taipei" });

client.on('ready', () => {
  console.log(`🤖 ${client.user.tag} 系統上線！`);
  console.log(`支援指令：!check [代號] / !backtest [代號] / !optimize [代號]`);
});

client.login(process.env.DISCORD_TOKEN);