import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { MarketDataService } from './marketData.js';
import { NotificationManager } from './notifier.js';
import { StrategyScanner } from './scanner.js';
import { calculateRiskAndPositionSizing } from './strategy.js';

const PORT = Number(process.env.PORT || 3400);

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));

const marketData = new MarketDataService();
let scanner = null;

const notifier = new NotificationManager(
  () => scanner?.getSettings() || {},
  (partial) => scanner?.updateSettings(partial),
  () => scanner?.getSnapshot()
);

scanner = new StrategyScanner(marketData, notifier);

// --- REST API ENDPOINTS ---

app.get('/api/snapshot', (req, res) => {
  res.json(scanner.getSnapshot());
});

app.get('/api/chart/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    const universe = scanner.getUniverse();
    const stockMeta = universe.find((s) => s.symbol === symbol) || {
      symbol,
      name: symbol,
      index: symbol.includes('.') ? 'DAX' : 'SP500',
      sector: 'Individuell',
      profile: 'conservative',
      currency: symbol.includes('.') ? 'EUR' : 'USD'
    };

    let m10Bars = scanner.getM10ChartData(symbol);
    let record = scanner.stockResults.get(symbol);

    // Falls noch keine M10-Kerzen geladen sind oder Refresh gewünscht, live laden
    if (!m10Bars || m10Bars.length === 0 || req.query.refresh === '1') {
      const quotes = await marketData.fetchBatchQuotes([symbol]);
      record = await scanner.evaluateSingleStock(stockMeta, quotes.get(symbol), {
        fetchIntraday: true,
        forceRefresh: req.query.refresh === '1'
      });
      m10Bars = scanner.getM10ChartData(symbol);
    }

    res.json({
      symbol,
      record,
      m10Bars: m10Bars.slice(-120) // Letzte 120 M10-Kerzen für flüssige Darstellung
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    const snapshot = await scanner.runFullScan({ reason: 'manual_button' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calculate-sizing', (req, res) => {
  try {
    const settings = scanner.getSettings();
    const result = calculateRiskAndPositionSizing({
      entryPrice: Number(req.body.entryPrice),
      lodPrice: Number(req.body.lodPrice),
      accountCapital: Number(req.body.accountCapital || settings.accountCapital || 10000),
      maxRiskPct: Number(req.body.maxRiskPct || settings.maxRiskPct || 5.0),
      noiseBufferPct: Number(req.body.noiseBufferPct ?? settings.noiseBufferPct ?? 0.20),
      stockProfile: req.body.stockProfile || 'conservative',
      customLeverage: req.body.customLeverage ? Number(req.body.customLeverage) : null,
      customCertPrice: req.body.customCertPrice ? Number(req.body.customCertPrice) : null,
      certRatio: req.body.certRatio ? Number(req.body.certRatio) : 0.1
    });
    res.json({ sizing: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = scanner.updateSettings(req.body || {});
    res.json({ ok: true, settings: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/telegram/detect-chat', async (req, res) => {
  try {
    const token = req.body.telegramBotToken || scanner.getSettings().telegramBotToken;
    const result = await notifier.detectTelegramChatId(token);
    if (result.found) {
      scanner.updateSettings({
        telegramBotToken: token,
        telegramChatId: result.chatId,
        telegramEnabled: true
      });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ found: false, error: err.message });
  }
});

app.post('/api/telegram/test', async (req, res) => {
  try {
    if (req.body.telegramBotToken || req.body.telegramChatId) {
      scanner.updateSettings({
        telegramBotToken: req.body.telegramBotToken ?? scanner.getSettings().telegramBotToken,
        telegramChatId: req.body.telegramChatId ?? scanner.getSettings().telegramChatId,
        telegramEnabled: true
      });
    }

    const settings = scanner.getSettings();
    const testSizing = calculateRiskAndPositionSizing({
      entryPrice: 96.50,
      lodPrice: 95.40,
      accountCapital: settings.accountCapital || 10000,
      maxRiskPct: settings.maxRiskPct || 5.0,
      noiseBufferPct: 0.21,
      stockProfile: 'conservative',
      customLeverage: 8,
      customCertPrice: 1.20
    });

    const alert = await notifier.dispatchSimultaneousAlert(
      {
        kind: 'STRATEGY_SIGNAL',
        symbol: 'SY1.DE',
        name: 'Symrise AG (Test-Lead)',
        index: 'DAX 40',
        currency: '€',
        phase: 4,
        phaseBadge: '🟢 NEUER LEAD (TEST)',
        title: 'TEST-LEAD: Gleichzeitige Benachrichtigung (Web-Dashboard + Telegram)',
        message: 'Test erfolgreich! Du wirst ausschließlich benachrichtigt, wenn sich ein konkreter Kauf-Lead (Phase 4 Entry) ergibt und sobald du diesen Lead wieder closen sollst (Take-Profit / Stagnation oder Stop-Loss) – alle Kurse in Euro (€).',
        price: 96.50,
        lodPrice: 95.40,
        distanceFromLodPct: 1.15,
        barsSinceFirstLow: 5,
        intradayChangePct: -8.96,
        dipFromSwingHighPct: -8.96,
        rsi14: 38.4,
        ema20: 96.32,
        vwap: 96.18,
        peReason: 'Attraktives 5-Jahres-KGV nach Quartalszahlen-Dip (18.9x Fwd)',
        confluenceSignals: [
          { name: 'Bullische RSI-Divergenz (M10)', active: true },
          { name: 'Volumen-Divergenz (Climax vs. Retest)', active: true },
          { name: 'Rückeroberung M10 EMA 20 / VWAP', active: true },
          { name: 'Hammer-Absorption am Tagestief 95,40 €', active: true }
        ],
        confluenceCount: 4,
        sizing: testSizing,
        demoAccount: scanner.getDemoMetrics()
      },
      { forceTelegram: true }
    );

    res.json({ ok: true, alert });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/simulate-case-study', async (req, res) => {
  try {
    const stage = req.body.stage || 'phase4_entry';
    const result = await scanner.triggerCaseStudySimulation(stage);
    res.json({ ok: true, ...result, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/demo/reset', (req, res) => {
  try {
    const initialBalanceEuro = Number(req.body?.initialBalanceEuro || 10000);
    const demoAccount = scanner.resetDemoAccount(initialBalanceEuro);
    res.json({ ok: true, demoAccount, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/demo/toggle', (req, res) => {
  try {
    const demoAccount = scanner.toggleDemoAutoTrade(Boolean(req.body?.autoTradeEnabled));
    res.json({ ok: true, demoAccount, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    const entry = scanner.addCustomStock(req.body || {});
    const quotes = await marketData.fetchBatchQuotes([entry.symbol]);
    const record = await scanner.evaluateSingleStock(entry, quotes.get(entry.symbol), {
      fetchIntraday: true,
      forceRefresh: true
    });
    res.json({ ok: true, stock: entry, record, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/watchlist/:symbol', (req, res) => {
  try {
    scanner.removeCustomStock(req.params.symbol);
    res.json({ ok: true, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/trades', (req, res) => {
  try {
    const trade = scanner.openActiveTrade(req.body || {});
    res.json({ ok: true, trade, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/trades/:id/close', (req, res) => {
  try {
    const journalEntry = scanner.closeActiveTrade(
      req.params.id,
      req.body.exitPrice,
      req.body.exitReason
    );
    res.json({ ok: true, journalEntry, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- HTTP & WEBSOCKET SERVER STARTEN ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  notifier.registerWsClient(ws);
  ws.send(
    JSON.stringify({
      type: 'INITIAL_SNAPSHOT',
      snapshot: scanner.getSnapshot()
    })
  );
});

server.listen(PORT, () => {
  console.log(`🚀 Antizyklischer Mean-Reversion Scanner läuft auf http://localhost:${PORT}`);
  scanner.startAutoScan();
  notifier.startTelegramCommandListener();
});
