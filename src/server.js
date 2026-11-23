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
    const account = String(req.body?.account || 'main').toLowerCase();
    const resyncFromMain = Boolean(req.body?.resyncFromMain);
    if (account === 'reverse') {
      const reverseDemoAccount = scanner.resetReverseDemoAccount(initialBalanceEuro, resyncFromMain);
      res.json({ ok: true, reverseDemoAccount, snapshot: scanner.getSnapshot() });
      return;
    }
    if (account === 'daily_long' || account === 'daily_short') {
      const side = account === 'daily_short' ? 'short' : 'long';
      const dailyAccount = scanner.resetDailyAccount(side, initialBalanceEuro);
      res.json({ ok: true, dailyAccount, snapshot: scanner.getSnapshot() });
      return;
    }
    const demoAccount = scanner.resetDemoAccount(initialBalanceEuro);
    res.json({ ok: true, demoAccount, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/demo/toggle', (req, res) => {
  try {
    const account = String(req.body?.account || 'main').toLowerCase();
    if (account === 'reverse') {
      const reverseDemoAccount = scanner.toggleReverseDemoAutoTrade(Boolean(req.body?.autoTradeEnabled));
      res.json({ ok: true, reverseDemoAccount, snapshot: scanner.getSnapshot() });
      return;
    }
    if (account === 'daily_long' || account === 'daily_short') {
      const side = account === 'daily_short' ? 'short' : 'long';
      const dailyAccount = scanner.toggleDailyAutoTrade(side, Boolean(req.body?.autoTradeEnabled));
      res.json({ ok: true, dailyAccount, snapshot: scanner.getSnapshot() });
      return;
    }
    const demoAccount = scanner.toggleDemoAutoTrade(Boolean(req.body?.autoTradeEnabled));
    res.json({ ok: true, demoAccount, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/watchlist/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const results = await marketData.searchSymbols(q);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    let payload = { ...(req.body || {}) };
    const rawInput = String(payload.symbol || payload.query || '').trim();
    if (!rawInput) throw new Error('Bitte Ticker-Symbol oder Aktiennamen eingeben');

    // Falls kein Name übergeben wurde oder ein Firmenname gesucht wird, automatisch per Yahoo Search auflösen
    if (!payload.name || rawInput.includes(' ') || rawInput.length > 6) {
      const matches = await marketData.searchSymbols(rawInput);
      const exact = matches.find((m) => m.symbol.toUpperCase() === rawInput.toUpperCase());
      const best = exact || matches[0];
      if (best) {
        payload = {
          ...best,
          ...payload,
          symbol: best.symbol,
          name: payload.name || best.name
        };
      }
    }

    const entry = scanner.addCustomStock(payload);
    const quotes = await marketData.fetchBatchQuotes([entry.symbol]);
    const q = quotes.get(entry.symbol);
    if (q?.shortName && (!entry.name || entry.name === entry.symbol)) {
      entry.name = q.shortName;
      scanner.addCustomStock(entry);
    }
    const record = await scanner.evaluateSingleStock(entry, q, {
      fetchIntraday: true,
      forceRefresh: true
    });
    scanner.refreshNewsFeed({ symbol: entry.symbol }).catch(() => {});
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

app.post('/api/watchlist/restore', async (req, res) => {
  try {
    scanner.restoreDefaultUniverse();
    scanner.runFullScan({ reason: 'restore_universe' }).catch(() => {});
    res.json({ ok: true, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const symbol = req.query.symbol ? String(req.query.symbol).trim().toUpperCase() : null;
    const forceRefresh = req.query.refresh === '1';
    const news = await scanner.refreshNewsFeed({ symbol, forceRefresh });
    res.json({ ok: true, news });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/trades', (req, res) => {
  try {
    const account = String(req.body?.account || 'main').toLowerCase();
    let trade;
    if (account === 'reverse') {
      trade = scanner.openReverseActiveTrade(req.body || {});
    } else if (account === 'daily_long') {
      trade = scanner.openDailyTrade('long', req.body || {});
    } else if (account === 'daily_short') {
      trade = scanner.openDailyTrade('short', req.body || {});
    } else {
      trade = scanner.openActiveTrade(req.body || {});
    }
    res.json({ ok: true, trade, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/demo/live', (req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    demoAccount: scanner.getDemoMetrics(),
    activeTrades: scanner.state.activeTrades,
    journal: scanner.state.journal.slice(0, 20),
    reverseDemoAccount: scanner.getReverseDemoMetrics(),
    reverseActiveTrades: scanner.state.reverseActiveTrades,
    reverseJournal: scanner.state.reverseJournal.slice(0, 20),
    dailySession: scanner.getDailySessionPayload(),
    dailyAccountsHistory: scanner.state.dailyAccountsHistory || []
  });
});

app.get('/api/demo/daily-history', (req, res) => {
  res.json({
    ok: true,
    dailySession: scanner.getDailySessionPayload(),
    dailyAccountsHistory: scanner.state.dailyAccountsHistory || []
  });
});

app.post('/api/trades/:id/close', (req, res) => {
  try {
    const tradeId = String(req.params.id || '');
    const account = String(req.body?.account || '').toLowerCase();
    const ds = scanner.state.dailySession;
    const isDailyLong = account === 'daily_long' || tradeId.startsWith('daily_long_') ||
      (ds?.longActiveTrades || []).some((t) => t.id === tradeId);
    const isDailyShort = account === 'daily_short' || tradeId.startsWith('daily_short_') ||
      (ds?.shortActiveTrades || []).some((t) => t.id === tradeId);
    const isReverse = account === 'reverse' ||
      tradeId.startsWith('rev_') ||
      scanner.state.reverseActiveTrades.some((t) => t.id === tradeId);

    let journalEntry;
    if (isDailyLong) {
      journalEntry = scanner.closeDailyTrade('long', tradeId, req.body?.exitPrice, req.body?.exitReason);
    } else if (isDailyShort) {
      journalEntry = scanner.closeDailyTrade('short', tradeId, req.body?.exitPrice, req.body?.exitReason);
    } else if (isReverse) {
      journalEntry = scanner.closeReverseActiveTrade(tradeId, req.body?.exitPrice, req.body?.exitReason);
    } else {
      journalEntry = scanner.closeActiveTrade(tradeId, req.body?.exitPrice, req.body?.exitReason);
    }
    res.json({ ok: true, journalEntry, snapshot: scanner.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- HTTP & WEBSOCKET SERVER STARTEN ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  notifier.registerWsClient(ws);
  scanner.setWatchedSymbol(clientId, 'SY1.DE');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'WATCH_SYMBOL' && msg.symbol) {
        scanner.setWatchedSymbol(clientId, msg.symbol);
      }
    } catch {
      // Ignore malformed WS message
    }
  });

  ws.on('close', () => {
    scanner.removeWatchedClient(clientId);
  });

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
