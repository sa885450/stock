// lib/database.js
const mongoose = require('mongoose');

const MONGO_URI = 'mongodb://127.0.0.1:27017/stock_system';

// --- A. 基礎台股資料 ---
const stockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  date: { type: Date, required: true, index: true },
  open: Number, high: Number, low: Number, close: Number, volume: Number, adjClose: Number
}, { timestamps: true });
stockSchema.index({ symbol: 1, date: 1 }, { unique: true });

// --- B. 冷資料歸檔 ---
const stockArchiveSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  date: { type: Date, required: true, index: true },
  open: Number, high: Number, low: Number, close: Number, volume: Number, adjClose: Number
}, { timestamps: true });
stockArchiveSchema.index({ symbol: 1, date: 1 });

// --- C. 資料審計日誌 ---
const auditSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  symbol: { type: String, required: true, index: true },
  yahooPrice: Number, twsePrice: Number, diffPercent: Number, status: { type: String, default: 'ERROR' }
}, { timestamps: true });

// --- D. 關聯網架構 ---
const relationSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  relatedSymbol: { type: String, required: true },
  type: { type: String, required: true },
  weight: { type: Number, default: 1 },
  lagDays: { type: Number, default: 0 },
  leadScore: { type: Number, default: 0 }
}, { timestamps: true });
relationSchema.index({ symbol: 1, relatedSymbol: 1 }, { unique: true });

// --- E. ✨ 新增：情緒指標資料 (v8.3) ---
const sentimentSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  date: { type: Date, default: Date.now },
  score: { type: Number, default: 50 }, // 0=極度悲觀, 100=極度樂觀
  analystBuy: Number,  // 分析師建議買進數
  analystSell: Number, // 分析師建議賣出數
  source: { type: String, default: 'AnalystTrend' }
}, { timestamps: true });
sentimentSchema.index({ symbol: 1, date: -1 });

// --- F. 其他模型 ---
const globalSchema = new mongoose.Schema({ symbol: { type: String, index: true }, date: { type: Date, index: true }, close: Number, changePercent: Number }, { timestamps: true });
globalSchema.index({ symbol: 1, date: 1 }, { unique: true });
const intradaySchema = new mongoose.Schema({ symbol: { type: String, unique: true }, price: Number, changePercent: Number, volume: Number, lastUpdate: { type: Date, default: Date.now } });
const backtestSchema = new mongoose.Schema({ date: { type: String, index: true }, targetDate: String, lookbackDays: Number, winRate: Number, avgReturn: Number, topStocksCount: Number, details: Array }, { timestamps: true });
const marketSchema = new mongoose.Schema({ symbol: { type: String, default: '^TWII' }, date: { type: Date, required: true }, open: Number, close: Number, volume: Number }, { timestamps: true });
marketSchema.index({ symbol: 1, date: 1 }, { unique: true });
const eventSchema = new mongoose.Schema({ symbol: String, date: String, type: String, details: String, value: Number });
eventSchema.index({ symbol: 1, date: 1 });
const chipSchema = new mongoose.Schema({ symbol: String, date: Date, foreignBuy: Number, investmentBuy: Number, dealerBuy: Number });
chipSchema.index({ symbol: 1, date: 1 }, { unique: true });
const marginSchema = new mongoose.Schema({ symbol: String, date: Date, marginBalance: Number });
marginSchema.index({ symbol: 1, date: 1 }, { unique: true });
const fundamentalSchema = new mongoose.Schema({ symbol: String, date: Date, peRatio: Number, eps: Number, sector: String, industry: String, institutionHeld: Number, freeCashFlow: Number, debtToEquity: Number });
fundamentalSchema.index({ symbol: 1, date: 1 }, { unique: true });
const revenueSchema = new mongoose.Schema({ symbol: String, date: String, revenue: Number, yoY: Number });
revenueSchema.index({ symbol: 1, date: 1 }, { unique: true });
const snapshotSchema = new mongoose.Schema({ date: { type: String, index: true }, symbol: { type: String, index: true }, score: Number, price: Number, percent: Number, rsValue: Number, beta: Number, volatility: Number, tags: [String], details: Object, macroView: String }, { timestamps: true });
snapshotSchema.index({ date: 1, score: -1 });

const StockData = mongoose.model('StockData', stockSchema);
const StockDataArchive = mongoose.model('StockDataArchive', stockArchiveSchema);
const DataAuditLog = mongoose.model('DataAuditLog', auditSchema);
const GlobalMarketData = mongoose.model('GlobalMarketData', globalSchema);
const RelationData = mongoose.model('RelationData', relationSchema);
const SentimentData = mongoose.model('SentimentData', sentimentSchema); // ✨ Export
const IntradaySnapshot = mongoose.model('IntradaySnapshot', intradaySchema);
const BacktestResult = mongoose.model('BacktestResult', backtestSchema);
const MarketData = mongoose.model('MarketData', marketSchema);
const EventData = mongoose.model('EventData', eventSchema);
const ChipData = mongoose.model('ChipData', chipSchema);
const MarginData = mongoose.model('MarginData', marginSchema);
const FundamentalData = mongoose.model('FundamentalData', fundamentalSchema);
const RevenueData = mongoose.model('RevenueData', revenueSchema);
const AnalysisSnapshot = mongoose.model('AnalysisSnapshot', snapshotSchema);

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB 連線成功 (v8.3 全域戰略版)');
  } catch (err) {
    console.error('❌ MongoDB 連線失敗:', err.message);
    process.exit(1);
  }
}

module.exports = { 
  connectDB, StockData, StockDataArchive, DataAuditLog, GlobalMarketData, RelationData, SentimentData, IntradaySnapshot, BacktestResult,
  MarketData, EventData, ChipData, MarginData, FundamentalData, RevenueData, AnalysisSnapshot 
};