import fs from 'node:fs';
import path from 'node:path';
import {
  BENCHMARK_INDICES,
  DEFAULT_UNIVERSE,
  checkReferenceMarketOpen
} from './universe.js';
import {
  resampleToM10,
  enrichM10Indicators,
  findDailySupportZones,
  evaluateFundamentalAndFilters,
  analyzeM10BottomFormation,
  evaluateBuyStrategyEntry,
  calculateRiskAndPositionSizing,
  evaluateActiveTrade,
  evaluateReverseActiveTrade,
  buildPreTradeChecklist,
  generatePlaybookCaseStudyBars
} from './strategy.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '8545580896:AAH_cLbkPJMpfnhjdo5t5bhh5dde38EWE6I';
const DEFAULT_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || '9065309684';

const DEFAULT_SETTINGS = {
  accountCapital: 10000,
  maxRiskPct: 5.0,
  noiseBufferPct: 0.20,
  minDipPct: -2.0,
  minAlertPhase: 4,
  scanIntervalSec: 60,
  soundAlertsEnabled: true,
  browserNotificationsEnabled: true,
  telegramEnabled: true,
  telegramBotToken: DEFAULT_BOT_TOKEN,
  telegramBotUsername: 'PureSiteTrading_bot',
  telegramChatId: DEFAULT_CHAT_ID
};

const DEFAULT_DEMO_ACCOUNT = {
  autoTradeEnabled: true,
  initialBalanceEuro: 10000,
  cashEuro: 10000,
  realizedPnlEuro: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  equityCurve: [
    {
      time: new Date().toISOString(),
      equityEuro: 10000,
      label: 'Startkapital'
    }
  ],
  orderHistory: []
};

function getBerlinDateStr(dateInput = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(dateInput));
  } catch {
    return new Date(dateInput).toISOString().slice(0, 10);
  }
}

function createEmptyDailySession(dateStr = getBerlinDateStr()) {
  const nowIso = new Date().toISOString();
  return {
    date: dateStr,
    longAccount: {
      autoTradeEnabled: true,
      initialBalanceEuro: 10000,
      cashEuro: 10000,
      realizedPnlEuro: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      equityCurve: [{ time: nowIso, equityEuro: 10000, label: `Tagesstart ${dateStr} (Long)` }],
      orderHistory: []
    },
    shortAccount: {
      autoTradeEnabled: true,
      initialBalanceEuro: 10000,
      cashEuro: 10000,
      realizedPnlEuro: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      equityCurve: [{ time: nowIso, equityEuro: 10000, label: `Tagesstart ${dateStr} (Short)` }],
      orderHistory: []
    },
    longActiveTrades: [],
    shortActiveTrades: [],
    longJournal: [],
    shortJournal: []
  };
}

export class StrategyScanner {
  constructor(marketData, notifier) {
    this.marketData = marketData;
    this.notifier = notifier;
    this.state = this.loadState();

    this.isScanning = false;
    this.lastScanAt = null;
    this.nextScanAt = null;
    this.scanTimer = null;
    this.demoLiveTimer = null;
    this.isDemoTickRunning = false;
    this.watchedSymbols = new Map(); // clientId -> symbol

    // Live Wechselkurse nach EUR (Fallback: 1 USD = 0.92 EUR, 1 CHF = 1.06 EUR)
    this.fxToEur = {
      EUR: 1.0,
      USD: 0.925,
      CHF: 1.065
    };

    this.indexRegimes = {};
    this.stockResults = new Map();
    this.m10Store = new Map();
    this.newsItems = [];
    this.newsTimer = null;

    this.ensureReverseAccountBackfilled();
    this.ensureDailyAccountsInitialized();
  }

  /**
   * Falls Account 2 (Reverse-Strategie / Turbo-Short) neu angelegt wurde und noch keine Trades hat,
   * aber Account 1 bereits historische/offene Trades besitzt, spiegeln wir diese als echten A/B-Test-Vergleich
   * (jeder Long-Einstieg von Account 1 als entgegengesetzter Short-Trade in Account 2).
   */
  ensureReverseAccountBackfilled() {
    const revDemo = this.state.reverseDemoAccount;
    const revTrades = this.state.reverseActiveTrades || [];
    const revJournal = this.state.reverseJournal || [];
    const mainJournal = this.state.journal || [];
    const mainActive = this.state.activeTrades || [];

    if (
      revDemo &&
      revTrades.length === 0 &&
      revJournal.length === 0 &&
      (mainJournal.length > 0 || mainActive.length > 0)
    ) {
      this.syncReverseFromMainHistory();
    }
  }

  ensureDailyAccountsInitialized() {
    const hasSession = Boolean(this.state.dailySession && this.state.dailySession.date);
    if (!hasSession) {
      this.backfillDailyAccountsFromJournals();
    } else {
      this.rolloverDailyAccountsIfNeeded();
    }
  }

  replayDailySideTrades(tradesList = [], dateStr, side = 'long') {
    const startCap = 10000;
    let realizedPnl = 0;
    let wins = 0;
    let losses = 0;
    const chrono = [...tradesList].sort(
      (a, b) => new Date(a.closedAt || a.openedAt || 0) - new Date(b.closedAt || b.openedAt || 0)
    );
    const replayed = [];
    const equityCurve = [{ time: `${dateStr}T08:00:00.000Z`, equityEuro: startCap, label: `Tagesstart ${dateStr}` }];
    const orderHistory = [];

    for (const t of chrono) {
      const currentEq = Math.max(250, startCap + realizedPnl);
      const maxPos = Math.round(currentEq * 0.25 * 100) / 100;
      const origSize = Number(t.positionSizeEuro || 2000);
      const dailySize = Math.round(Math.min(origSize, maxPos) * 100) / 100;
      const derivGainPct = Number(t.derivGainPct || 0);
      const pnlEuro = Math.round(dailySize * (derivGainPct / 100) * 100) / 100;
      const payoutEuro = Math.max(0, Math.round((dailySize + pnlEuro) * 100) / 100);

      realizedPnl = Math.round((realizedPnl + pnlEuro) * 100) / 100;
      if (pnlEuro >= 0) wins++;
      else losses++;

      const eqAfter = Math.round((startCap + realizedPnl) * 100) / 100;
      const entry = {
        ...t,
        id: `daily_${side}_${dateStr}_${t.id || Math.random().toString(36).slice(2, 6)}`,
        direction: side === 'short' ? 'SHORT' : 'LONG',
        dailyDate: dateStr,
        positionSizeEuro: Math.round(dailySize),
        payoutEuro,
        pnlEuro,
        demoEquityAfterEuro: eqAfter
      };
      replayed.unshift(entry);
      equityCurve.push({
        time: t.closedAt || new Date().toISOString(),
        equityEuro: eqAfter,
        pnlEuro,
        label: `${side === 'short' ? 'SHORT' : 'LONG'} ${t.symbol} (${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} €)`
      });
      orderHistory.unshift({
        id: `daily_ord_${side}_${dateStr}_${t.symbol}`,
        action: 'SELL',
        timestamp: t.closedAt || new Date().toISOString(),
        time: t.closedAt || new Date().toISOString(),
        side: side === 'short' ? 'COVER (SHORT)' : 'SELL (LONG)',
        symbol: t.symbol,
        name: t.name,
        entryPriceEuro: t.entryPrice,
        exitPriceEuro: t.exitPrice,
        leverage: t.leverage,
        payoutEuro,
        amountEuro: payoutEuro,
        pnlEuro,
        derivGainPct,
        rMultiple: t.rMultiple,
        note: t.exitReason
      });
    }

    const totalTrades = chrono.length;
    const winRatePct = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;
    const endEquityEuro = Math.round((startCap + realizedPnl) * 100) / 100;
    const dailyReturnPct = Math.round(((endEquityEuro - startCap) / startCap) * 10000) / 100;

    return {
      account: {
        autoTradeEnabled: true,
        initialBalanceEuro: startCap,
        cashEuro: Math.max(0, endEquityEuro),
        realizedPnlEuro: realizedPnl,
        totalTrades,
        wins,
        losses,
        equityCurve: equityCurve.slice(-60),
        orderHistory: orderHistory.slice(0, 50)
      },
      summary: {
        initialBalanceEuro: startCap,
        endEquityEuro,
        dailyPnlEuro: realizedPnl,
        dailyReturnPct,
        totalTrades,
        wins,
        losses,
        winRatePct
      },
      journal: replayed
    };
  }

  backfillDailyAccountsFromJournals() {
    const todayStr = getBerlinDateStr();
    const byDay = new Map();

    for (const j of this.state.journal || []) {
      const d = getBerlinDateStr(j.closedAt || j.openedAt || Date.now());
      if (!byDay.has(d)) byDay.set(d, { long: [], short: [] });
      byDay.get(d).long.push(j);
    }
    for (const rj of this.state.reverseJournal || []) {
      const d = getBerlinDateStr(rj.closedAt || rj.openedAt || Date.now());
      if (!byDay.has(d)) byDay.set(d, { long: [], short: [] });
      byDay.get(d).short.push(rj);
    }

    const history = [];
    let todaySession = createEmptyDailySession(todayStr);

    const sortedDates = Array.from(byDay.keys()).sort();
    for (const d of sortedDates) {
      const bucket = byDay.get(d);
      const longRep = this.replayDailySideTrades(bucket.long, d, 'long');
      const shortRep = this.replayDailySideTrades(bucket.short, d, 'short');

      if (d === todayStr) {
        todaySession = {
          date: todayStr,
          longAccount: longRep.account,
          shortAccount: shortRep.account,
          longActiveTrades: [],
          shortActiveTrades: [],
          longJournal: longRep.journal,
          shortJournal: shortRep.journal
        };
      } else if (d < todayStr) {
        history.unshift({
          date: d,
          longSummary: longRep.summary,
          shortSummary: shortRep.summary,
          longTrades: longRep.journal,
          shortTrades: shortRep.journal
        });
      }
    }

    this.state.dailySession = todaySession;
    this.state.dailyAccountsHistory = history.slice(0, 180);
    this.saveState();
  }

  rolloverDailyAccountsIfNeeded() {
    if (this._isRollingOverDaily) {
      return false;
    }
    const todayStr = getBerlinDateStr();
    if (!this.state.dailySession) {
      this.state.dailySession = createEmptyDailySession(todayStr);
      this.saveState();
      return false;
    }

    if (this.state.dailySession.date === todayStr) {
      return false;
    }

    this._isRollingOverDaily = true;
    try {
      const prev = this.state.dailySession;
      const prevDate = prev.date;

      // Falls im vorherigen Tages-Account noch Positionen offen waren, sauber zum letzten Kurs glattstellen
      for (const t of [...(prev.longActiveTrades || [])]) {
        try {
          this.closeDailyTrade('long', t.id, null, `Tagesabschluss-Rollover (${prevDate})`);
        } catch {
          // ignore
        }
      }
      for (const t of [...(prev.shortActiveTrades || [])]) {
        try {
          this.closeDailyTrade('short', t.id, null, `Tagesabschluss-Rollover (${prevDate})`);
        } catch {
          // ignore
        }
      }

      const longMetrics = this.getDailyMetrics('long', { skipRollover: true });
      const shortMetrics = this.getDailyMetrics('short', { skipRollover: true });

      const dayRecord = {
        date: prevDate,
        longSummary: {
          initialBalanceEuro: longMetrics.initialBalanceEuro,
          endEquityEuro: longMetrics.totalEquityEuro,
          dailyPnlEuro: longMetrics.totalReturnEuro,
          dailyReturnPct: longMetrics.totalReturnPct,
          totalTrades: longMetrics.totalTrades,
          wins: longMetrics.wins,
          losses: longMetrics.losses,
          winRatePct: longMetrics.winRatePct
        },
        shortSummary: {
          initialBalanceEuro: shortMetrics.initialBalanceEuro,
          endEquityEuro: shortMetrics.totalEquityEuro,
          dailyPnlEuro: shortMetrics.totalReturnEuro,
          dailyReturnPct: shortMetrics.totalReturnPct,
          totalTrades: shortMetrics.totalTrades,
          wins: shortMetrics.wins,
          losses: shortMetrics.losses,
          winRatePct: shortMetrics.winRatePct
        },
        longTrades: prev.longJournal || [],
        shortTrades: prev.shortJournal || []
      };

      const existing = (this.state.dailyAccountsHistory || []).filter((h) => h.date !== prevDate);
      this.state.dailyAccountsHistory = [dayRecord, ...existing]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 180);

      this.state.dailySession = createEmptyDailySession(todayStr);
      this.saveState();
      return true;
    } finally {
      this._isRollingOverDaily = false;
    }
  }

  syncReverseFromMainHistory() {
    const startCap = Number(this.state.demoAccount?.initialBalanceEuro || 10000);
    const mainJournalChrono = [...(this.state.journal || [])].reverse();
    const newRevJournal = [];
    const newOrderHistory = [];
    const newEquityCurve = [
      {
        time: new Date().toISOString(),
        equityEuro: startCap,
        label: 'Startkapital (Reverse)'
      }
    ];

    let realizedPnl = 0;
    let wins = 0;
    let losses = 0;

    for (const j of mainJournalChrono) {
      const entryPrice = Number(j.entryPrice || 100);
      const exitPrice = Number(j.exitPrice || entryPrice);
      const origStop = Number(j.stopLossStock || entryPrice * 0.985);
      const riskAbs = Math.max(0.01, Math.abs(entryPrice - origStop));
      const shortStopStock = Math.round((entryPrice + riskAbs) * 100) / 100;
      const leverage = Number(j.leverage || 8);
      const posEuro = Number(j.positionSizeEuro || 1500);

      // Beim Reverse/Short-Trade ist die Kursänderung invertiert: (entryPrice - exitPrice) / entryPrice
      const stockGainPct = ((entryPrice - exitPrice) / entryPrice) * 100;
      const derivGainPct = Math.max(-99, stockGainPct * leverage);
      const pnlEuro = Math.round(posEuro * (derivGainPct / 100) * 100) / 100;
      const payoutEuro = Math.max(0, Math.round((posEuro + pnlEuro) * 100) / 100);
      const rMultiple = (entryPrice - exitPrice) / riskAbs;

      realizedPnl = Math.round((realizedPnl + pnlEuro) * 100) / 100;
      if (pnlEuro >= 0) wins++;
      else losses++;

      const eqAfter = Math.round((startCap + realizedPnl) * 100) / 100;

      const revEntry = {
        ...j,
        id: `rev_${j.id || Date.now()}`,
        direction: 'SHORT',
        strategyMode: 'REVERSE',
        stopLossStock: shortStopStock,
        payoutEuro,
        stockGainPct: Math.round(stockGainPct * 100) / 100,
        derivGainPct: Math.round(derivGainPct * 10) / 10,
        pnlEuro,
        rMultiple: Math.round(rMultiple * 100) / 100,
        demoEquityAfterEuro: eqAfter,
        exitReason: pnlEuro >= 0
          ? `Reverse Take-Profit (Gegenseite zu Account 1)`
          : `Reverse Stop-Loss (Gegenseite zu Account 1)`
      };

      newRevJournal.unshift(revEntry);
      newEquityCurve.push({
        time: j.closedAt || new Date().toISOString(),
        equityEuro: eqAfter,
        pnlEuro,
        label: `${j.symbol} Short (${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} €)`
      });
      newOrderHistory.unshift({
        id: `rev_ord_${j.id || Date.now()}`,
        action: 'SELL',
        timestamp: j.closedAt || new Date().toISOString(),
        time: j.closedAt || new Date().toISOString(),
        side: pnlEuro >= 0 ? 'CLOSE SHORT (PROFIT)' : 'CLOSE SHORT (LOSS)',
        symbol: j.symbol,
        name: j.name,
        entryPriceEuro: entryPrice,
        exitPriceEuro: exitPrice,
        stockPriceEuro: exitPrice,
        leverage,
        payoutEuro,
        amountEuro: payoutEuro,
        pnlEuro,
        derivGainPct: revEntry.derivGainPct,
        rMultiple: revEntry.rMultiple,
        note: revEntry.exitReason
      });
    }

    // Spiegele auch aktuell offene Positionen aus Account 1 als offene Short-Positionen in Account 2
    const newRevActive = [];
    let investedInOpen = 0;
    for (const t of this.state.activeTrades || []) {
      if (t.status !== 'OPEN') continue;
      const entryPrice = Number(t.entryPrice || 100);
      const origStop = Number(t.stopLossStock || entryPrice * 0.985);
      const riskAbs = Math.max(0.01, Math.abs(entryPrice - origStop));
      const shortStopStock = Math.round((entryPrice + riskAbs) * 100) / 100;
      const posEuro = Number(t.positionSizeEuro || 1500);
      investedInOpen += posEuro;

      newRevActive.push({
        ...t,
        id: `rev_${t.id}`,
        direction: 'SHORT',
        strategyMode: 'REVERSE',
        stopLossStock: shortStopStock,
        catalystNote: 'Reverse-Strategie (Turbo-Short gegen Phase-4-Lead)',
        latestEvaluation: null
      });
    }

    const totalCurrentBalance = Math.max(0, Math.round((startCap + realizedPnl - investedInOpen) * 100) / 100);

    this.state.reverseJournal = newRevJournal;
    this.state.reverseActiveTrades = newRevActive;
    this.state.reverseDemoAccount = {
      autoTradeEnabled: true,
      initialBalanceEuro: startCap,
      cashEuro: totalCurrentBalance,
      realizedPnlEuro: realizedPnl,
      totalTrades: mainJournalChrono.length,
      wins,
      losses,
      equityCurve: newEquityCurve.slice(-60),
      orderHistory: newOrderHistory.slice(0, 50)
    };
    this.saveState();
  }

  loadState() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        const mergedSettings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
        if (!mergedSettings.telegramBotToken) {
          mergedSettings.telegramBotToken = DEFAULT_BOT_TOKEN;
        }
        if (!mergedSettings.telegramChatId) {
          mergedSettings.telegramChatId = DEFAULT_CHAT_ID;
        }
        // Nur noch bei echten Leads (Phase 4) und beim Closen benachrichtigen
        mergedSettings.minAlertPhase = 4;
        mergedSettings.telegramBotUsername = 'PureSiteTrading_bot';
        const mergedDemo = {
          ...DEFAULT_DEMO_ACCOUNT,
          ...(raw.demoAccount || {}),
          equityCurve: Array.isArray(raw.demoAccount?.equityCurve) && raw.demoAccount.equityCurve.length > 0
            ? raw.demoAccount.equityCurve
            : [...DEFAULT_DEMO_ACCOUNT.equityCurve],
          orderHistory: Array.isArray(raw.demoAccount?.orderHistory)
            ? raw.demoAccount.orderHistory
            : []
        };
        const mergedReverseDemo = {
          ...DEFAULT_DEMO_ACCOUNT,
          ...(raw.reverseDemoAccount || {}),
          equityCurve: Array.isArray(raw.reverseDemoAccount?.equityCurve) && raw.reverseDemoAccount.equityCurve.length > 0
            ? raw.reverseDemoAccount.equityCurve
            : [...DEFAULT_DEMO_ACCOUNT.equityCurve],
          orderHistory: Array.isArray(raw.reverseDemoAccount?.orderHistory)
            ? raw.reverseDemoAccount.orderHistory
            : []
        };
        return {
          settings: mergedSettings,
          demoAccount: mergedDemo,
          reverseDemoAccount: mergedReverseDemo,
          customStocks: Array.isArray(raw.customStocks) ? raw.customStocks : [],
          hiddenSymbols: Array.isArray(raw.hiddenSymbols) ? raw.hiddenSymbols : [],
          activeTrades: Array.isArray(raw.activeTrades) ? raw.activeTrades : [],
          journal: Array.isArray(raw.journal) ? raw.journal : [],
          reverseActiveTrades: Array.isArray(raw.reverseActiveTrades) ? raw.reverseActiveTrades : [],
          reverseJournal: Array.isArray(raw.reverseJournal) ? raw.reverseJournal : [],
          dailySession: raw.dailySession && raw.dailySession.date ? raw.dailySession : null,
          dailyAccountsHistory: Array.isArray(raw.dailyAccountsHistory) ? raw.dailyAccountsHistory : []
        };
      }
    } catch {
      // Fallback
    }
    return {
      settings: { ...DEFAULT_SETTINGS },
      demoAccount: {
        ...DEFAULT_DEMO_ACCOUNT,
        equityCurve: [...DEFAULT_DEMO_ACCOUNT.equityCurve],
        orderHistory: []
      },
      reverseDemoAccount: {
        ...DEFAULT_DEMO_ACCOUNT,
        equityCurve: [...DEFAULT_DEMO_ACCOUNT.equityCurve],
        orderHistory: []
      },
      customStocks: [],
      hiddenSymbols: [],
      activeTrades: [],
      journal: [],
      reverseActiveTrades: [],
      reverseJournal: [],
      dailySession: null,
      dailyAccountsHistory: []
    };
  }

  saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('Fehler beim Speichern von state.json:', err.message);
    }
  }

  getSettings() {
    return this.state.settings;
  }

  updateSettings(partial) {
    this.state.settings = {
      ...this.state.settings,
      ...partial
    };
    if (!this.state.settings.telegramBotToken) {
      this.state.settings.telegramBotToken = DEFAULT_BOT_TOKEN;
    }
    this.saveState();
    this.restartAutoScan();
    return this.state.settings;
  }

  getUniverse() {
    const hidden = new Set(
      (this.state.hiddenSymbols || []).map((s) => String(s).toUpperCase())
    );
    const map = new Map();
    for (const s of DEFAULT_UNIVERSE) {
      if (!hidden.has(s.symbol)) {
        map.set(s.symbol, s);
      }
    }
    for (const c of this.state.customStocks) {
      if (!hidden.has(c.symbol)) {
        map.set(c.symbol, c);
      }
    }
    return Array.from(map.values());
  }

  addCustomStock(stock) {
    const symbol = String(stock.symbol || '').trim().toUpperCase();
    if (!symbol) throw new Error('Symbol fehlt');

    // Falls es eine ausgeblendete Standard-Aktie war, einfach wieder einblenden
    this.state.hiddenSymbols = (this.state.hiddenSymbols || []).filter(
      (s) => String(s).toUpperCase() !== symbol
    );

    const defaultMatch = DEFAULT_UNIVERSE.find((d) => d.symbol === symbol);
    if (defaultMatch && !stock.name) {
      this.saveState();
      return defaultMatch;
    }

    const isDe = symbol.endsWith('.DE') || symbol.endsWith('.F');
    const isAt = symbol.endsWith('.VI');
    const isCh = symbol.endsWith('.SW');
    const isEu = symbol.endsWith('.PA') || symbol.endsWith('.AS') || symbol.endsWith('.MI') || symbol.endsWith('.MC');

    const entry = {
      symbol,
      name: stock.name || defaultMatch?.name || symbol,
      index: stock.index || defaultMatch?.index || (isDe ? 'DAX' : isAt ? 'ATX' : isCh ? 'SMI' : isEu ? 'EUROSTOXX' : 'SP500'),
      sector: stock.sector || defaultMatch?.sector || 'Watchlist',
      profile: stock.profile || defaultMatch?.profile || 'conservative',
      currency: stock.currency || defaultMatch?.currency || (isCh ? 'CHF' : isDe || isAt || isEu ? 'EUR' : 'USD'),
      isCustom: !defaultMatch
    };
    if (!defaultMatch) {
      this.state.customStocks = [
        ...this.state.customStocks.filter((s) => s.symbol !== symbol),
        entry
      ];
    }
    this.saveState();
    return entry;
  }

  removeCustomStock(symbol) {
    const clean = String(symbol || '').trim().toUpperCase();
    if (!clean) return;
    this.state.customStocks = this.state.customStocks.filter((s) => s.symbol !== clean);
    const inDefault = DEFAULT_UNIVERSE.some((s) => s.symbol === clean);
    if (inDefault) {
      const hidden = new Set(this.state.hiddenSymbols || []);
      hidden.add(clean);
      this.state.hiddenSymbols = Array.from(hidden);
    }
    this.stockResults.delete(clean);
    this.m10Store.delete(clean);
    this.saveState();
  }

  restoreDefaultUniverse() {
    this.state.hiddenSymbols = [];
    this.saveState();
  }

  startAutoScan() {
    this.restartAutoScan();
    this.startDemoLiveTicker();
    this.startNewsTracker();
    this.runFullScan({ reason: 'initial' })
      .then(() => this.refreshNewsFeed({ forceRefresh: true }))
      .catch((err) => {
        console.error('Initialer Scan-Fehler:', err.message);
      });
  }

  startNewsTracker() {
    if (this.newsTimer) clearInterval(this.newsTimer);
    // Initial direkt nach Start abrufen + alle 3 Minuten automatisch aktualisieren
    setTimeout(() => {
      this.refreshNewsFeed().catch(() => {});
    }, 2500);
    this.newsTimer = setInterval(() => {
      this.refreshNewsFeed().catch((err) => {
        console.error('News-Tracker Fehler:', err.message);
      });
    }, 3 * 60 * 1000);
  }

  async refreshNewsFeed({ symbol = null, forceRefresh = false } = {}) {
    try {
      const queries = new Set();

      if (symbol) {
        queries.add(String(symbol).trim().toUpperCase());
      }

      // 1. Ausgewählte / beobachtete Symbole
      for (const wSym of this.watchedSymbols.values()) {
        if (wSym) queries.add(wSym);
      }

      // 2. Offene Demo-Positionen
      for (const t of this.state.activeTrades) {
        if (t.status === 'OPEN' && t.symbol) queries.add(t.symbol);
      }

      // 3. Top Signale (Phase >= 2) & stärkste Intraday-Dips aus der Überwachung
      const allStocks = Array.from(this.stockResults.values());
      const topSignalStocks = [...allStocks]
        .sort((a, b) => {
          const pa = a.analysis?.phase ?? 0;
          const pb = b.analysis?.phase ?? 0;
          if (pb !== pa) return pb - pa;
          return (a.intradayChangePct || 0) - (b.intradayChangePct || 0);
        })
        .slice(0, 6);

      for (const s of topSignalStocks) {
        if (s.symbol) queries.add(s.symbol);
      }

      // Fallback falls noch kein Scan durchlief
      if (queries.size === 0) {
        ['SY1.DE', 'SAP.DE', 'NVDA', 'AAPL', 'MSFT'].forEach((q) => queries.add(q));
      }

      const targetQueries = Array.from(queries).slice(0, 8);
      const universeMap = new Map(this.getUniverse().map((u) => [u.symbol, u]));
      const collected = [];
      const seenIds = new Set();

      const results = await Promise.all(
        targetQueries.map((q) =>
          this.marketData.fetchNewsForQuery(q, { count: 5, forceRefresh })
        )
      );

      for (const list of results) {
        for (const item of list) {
          const key = item.id || item.link || item.title;
          if (seenIds.has(key)) continue;
          seenIds.add(key);

          // Ordne passendes überwachtes Aktien-Metadatum zu
          let matchedStock = universeMap.get(item.querySymbol);
          if (!matchedStock && Array.isArray(item.relatedTickers)) {
            for (const rt of item.relatedTickers) {
              if (universeMap.has(rt)) {
                matchedStock = universeMap.get(rt);
                break;
              }
            }
          }
          const stockRec = matchedStock ? this.stockResults.get(matchedStock.symbol) : null;

          collected.push({
            ...item,
            symbol: matchedStock?.symbol || item.querySymbol,
            stockName: matchedStock?.name || item.querySymbol,
            phase: stockRec?.analysis?.phase ?? 0,
            intradayChangePct: stockRec?.intradayChangePct ?? null,
            priceEur: stockRec?.price ?? null
          });
        }
      }

      collected.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
      this.newsItems = collected.slice(0, 35);

      this.notifier.broadcastWs({
        type: 'NEWS_UPDATED',
        news: this.newsItems
      });

      return this.newsItems;
    } catch (err) {
      console.error('News-Abruf Fehler:', err.message);
      return this.newsItems;
    }
  }

  setWatchedSymbol(clientId, symbol) {
    if (!clientId) return;
    if (symbol) {
      this.watchedSymbols.set(clientId, String(symbol).trim().toUpperCase());
    } else {
      this.watchedSymbols.delete(clientId);
    }
  }

  removeWatchedClient(clientId) {
    if (clientId) this.watchedSymbols.delete(clientId);
  }

  startDemoLiveTicker() {
    if (this.demoLiveTimer) clearInterval(this.demoLiveTimer);
    this.demoLiveTimer = setInterval(() => {
      this.runDemoLiveTick().catch((err) => {
        console.error('Demo-Live-Tick Fehler:', err.message);
      });
    }, 1000);
  }

  async runDemoLiveTick() {
    if (this.isDemoTickRunning) return;
    this.isDemoTickRunning = true;

    try {
      this.rolloverDailyAccountsIfNeeded();

      const openTrades = this.state.activeTrades.filter((t) => t.status === 'OPEN');
      const openReverseTrades = (this.state.reverseActiveTrades || []).filter((t) => t.status === 'OPEN');
      const openDailyLong = (this.state.dailySession?.longActiveTrades || []).filter((t) => t.status === 'OPEN');
      const openDailyShort = (this.state.dailySession?.shortActiveTrades || []).filter((t) => t.status === 'OPEN');
      const liveSymbolSet = new Set();

      for (const t of [...openTrades, ...openReverseTrades, ...openDailyLong, ...openDailyShort]) {
        if (t.symbol) liveSymbolSet.add(t.symbol);
      }
      for (const sym of this.watchedSymbols.values()) {
        if (sym) liveSymbolSet.add(sym);
      }

      const livePrices = {};
      const targetSymbols = Array.from(liveSymbolSet).slice(0, 15);
      const hasAnyOpen = openTrades.length > 0 || openReverseTrades.length > 0 || openDailyLong.length > 0 || openDailyShort.length > 0;
      const shouldFetch =
        targetSymbols.length > 0 &&
        (hasAnyOpen || this.notifier.wsClients.size > 0);

      if (shouldFetch) {
        try {
          const fetchList = Array.from(new Set(['EURUSD=X', 'EURCHF=X', ...targetSymbols]));
          const quoteMap = await this.marketData.fetchBatchQuotes(fetchList, { timeoutMs: 850 });

          const eurUsd = quoteMap.get('EURUSD=X');
          const eurChf = quoteMap.get('EURCHF=X');
          if (eurUsd?.regularMarketPrice > 0.5) this.fxToEur.USD = 1 / eurUsd.regularMarketPrice;
          if (eurChf?.regularMarketPrice > 0.5) this.fxToEur.CHF = 1 / eurChf.regularMarketPrice;

          for (const sym of targetSymbols) {
            const rawQ = quoteMap.get(sym);
            const rec = this.stockResults.get(sym);
            if (!rawQ || !rec || rec.isSimulation) continue;

            const fx = this.getFxRateToEur(rec.nativeCurrency || rawQ.currency || 'EUR');
            const rawPrice = Number(rawQ.regularMarketPrice || 0);
            if (rawPrice > 0) {
              const exactEur = Math.round(rawPrice * fx * 10000) / 10000;
              rec.exactPriceEur = exactEur;
              rec.price = Math.round(exactEur * 100) / 100;
              rec.intradayChangePct = Math.round(Number(rawQ.regularMarketChangePercent ?? rec.intradayChangePct ?? 0) * 100) / 100;
              if (rec.analysis) rec.analysis.currentPrice = rec.price;
              rec.updatedAt = new Date().toISOString();

              const bars = this.m10Store.get(sym);
              let lastBar = null;
              if (Array.isArray(bars) && bars.length > 0) {
                lastBar = bars[bars.length - 1];
                lastBar.close = exactEur;
                if (exactEur > lastBar.high) lastBar.high = exactEur;
                if (exactEur < lastBar.low) lastBar.low = exactEur;
              }

              livePrices[sym] = {
                price: rec.price,
                exactPriceEur: exactEur,
                intradayChangePct: rec.intradayChangePct,
                lastBar
              };
            }
          }
        } catch {
          // Wenn einzelner 1s-Quote-Abruf langsam ist, trotzdem Demo-Account-Tick senden
        }
      }

      if (hasAnyOpen) {
        await this.evaluateAllActiveTrades();
      }

      if (this.notifier.wsClients.size > 0) {
        this.notifier.broadcastWs({
          type: 'DEMO_LIVE_TICK',
          serverTime: new Date().toISOString(),
          demoAccount: this.getDemoMetrics(),
          reverseDemoAccount: this.getReverseDemoMetrics(),
          activeTrades: this.state.activeTrades,
          journal: this.state.journal.slice(0, 20),
          reverseActiveTrades: this.state.reverseActiveTrades || [],
          reverseJournal: (this.state.reverseJournal || []).slice(0, 20),
          dailySession: this.getDailySessionPayload(),
          dailyAccountsHistory: this.state.dailyAccountsHistory || [],
          livePrices
        });
      }
    } finally {
      this.isDemoTickRunning = false;
    }
  }

  restartAutoScan() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    const intervalMs = Math.max(25, Number(this.state.settings.scanIntervalSec || 60)) * 1000;
    this.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
    this.scanTimer = setInterval(() => {
      this.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
      this.runFullScan({ reason: 'scheduled' }).catch((err) => {
        console.error('Geplanter Scan-Fehler:', err.message);
      });
    }, intervalMs);
  }

  /**
   * Liefert den Umrechnungsfaktor in Euro (€) für eine Aktie.
   */
  getFxRateToEur(nativeCurrency = 'EUR') {
    const cur = String(nativeCurrency || 'EUR').toUpperCase();
    if (cur === 'EUR' || cur === '€') return 1.0;
    if (cur === 'USD' || cur === '$') return this.fxToEur.USD || 0.925;
    if (cur === 'CHF') return this.fxToEur.CHF || 1.065;
    return 1.0;
  }

  /**
   * Rechnet ein Quote-Objekt vollständig in Euro (€) um.
   */
  convertQuoteToEur(quote = {}, fx = 1.0) {
    if (!quote || fx === 1.0) {
      return { ...quote, currency: '€' };
    }
    const conv = (val) => (Number.isFinite(val) && val > 0 ? Math.round(val * fx * 100) / 100 : val);
    return {
      ...quote,
      regularMarketPrice: conv(quote.regularMarketPrice),
      regularMarketPreviousClose: conv(quote.regularMarketPreviousClose),
      chartPreviousClose: conv(quote.chartPreviousClose),
      regularMarketOpen: conv(quote.regularMarketOpen),
      regularMarketDayHigh: conv(quote.regularMarketDayHigh),
      regularMarketDayLow: conv(quote.regularMarketDayLow),
      fiftyTwoWeekHigh: conv(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: conv(quote.fiftyTwoWeekLow),
      sma200: conv(quote.sma200),
      sma50: conv(quote.sma50),
      currency: '€'
    };
  }

  /**
   * Zweistufiger Scan:
   * 1) Sofort-Batch-Quote für alle 196 Aktien, 7 Indizes & EUR-Wechselkurse (< 1s) -> Alle Kurse in € sofort im UI!
   * 2) Sanft getakteter M10-Intraday-Scan über die wichtigsten Dips ohne Rate-Limiting.
   */
  async runFullScan({ reason = 'manual' } = {}) {
    if (this.isScanning) return this.getSnapshot();
    this.isScanning = true;
    this.notifier.broadcastWs({ type: 'SCAN_STATUS', isScanning: true, reason });

    try {
      const universe = this.getUniverse();
      const indexSymbols = Object.values(BENCHMARK_INDICES).map((i) => i.symbol);
      const stockSymbols = universe.map((u) => u.symbol);
      const fxSymbols = ['EURUSD=X', 'EURCHF=X'];

      // 1. Batch-Quotes für Indizes, FX & alle 196 Aktien abrufen
      const quoteMap = await this.marketData.fetchBatchQuotes([...fxSymbols, ...indexSymbols, ...stockSymbols]);

      // Live Wechselkurse aktualisieren (Yahoo: EURUSD=X = wie viele USD für 1 EUR)
      const eurUsdQuote = quoteMap.get('EURUSD=X');
      const eurChfQuote = quoteMap.get('EURCHF=X');
      if (eurUsdQuote?.regularMarketPrice > 0.5) {
        this.fxToEur.USD = 1 / eurUsdQuote.regularMarketPrice;
      }
      if (eurChfQuote?.regularMarketPrice > 0.5) {
        this.fxToEur.CHF = 1 / eurChfQuote.regularMarketPrice;
      }

      // 2. Gesamtmarkt-Regime (Schutzfilter 2, Kapitel 2.3) auswerten
      for (const [key, idxMeta] of Object.entries(BENCHMARK_INDICES)) {
        const q = quoteMap.get(idxMeta.symbol) || {};
        const changePct = Number(q.regularMarketChangePercent ?? 0);
        const isFallingHard = changePct <= -1.35;
        this.indexRegimes[key] = {
          key,
          symbol: idxMeta.symbol,
          name: idxMeta.name,
          region: idxMeta.region,
          price: q.regularMarketPrice || null,
          changePct: Math.round(changePct * 100) / 100,
          isFallingHard,
          status: isFallingHard ? 'PANIK / ABVERKAUF' : changePct >= 0 ? 'FREUNDLICH' : 'STABIL',
          summary: isFallingHard
            ? `${idxMeta.name} (${changePct.toFixed(2)}%) im scharfen Abverkauf – Index-Stabilisierung im M10 abwarten!`
            : `${idxMeta.name} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%) stabilisiert`
        };
      }

      // 3. Sofort-Auswertung mit den Batch-Quotes (in EUR umgerechnet) für ALLE 196 Aktien
      for (const stockMeta of universe) {
        const q = quoteMap.get(stockMeta.symbol);
        const existing = this.stockResults.get(stockMeta.symbol);
        if (existing?.isSimulation && reason === 'scheduled') continue;
        await this.evaluateSingleStock(stockMeta, q, { fetchIntraday: false });
      }

      // Sofort Zwischen-Snapshot ans UI pushen (alle 196 Aktien haben jetzt sofort Kurse in €!)
      this.notifier.broadcastWs({
        type: 'SCAN_COMPLETED',
        snapshot: this.getSnapshot()
      });

      // 4. Sortieren nach Dip-Relevanz (geöffnete Heimatbörsen + größte Tagesverlierer + noch nicht geladene M10-Charts zuerst)
      const rankedUniverse = [...universe].sort((a, b) => {
        const idxA = BENCHMARK_INDICES[a.index] || BENCHMARK_INDICES.DAX;
        const idxB = BENCHMARK_INDICES[b.index] || BENCHMARK_INDICES.DAX;
        const openA = checkReferenceMarketOpen(idxA.region).isOpen ? 0 : 1;
        const openB = checkReferenceMarketOpen(idxB.region).isOpen ? 0 : 1;
        if (openA !== openB) return openA - openB;

        const hasA = this.m10Store.has(a.symbol) ? 1 : 0;
        const hasB = this.m10Store.has(b.symbol) ? 1 : 0;
        const qa = quoteMap.get(a.symbol);
        const qb = quoteMap.get(b.symbol);
        const chgA = qa?.regularMarketChangePercent ?? 0;
        const chgB = qb?.regularMarketChangePercent ?? 0;
        const isDipA = chgA <= -1.5 ? 0 : 1;
        const isDipB = chgB <= -1.5 ? 0 : 1;
        if (isDipA !== isDipB) return isDipA - isDipB;
        if (hasA !== hasB) return hasA - hasB;
        return chgA - chgB;
      });

      // Pro Scan-Zyklus die 80 wichtigsten Dips/Kandidaten tiefenscannen
      const deepScanTargets = rankedUniverse.slice(0, 80);
      const batchSize = 4;
      for (let i = 0; i < deepScanTargets.length; i += batchSize) {
        const slice = deepScanTargets.slice(i, i + batchSize);
        await Promise.all(
          slice.map((stockMeta) => {
            const existing = this.stockResults.get(stockMeta.symbol);
            if (existing?.isSimulation) return Promise.resolve();
            return this.evaluateSingleStock(stockMeta, quoteMap.get(stockMeta.symbol), {
              fetchIntraday: true
            });
          })
        );
        await new Promise((r) => setTimeout(r, 60));
      }

      // 5. Aktive Leads/Trades auf Close-Signal (Stagnations-Exit / Stop-Loss / EOD) prüfen
      await this.evaluateAllActiveTrades();

      this.lastScanAt = new Date().toISOString();
    } finally {
      this.isScanning = false;
      this.notifier.broadcastWs({
        type: 'SCAN_COMPLETED',
        snapshot: this.getSnapshot()
      });
    }

    return this.getSnapshot();
  }

  /**
   * Analysiert eine einzelne Aktie komplett in Euro (€) nach Playbook Kapitel 02–05.
   * Benachrichtigt NUR bei neuem Lead (Phase 4 Entry) und überwacht ihn automatisch auf das Close-Signal!
   */
  async evaluateSingleStock(stockMeta, rawQuote = {}, { fetchIntraday = true, forceRefresh = false } = {}) {
    try {
      const idxInfo = BENCHMARK_INDICES[stockMeta.index] || BENCHMARK_INDICES.DAX;
      const indexRegime = this.indexRegimes[stockMeta.index] || {};
      const marketClock = checkReferenceMarketOpen(idxInfo.region);
      const fx = this.getFxRateToEur(stockMeta.currency || rawQuote?.currency || 'EUR');

      let quote = this.convertQuoteToEur(rawQuote || {}, fx);
      let m10Bars = this.m10Store.get(stockMeta.symbol) || [];

      if (fetchIntraday || forceRefresh) {
        try {
          const intradayData = await this.marketData.fetchIntraday5m(stockMeta.symbol, { forceRefresh });
          const tz = idxInfo.region === 'US' ? 'America/New_York' : 'Europe/Berlin';
          // 5m-Kerzen vor der M10-Aggregation in Euro (€) umrechnen
          const eur5mBars = (intradayData.bars || []).map((b) => ({
            ...b,
            open: Math.round(b.open * fx * 100) / 100,
            high: Math.round(b.high * fx * 100) / 100,
            low: Math.round(b.low * fx * 100) / 100,
            close: Math.round(b.close * fx * 100) / 100
          }));
          const rawM10 = resampleToM10(eur5mBars, tz);
          m10Bars = enrichM10Indicators(rawM10);
          const liveQuotePrice = Number(quote?.regularMarketPrice || 0);
          if (liveQuotePrice > 0 && m10Bars.length > 0) {
            const lastBar = m10Bars[m10Bars.length - 1];
            lastBar.close = liveQuotePrice;
            if (liveQuotePrice > lastBar.high) lastBar.high = liveQuotePrice;
            if (liveQuotePrice < lastBar.low) lastBar.low = liveQuotePrice;
          }
          this.m10Store.set(stockMeta.symbol, m10Bars);

          const m = this.convertQuoteToEur(intradayData.meta || {}, fx);
          quote = {
            ...quote,
            regularMarketPrice:
              quote?.regularMarketPrice ||
              m.regularMarketPrice ||
              (m10Bars.length ? m10Bars[m10Bars.length - 1].close : 0),
            regularMarketPreviousClose: quote?.regularMarketPreviousClose || m.chartPreviousClose,
            regularMarketDayHigh: quote?.regularMarketDayHigh || m.regularMarketDayHigh,
            regularMarketDayLow: quote?.regularMarketDayLow || m.regularMarketDayLow,
            fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh || m.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: quote?.fiftyTwoWeekLow || m.fiftyTwoWeekLow,
            currency: '€'
          };
        } catch {
          // Nutze Batch-Quote + gecachte M10-Kerzen
        }
      } else if (m10Bars.length > 0 && quote?.regularMarketPrice > 0) {
        const lastBar = m10Bars[m10Bars.length - 1];
        const liveQuotePrice = Number(quote.regularMarketPrice);
        lastBar.close = liveQuotePrice;
        if (liveQuotePrice > lastBar.high) lastBar.high = liveQuotePrice;
        if (liveQuotePrice < lastBar.low) lastBar.low = liveQuotePrice;
      }

      const currentPrice =
        quote?.regularMarketPrice ||
        (m10Bars.length > 0 ? m10Bars[m10Bars.length - 1].close : 0);
      const exactPriceEur = rawQuote?.regularMarketPrice > 0
        ? Math.round(Number(rawQuote.regularMarketPrice) * fx * 10000) / 10000
        : currentPrice;

      const fundamentals = evaluateFundamentalAndFilters(
        stockMeta,
        quote || {},
        [],
        indexRegime,
        this.state.settings
      );

      const dailySupports = findDailySupportZones([], quote || {}, currentPrice);
      let analysis = analyzeM10BottomFormation(m10Bars, dailySupports, fundamentals);

      // Falls M10-Kerzen noch geladen werden, fülle LoD & Kurs aus dem Echtzeit-Quote (in €)!
      const fallbackLod = quote?.regularMarketDayLow || currentPrice * 0.985;
      if (!analysis.lodPrice && fallbackLod > 0) {
        const distPct = ((currentPrice - fallbackLod) / fallbackLod) * 100;
        analysis = {
          ...analysis,
          lodPrice: Math.round(fallbackLod * 100) / 100,
          currentPrice: Math.round(currentPrice * 100) / 100,
          distanceFromLodPct: Math.round(distPct * 100) / 100,
          sessionHigh: Math.round((quote?.regularMarketDayHigh || currentPrice) * 100) / 100
        };
      }

      const sizing = calculateRiskAndPositionSizing({
        entryPrice: analysis.currentPrice || currentPrice,
        lodPrice: analysis.lodPrice || fallbackLod,
        accountCapital: this.getDemoMetrics().totalEquityEuro || this.state.settings.accountCapital,
        maxRiskPct: this.state.settings.maxRiskPct,
        noiseBufferPct: this.state.settings.noiseBufferPct,
        stockProfile: stockMeta.profile
      });

      const checklist = buildPreTradeChecklist(analysis, fundamentals, marketClock, sizing);

      const fullRecord = {
        symbol: stockMeta.symbol,
        name: quote?.shortName || stockMeta.name,
        index: stockMeta.index,
        indexName: idxInfo.name,
        region: idxInfo.region,
        sector: stockMeta.sector,
        profile: stockMeta.profile,
        nativeCurrency: stockMeta.currency || 'EUR',
        currency: '€',
        price: Math.round((analysis.currentPrice || currentPrice || 0) * 100) / 100,
        exactPriceEur,
        intradayChangePct: fundamentals.intradayChangePct,
        dipFromSwingHighPct: fundamentals.dipFromSwingHighPct,
        fundamentals,
        marketClock,
        analysis,
        sizing,
        checklist,
        hasM10Bars: m10Bars.length > 0,
        updatedAt: new Date().toISOString()
      };

      this.stockResults.set(stockMeta.symbol, fullRecord);

      // WICHTIG: Benachrichtigung & automatischer Demo-Account-Trade NUR bei echtem Kauf-Lead (Phase 4 Entry) bei geöffneter Börse!
      const lastSession = m10Bars.length > 0 ? m10Bars[m10Bars.length - 1].sessionDate : 'today';
      if (
        analysis.phase === 4 &&
        marketClock.isOpen &&
        !marketClock.isNearClose &&
        this.notifier.shouldTriggerPhaseAlert(stockMeta.symbol, 4, lastSession)
      ) {
        const buyGate = evaluateBuyStrategyEntry(analysis, fundamentals, sizing, indexRegime);
        let openedDemoTrade = null;
        const alreadyOpen = this.state.activeTrades.some(
          (t) => t.symbol === stockMeta.symbol && t.status === 'OPEN'
        );
        const openMainCount = this.state.activeTrades.filter((t) => t.status === 'OPEN').length;
        if (
          buyGate.qualified &&
          openMainCount < 5 &&
          !alreadyOpen &&
          this.state.demoAccount.autoTradeEnabled !== false &&
          Number(this.state.demoAccount.cashEuro || 0) >= 250
        ) {
          openedDemoTrade = this.openActiveTrade({
            symbol: stockMeta.symbol,
            name: stockMeta.name,
            currency: '€',
            isDemoAuto: true,
            entryPrice: fullRecord.exactPriceEur || fullRecord.price,
            lodPrice: analysis.lodPrice,
            stopLossStock: sizing.stopLossStock,
            leverage: sizing.activeLeverage,
            positionSizeEuro: sizing.positionSizeEuro,
            quantityPieces: sizing.quantityPieces,
            certEntryPrice: sizing.modelCertEntryPrice,
            certStopPrice: sizing.modelCertStopPrice,
            catalystNote: `Buy-Strategie v2 (Konfluenz ${analysis.confluenceCount}/4 · M10 Ausbruch)`
          });
        }

        // ACCOUNT 2 (REVERSE STRATEGIE): Wenn Phase-4-Signal feuert, geht Account 2 automatisch Short!
        const alreadyOpenRev = (this.state.reverseActiveTrades || []).some(
          (t) => t.symbol === stockMeta.symbol && t.status === 'OPEN'
        );
        if (
          !alreadyOpenRev &&
          this.state.reverseDemoAccount?.autoTradeEnabled !== false &&
          Number(this.state.reverseDemoAccount?.cashEuro || 0) >= 250
        ) {
          this.openReverseActiveTrade({
            symbol: stockMeta.symbol,
            name: stockMeta.name,
            currency: '€',
            isDemoAuto: true,
            entryPrice: fullRecord.exactPriceEur || fullRecord.price,
            lodPrice: analysis.lodPrice,
            stopLossStock: sizing.stopLossStock,
            leverage: sizing.activeLeverage,
            positionSizeEuro: sizing.positionSizeEuro,
            quantityPieces: sizing.quantityPieces,
            certEntryPrice: sizing.modelCertEntryPrice,
            certStopPrice: sizing.modelCertStopPrice,
            catalystNote: 'Auto-Reverse Account #2 (Turbo-Short gegen Phase-4-Lead)'
          });
        }

        // TAGES-ACCOUNTS (10.000 € PRO HANDELSTAG): Tages-Long (Buy v2 Gate) & Tages-Short parallel eröffnen!
        this.rolloverDailyAccountsIfNeeded();
        const ds = this.state.dailySession;
        const alreadyOpenDailyLong = (ds?.longActiveTrades || []).some(
          (t) => t.symbol === stockMeta.symbol && t.status === 'OPEN'
        );
        const openDailyLongCount = (ds?.longActiveTrades || []).filter((t) => t.status === 'OPEN').length;
        if (
          ds &&
          buyGate.qualified &&
          openDailyLongCount < 5 &&
          !alreadyOpenDailyLong &&
          ds.longAccount?.autoTradeEnabled !== false &&
          Number(ds.longAccount?.cashEuro || 0) >= 250
        ) {
          this.openDailyTrade('long', {
            symbol: stockMeta.symbol,
            name: stockMeta.name,
            currency: '€',
            isDemoAuto: true,
            entryPrice: fullRecord.exactPriceEur || fullRecord.price,
            lodPrice: analysis.lodPrice,
            stopLossStock: sizing.stopLossStock,
            leverage: sizing.activeLeverage,
            positionSizeEuro: sizing.positionSizeEuro,
            quantityPieces: sizing.quantityPieces,
            certEntryPrice: sizing.modelCertEntryPrice,
            certStopPrice: sizing.modelCertStopPrice,
            catalystNote: `Tages-Long v2 (${ds.date}) · Konfluenz ${analysis.confluenceCount}/4`
          });
        }

        const alreadyOpenDailyShort = (ds?.shortActiveTrades || []).some(
          (t) => t.symbol === stockMeta.symbol && t.status === 'OPEN'
        );
        if (
          ds &&
          !alreadyOpenDailyShort &&
          ds.shortAccount?.autoTradeEnabled !== false &&
          Number(ds.shortAccount?.cashEuro || 0) >= 250
        ) {
          this.openDailyTrade('short', {
            symbol: stockMeta.symbol,
            name: stockMeta.name,
            currency: '€',
            isDemoAuto: true,
            entryPrice: fullRecord.exactPriceEur || fullRecord.price,
            lodPrice: analysis.lodPrice,
            stopLossStock: sizing.stopLossStock,
            leverage: sizing.activeLeverage,
            positionSizeEuro: sizing.positionSizeEuro,
            quantityPieces: sizing.quantityPieces,
            certEntryPrice: sizing.modelCertEntryPrice,
            certStopPrice: sizing.modelCertStopPrice,
            catalystNote: `Tages-Short (${ds.date}) · Reverse Phase-4-Lead`
          });
        }

        await this.notifier.dispatchSimultaneousAlert({
          kind: 'STRATEGY_SIGNAL',
          symbol: stockMeta.symbol,
          name: stockMeta.name,
          index: idxInfo.name,
          currency: '€',
          phase: 4,
          phaseBadge: openedDemoTrade ? '🟢 NEUER LEAD · DEMO GEKAUFT' : '🟢 NEUER LEAD (PHASE 4)',
          title: openedDemoTrade
            ? `NEUER LEAD & DEMO-KAUF: ${stockMeta.name} (${fullRecord.price.toFixed(2)} €)`
            : `NEUER LEAD (ENTRY): ${stockMeta.name} (${fullRecord.price.toFixed(2)} €)`,
          message: openedDemoTrade
            ? `${analysis.actionText} — Demo-Account #1 (Long), Account #2 (Reverse Short) & Tages-Accounts haben automatisch getradet!`
            : `${analysis.actionText} — Empfohlene Position: ${sizing.positionSizeEuro.toFixed(0)} € (${sizing.activeLeverage}x Long).`,
          price: fullRecord.price,
          lodPrice: analysis.lodPrice,
          distanceFromLodPct: analysis.distanceFromLodPct,
          barsSinceFirstLow: analysis.barsSinceFirstLow,
          intradayChangePct: fundamentals.intradayChangePct,
          dipFromSwingHighPct: fundamentals.dipFromSwingHighPct,
          rsi14: analysis.rsi14,
          ema20: analysis.ema20,
          vwap: analysis.vwap,
          peReason: fundamentals.peReason,
          confluenceSignals: analysis.confluenceSignals,
          confluenceCount: analysis.confluenceCount,
          sizing,
          demoAccount: this.getDemoMetrics()
        });
      }

      return fullRecord;
    } catch (err) {
      console.error(`Fehler bei Analyse von ${stockMeta.symbol}:`, err.message);
      return null;
    }
  }

  /**
   * Überwacht alle offenen Leads/Trades des Demo-Accounts (Account 1 Long + Account 2 Reverse Short + Tages-Accounts):
   */
  async evaluateAllActiveTrades() {
    this.rolloverDailyAccountsIfNeeded();

    // Kopie des Arrays, da closeActiveTrade Elemente aus this.state.activeTrades entfernt
    const openTrades = [...this.state.activeTrades].filter((t) => t.status === 'OPEN');

    for (const trade of openTrades) {
      let m10Bars = this.m10Store.get(trade.symbol);
      if (!m10Bars || m10Bars.length === 0) {
        try {
          const intraday = await this.marketData.fetchIntraday5m(trade.symbol);
          const stockMeta = DEFAULT_UNIVERSE.find((u) => u.symbol === trade.symbol);
          const fx = this.getFxRateToEur(stockMeta?.currency || 'EUR');
          const eurBars = (intraday.bars || []).map((b) => ({
            ...b,
            open: Math.round(b.open * fx * 100) / 100,
            high: Math.round(b.high * fx * 100) / 100,
            low: Math.round(b.low * fx * 100) / 100,
            close: Math.round(b.close * fx * 100) / 100
          }));
          m10Bars = enrichM10Indicators(resampleToM10(eurBars));
          this.m10Store.set(trade.symbol, m10Bars);
        } catch {
          continue;
        }
      }

      const stockRecord = this.stockResults.get(trade.symbol);
      const stockMeta = DEFAULT_UNIVERSE.find((u) => u.symbol === trade.symbol);
      const idxInfo = BENCHMARK_INDICES[stockRecord?.index || stockMeta?.index] || BENCHMARK_INDICES.DAX;
      const liveClock = checkReferenceMarketOpen(stockRecord?.region || idxInfo.region);

      // Synchronisiere die letzte M10-Kerze mit dem exakten Live-Sekundenkurs in €
      const liveExact = Number(stockRecord?.exactPriceEur || stockRecord?.price || 0);
      if (liveExact > 0 && m10Bars.length > 0 && !stockRecord?.isSimulation) {
        const lastBar = m10Bars[m10Bars.length - 1];
        lastBar.close = liveExact;
        if (liveExact > lastBar.high) lastBar.high = liveExact;
        if (liveExact < lastBar.low) lastBar.low = liveExact;
      }

      const evaluation = evaluateActiveTrade(trade, m10Bars, liveClock);
      if (!evaluation) continue;

      trade.latestEvaluation = evaluation;
      trade.currency = '€';

      // Automatischer Break-Even Stop-Nachzug im Demo-Account ab +1,0R (lautlos im Hintergrund)
      if (evaluation.stage >= 2 && evaluation.recommendedStopStock > trade.stopLossStock) {
        if (!trade.initialStopStock) {
          trade.initialStopStock = trade.stopLossStock;
        }
        trade.stopLossStock = evaluation.recommendedStopStock;
        trade.breakEvenActive = true;
      }

      // Prüfe, ob der Lead geschlossen werden soll (Take-Profit / Stagnation, Stop-Loss / Trailing-Stop, Time-Stop oder EOD)
      const isStopHit = evaluation.alertType === 'STOP_LOSS_HIT';
      const isTimeStop = evaluation.alertType === 'TIME_STOP_EXIT';
      const isStagnationExit = evaluation.alertType === 'STAGNATION_EXIT';
      const isEodClose = Boolean(
        trade.isDemoAuto &&
        !stockRecord?.isSimulation &&
        (liveClock.isNearClose || !liveClock.isOpen)
      );

      if (isStopHit || isTimeStop || isStagnationExit || isEodClose) {
        const isBeStop = isStopHit && trade.breakEvenActive && trade.stopLossStock >= trade.entryPrice;
        const exitReason = isBeStop
          ? 'Break-Even / Trailing-Stop ausgelöst (Buy v2)'
          : isStopHit
            ? 'Stop-Loss unter Tagestief ausgelöst (Kap. 05)'
            : isTimeStop
              ? '80-Min. Time-Stop (Kein Follow-Through, Buy v2)'
              : isStagnationExit
                ? 'Buy v2 Take-Profit / Momentum-Sicherung'
                : 'Börsenschluss / EOD Time-Stop (Kap. 6.2)';

        // Im Demo-Account automatisch glattstellen und Gewinn/Verlust realisieren!
        const closedJournal = this.closeActiveTrade(trade.id, evaluation.currentPrice, exitReason);

        await this.notifier.dispatchSimultaneousAlert({
          kind: 'TRADE_EXIT',
          stage: evaluation.stage,
          symbol: trade.symbol,
          name: trade.name || trade.symbol,
          currency: '€',
          leverage: trade.leverage,
          currentPrice: closedJournal.exitPrice,
          stockGainPct: closedJournal.stockGainPct,
          derivGainPct: closedJournal.derivGainPct,
          rMultiple: closedJournal.rMultiple,
          pnlEuro: closedJournal.pnlEuro,
          recommendedStopStock: evaluation.recommendedStopStock,
          demoAccount: this.getDemoMetrics(),
          title: isStopHit && !isBeStop
            ? `🛑 LEAD GECLOSED (STOP-LOSS): ${trade.name} im Demo-Account verkauft (${closedJournal.pnlEuro >= 0 ? '+' : ''}${closedJournal.pnlEuro.toFixed(0)} €)`
            : `🏁 LEAD GECLOSED (${isEodClose ? 'BÖRSENSCHLUSS' : isTimeStop ? 'TIME-STOP' : isBeStop ? 'BREAK-EVEN' : 'TAKE-PROFIT'}): ${trade.name} im Demo-Account verkauft (${closedJournal.pnlEuro >= 0 ? '+' : ''}${closedJournal.pnlEuro.toFixed(0)} €)`,
          message: `${exitReason} — Demo-Account Kontostand: ${this.getDemoMetrics().totalEquityEuro.toFixed(2)} €`
        });
      }
    }

    // --- ACCOUNT 2: REVERSE-STRATEGIE (TURBO-SHORT) ÜBERWACHUNG ---
    const openReverseTrades = [...(this.state.reverseActiveTrades || [])].filter((t) => t.status === 'OPEN');
    for (const rTrade of openReverseTrades) {
      const m10Bars = this.m10Store.get(rTrade.symbol);
      if (!m10Bars || m10Bars.length === 0) continue;

      const stockRecord = this.stockResults.get(rTrade.symbol);
      const stockMeta = DEFAULT_UNIVERSE.find((u) => u.symbol === rTrade.symbol);
      const idxInfo = BENCHMARK_INDICES[stockRecord?.index || stockMeta?.index] || BENCHMARK_INDICES.DAX;
      const liveClock = checkReferenceMarketOpen(stockRecord?.region || idxInfo.region);

      const revEval = evaluateReverseActiveTrade(rTrade, m10Bars, liveClock);
      if (!revEval) continue;

      rTrade.latestEvaluation = revEval;
      rTrade.currency = '€';

      // Bei Short Break-Even (>= +1.5R) wird der obere Stop-Loss nach unten auf den Einstiegskurs nachgezogen
      if (revEval.stage >= 2 && revEval.recommendedStopStock < rTrade.stopLossStock) {
        rTrade.stopLossStock = revEval.recommendedStopStock;
        rTrade.breakEvenActive = true;
      }

      const isRevStopHit = revEval.alertType === 'STOP_LOSS_HIT';
      const isRevTpHit = revEval.alertType === 'STAGNATION_EXIT';
      const isRevEod = Boolean(
        rTrade.isDemoAuto &&
        !stockRecord?.isSimulation &&
        (liveClock.isNearClose || !liveClock.isOpen)
      );

      if (isRevStopHit || isRevTpHit || isRevEod) {
        const revExitReason = isRevStopHit
          ? 'Reverse Short Stop-Loss ausgelöst (Kurs über oberem Stop)'
          : isRevTpHit
            ? 'Reverse Short Take-Profit (+2R / Abwärtsziel erreicht)'
            : 'Börsenschluss / EOD Time-Stop (Reverse Account)';

        this.closeReverseActiveTrade(rTrade.id, revEval.currentPrice, revExitReason);
      }
    }

    // --- TAGES-ACCOUNTS (HEUTIGER HANDELSTAG): TAGES-LONG & TAGES-SHORT ---
    const ds = this.state.dailySession;
    if (ds) {
      const openDailyLong = [...(ds.longActiveTrades || [])].filter((t) => t.status === 'OPEN');
      for (const dlTrade of openDailyLong) {
        const m10Bars = this.m10Store.get(dlTrade.symbol);
        if (!m10Bars || m10Bars.length === 0) continue;
        const stockRecord = this.stockResults.get(dlTrade.symbol);
        const stockMeta = DEFAULT_UNIVERSE.find((u) => u.symbol === dlTrade.symbol);
        const idxInfo = BENCHMARK_INDICES[stockRecord?.index || stockMeta?.index] || BENCHMARK_INDICES.DAX;
        const liveClock = checkReferenceMarketOpen(stockRecord?.region || idxInfo.region);

        const dlEval = evaluateActiveTrade(dlTrade, m10Bars, liveClock);
        if (!dlEval) continue;
        dlTrade.latestEvaluation = dlEval;
        dlTrade.currency = '€';

        if (dlEval.stage >= 2 && dlEval.recommendedStopStock > dlTrade.stopLossStock) {
          if (!dlTrade.initialStopStock) {
            dlTrade.initialStopStock = dlTrade.stopLossStock;
          }
          dlTrade.stopLossStock = dlEval.recommendedStopStock;
          dlTrade.breakEvenActive = true;
        }

        const isStopHit = dlEval.alertType === 'STOP_LOSS_HIT';
        const isTimeStop = dlEval.alertType === 'TIME_STOP_EXIT';
        const isStagExit = dlEval.alertType === 'STAGNATION_EXIT';
        const isEod = Boolean(dlTrade.isDemoAuto && !stockRecord?.isSimulation && (liveClock.isNearClose || !liveClock.isOpen));

        if (isStopHit || isTimeStop || isStagExit || isEod) {
          const isBeStop = isStopHit && dlTrade.breakEvenActive && dlTrade.stopLossStock >= dlTrade.entryPrice;
          const reason = isBeStop
            ? 'Break-Even / Trailing-Stop (Tages-Long v2)'
            : isStopHit
              ? 'Stop-Loss unter Tagestief (Tages-Long)'
              : isTimeStop
                ? '80-Min. Time-Stop (Tages-Long v2)'
                : isStagExit
                  ? 'Buy v2 Take-Profit (Tages-Long)'
                  : 'Börsenschluss / EOD Time-Stop (Tages-Long)';
          this.closeDailyTrade('long', dlTrade.id, dlEval.currentPrice, reason);
        }
      }

      const openDailyShort = [...(ds.shortActiveTrades || [])].filter((t) => t.status === 'OPEN');
      for (const dsTrade of openDailyShort) {
        const m10Bars = this.m10Store.get(dsTrade.symbol);
        if (!m10Bars || m10Bars.length === 0) continue;
        const stockRecord = this.stockResults.get(dsTrade.symbol);
        const stockMeta = DEFAULT_UNIVERSE.find((u) => u.symbol === dsTrade.symbol);
        const idxInfo = BENCHMARK_INDICES[stockRecord?.index || stockMeta?.index] || BENCHMARK_INDICES.DAX;
        const liveClock = checkReferenceMarketOpen(stockRecord?.region || idxInfo.region);

        const dsEval = evaluateReverseActiveTrade(dsTrade, m10Bars, liveClock);
        if (!dsEval) continue;
        dsTrade.latestEvaluation = dsEval;
        dsTrade.currency = '€';

        if (dsEval.stage >= 2 && dsEval.recommendedStopStock < dsTrade.stopLossStock) {
          dsTrade.stopLossStock = dsEval.recommendedStopStock;
          dsTrade.breakEvenActive = true;
        }

        const isStopHit = dsEval.alertType === 'STOP_LOSS_HIT';
        const isTpHit = dsEval.alertType === 'STAGNATION_EXIT';
        const isEod = Boolean(dsTrade.isDemoAuto && !stockRecord?.isSimulation && (liveClock.isNearClose || !liveClock.isOpen));

        if (isStopHit || isTpHit || isEod) {
          const reason = isStopHit
            ? 'Reverse Short Stop-Loss (Tages-Short)'
            : isTpHit
              ? 'Reverse Short Take-Profit (Tages-Short)'
              : 'Börsenschluss / EOD Time-Stop (Tages-Short)';
          this.closeDailyTrade('short', dsTrade.id, dsEval.currentPrice, reason);
        }
      }
    }
  }

  async triggerCaseStudySimulation(stage = 'phase4_entry') {
    const m10Bars = generatePlaybookCaseStudyBars(stage);
    const symbol = 'SY1.DE';
    const stockMeta = {
      symbol: 'SY1.DE',
      name: 'Symrise AG (Playbook-Fallstudie Kap. 08)',
      index: 'DAX',
      sector: 'Chemie / Duftstoffe',
      profile: 'conservative',
      currency: 'EUR'
    };

    const latestBar = m10Bars[m10Bars.length - 1];
    const quote = {
      symbol,
      shortName: stockMeta.name,
      regularMarketPrice: latestBar.close,
      regularMarketPreviousClose: 106.00,
      chartPreviousClose: 106.00,
      regularMarketOpen: 98.00,
      regularMarketDayHigh: Math.max(...m10Bars.slice(12).map((b) => b.high)),
      regularMarketDayLow: 95.40,
      regularMarketChangePercent: ((latestBar.close - 106.00) / 106.00) * 100,
      trailingPE: 21.4,
      forwardPE: 18.9,
      epsTrailingTwelveMonths: 4.5,
      fiftyTwoWeekHigh: 112.00,
      fiftyTwoWeekLow: 92.00,
      sma200: 95.45,
      currency: 'EUR'
    };

    const dailySupports = {
      allSupports: [
        { price: 95.40, type: 'Markante Daily-Unterstützung & SMA 200', strength: 'Hoch' },
        { price: 92.00, type: '52-Wochen-Tief', strength: 'Hoch' }
      ],
      nearestSupport: { price: 95.40, type: 'Markante Daily-Unterstützung & SMA 200', strength: 'Hoch' },
      atMajorSupport: true
    };

    const fundamentals = evaluateFundamentalAndFilters(
      stockMeta,
      quote,
      [],
      { isFallingHard: false, summary: 'DAX 40 (+0.35%) stabilisiert' },
      this.state.settings
    );

    const entryM10Bars = stage === 'stagnation_exit' ? generatePlaybookCaseStudyBars('phase4_entry') : m10Bars;
    const analysis = analyzeM10BottomFormation(entryM10Bars, dailySupports, fundamentals);

    const sizing = calculateRiskAndPositionSizing({
      entryPrice: 96.50,
      lodPrice: 95.40,
      accountCapital: this.getDemoMetrics().totalEquityEuro || this.state.settings.accountCapital || 10000,
      maxRiskPct: this.state.settings.maxRiskPct || 5.0,
      noiseBufferPct: 0.21,
      stockProfile: 'conservative',
      customLeverage: 8,
      customCertPrice: 1.20
    });

    const marketClock = {
      isOpen: true,
      isNearClose: false,
      berlinTime: '10:30 Uhr',
      hoursLabel: '09:00–17:30 Uhr MEZ (Xetra)',
      reason: 'Heimatbörse Xetra geöffnet (Fallstudie Kap. 08)'
    };

    const checklist = buildPreTradeChecklist(analysis, fundamentals, marketClock, sizing);

    this.m10Store.set(symbol, m10Bars);
    const fullRecord = {
      symbol,
      name: stockMeta.name,
      index: 'DAX',
      indexName: 'DAX 40',
      region: 'EU',
      sector: stockMeta.sector,
      profile: stockMeta.profile,
      currency: '€',
      price: latestBar.close,
      intradayChangePct: fundamentals.intradayChangePct,
      dipFromSwingHighPct: fundamentals.dipFromSwingHighPct,
      fundamentals,
      marketClock,
      analysis,
      sizing,
      checklist,
      hasM10Bars: true,
      isSimulation: true,
      updatedAt: new Date().toISOString()
    };

    this.stockResults.set(symbol, fullRecord);

    let alertResult = null;
    if (stage === 'stagnation_exit') {
      // Falls noch kein offener Symrise-Trade im Demo-Account existiert, lege ihn zuerst zum Einstiegskurs 96,50 € an und schließe ihn dann bei 100,30 €!
      let openSym = this.state.activeTrades.find((t) => t.symbol === 'SY1.DE' && t.status === 'OPEN');
      if (!openSym) {
        openSym = this.openActiveTrade({
          symbol: 'SY1.DE',
          name: stockMeta.name,
          currency: '€',
          entryPrice: 96.50,
          lodPrice: 95.40,
          stopLossStock: 95.20,
          leverage: 8,
          positionSizeEuro: 4630,
          quantityPieces: 3858,
          certEntryPrice: 1.20,
          certStopPrice: 1.09,
          catalystNote: 'Playbook-Fallstudie Kap. 08 (8x Turbo Long)'
        });
      }
      const evalTrade = evaluateActiveTrade(openSym, m10Bars, marketClock);
      const closedJournal = this.closeActiveTrade(
        openSym.id,
        evalTrade.currentPrice,
        'Stagnations-Exit am Widerstand 100,50 € (Kap. 08)'
      );

      alertResult = await this.notifier.dispatchSimultaneousAlert(
        {
          kind: 'TRADE_EXIT',
          stage: 3,
          symbol: 'SY1.DE',
          name: stockMeta.name,
          currency: '€',
          leverage: 8,
          currentPrice: closedJournal.exitPrice,
          stockGainPct: closedJournal.stockGainPct,
          derivGainPct: closedJournal.derivGainPct,
          rMultiple: closedJournal.rMultiple,
          pnlEuro: closedJournal.pnlEuro,
          recommendedStopStock: evalTrade.recommendedStopStock,
          demoAccount: this.getDemoMetrics(),
          title: `🏁 LEAD GECLOSED (TAKE-PROFIT): Symrise AG bei ${closedJournal.exitPrice.toFixed(2)} € (+${closedJournal.derivGainPct.toFixed(1)}% / +${closedJournal.pnlEuro.toFixed(0)} € im Demo-Account!)`,
          message: `${evalTrade.recommendation} — Neues Demo-Konto Gesamtkapital: ${this.getDemoMetrics().totalEquityEuro.toFixed(2)} €`
        },
        { forceTelegram: true }
      );
    } else if (stage === 'phase4_entry') {
      // Automatisch im Demo-Account kaufen, wenn Phase 4 Entry simuliert wird!
      const existingOpen = this.state.activeTrades.find((t) => t.symbol === 'SY1.DE' && t.status === 'OPEN');
      const demoTrade = existingOpen || this.openActiveTrade({
        symbol: 'SY1.DE',
        name: stockMeta.name,
        currency: '€',
        entryPrice: 96.50,
        lodPrice: 95.40,
        stopLossStock: 95.20,
        leverage: 8,
        positionSizeEuro: sizing.positionSizeEuro,
        quantityPieces: sizing.quantityPieces,
        certEntryPrice: sizing.modelCertEntryPrice,
        certStopPrice: sizing.modelCertStopPrice,
        catalystNote: 'Playbook-Fallstudie Kap. 08 (Auto-Buy Lead Phase 4)'
      });

      alertResult = await this.notifier.dispatchSimultaneousAlert(
        {
          kind: 'STRATEGY_SIGNAL',
          symbol,
          name: stockMeta.name,
          index: 'DAX 40',
          currency: '€',
          phase: 4,
          phaseBadge: '🟢 NEUER LEAD · DEMO GEKAUFT',
          title: `NEUER LEAD & DEMO-KAUF: Symrise AG bei 96,50 € (${demoTrade.positionSizeEuro.toFixed(0)} € · 8x Long)`,
          message: `${analysis.actionText} — Demo-Account hat automatisch ${demoTrade.quantityPieces || 3858} Stk. Turbo-Long für ${demoTrade.positionSizeEuro.toFixed(0)} € gekauft!`,
          price: latestBar.close,
          lodPrice: analysis.lodPrice,
          distanceFromLodPct: analysis.distanceFromLodPct,
          barsSinceFirstLow: analysis.barsSinceFirstLow,
          intradayChangePct: fundamentals.intradayChangePct,
          dipFromSwingHighPct: fundamentals.dipFromSwingHighPct,
          rsi14: analysis.rsi14,
          ema20: analysis.ema20,
          vwap: analysis.vwap,
          peReason: fundamentals.peReason,
          confluenceSignals: analysis.confluenceSignals,
          confluenceCount: analysis.confluenceCount,
          sizing,
          demoAccount: this.getDemoMetrics()
        },
        { forceTelegram: true }
      );
    }

    this.notifier.broadcastWs({
      type: 'SCAN_COMPLETED',
      snapshot: this.getSnapshot()
    });

    return { record: fullRecord, alert: alertResult };
  }

  /**
   * Berechnet alle Echtzeit-Kennzahlen des Demo-Accounts (Cash, investiertes Kapital, Unrealized PnL, Gesamt-Equity, Win-Rate).
   */
  getDemoMetrics() {
    const demo = this.state.demoAccount || DEFAULT_DEMO_ACCOUNT;
    let investedEuro = 0;
    let unrealizedPnlEuro = 0;

    for (const t of this.state.activeTrades) {
      if (t.status !== 'OPEN') continue;
      const posEuro = Number(t.positionSizeEuro || 0);
      investedEuro += posEuro;
      const rec = this.stockResults.get(t.symbol);
      const curPrice = Number(rec?.exactPriceEur || rec?.price || t.latestEvaluation?.currentPrice || t.entryPrice);
      const stockGainPct = t.entryPrice > 0 ? ((curPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
      const derivGainPct = stockGainPct * Number(t.leverage || 8);
      const openPnl = posEuro * (derivGainPct / 100);
      unrealizedPnlEuro += openPnl;
    }

    const cashEuro = Math.max(0, Math.round(Number(demo.cashEuro || 0) * 100) / 100);
    const currentPositionsValueEuro = Math.round((investedEuro + unrealizedPnlEuro) * 100) / 100;
    const totalEquityEuro = Math.round((cashEuro + currentPositionsValueEuro) * 100) / 100;
    const initialBalanceEuro = Number(demo.initialBalanceEuro || 10000);
    const totalReturnEuro = Math.round((totalEquityEuro - initialBalanceEuro) * 100) / 100;
    const totalReturnPct = initialBalanceEuro > 0
      ? Math.round(((totalEquityEuro - initialBalanceEuro) / initialBalanceEuro) * 10000) / 100
      : 0;
    const totalTrades = Number(demo.totalTrades || 0);
    const wins = Number(demo.wins || 0);
    const losses = Number(demo.losses || 0);
    const winRatePct = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;

    return {
      autoTradeEnabled: demo.autoTradeEnabled !== false,
      initialBalanceEuro,
      cashEuro,
      investedEuro: Math.round(investedEuro * 100) / 100,
      unrealizedPnlEuro: Math.round(unrealizedPnlEuro * 100) / 100,
      realizedPnlEuro: Math.round(Number(demo.realizedPnlEuro || 0) * 100) / 100,
      totalEquityEuro,
      totalReturnEuro,
      totalReturnPct,
      openPositionsCount: this.state.activeTrades.filter((t) => t.status === 'OPEN').length,
      totalTrades,
      closedTradesCount: totalTrades,
      wins,
      losses,
      winRatePct,
      equityCurve: (demo.equityCurve || []).slice(-60),
      orderHistory: (demo.orderHistory || []).slice(0, 40)
    };
  }

  /**
   * Setzt den Demo-Account auf Wunsch auf das Startkapital (z. B. 10.000 €) zurück.
   */
  resetDemoAccount(initialBalanceInput = 10000) {
    const startCap = Math.max(1000, Number(initialBalanceInput || 10000));
    this.state.activeTrades = [];
    this.state.journal = [];
    this.state.demoAccount = {
      autoTradeEnabled: true,
      initialBalanceEuro: startCap,
      cashEuro: startCap,
      realizedPnlEuro: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      equityCurve: [
        {
          time: new Date().toISOString(),
          equityEuro: startCap,
          label: 'Reset / Startkapital'
        }
      ],
      orderHistory: []
    };
    this.state.settings.accountCapital = startCap;
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_ACCOUNT_UPDATED',
      demoAccount: this.getDemoMetrics()
    });
    return this.getDemoMetrics();
  }

  toggleDemoAutoTrade(enabled) {
    this.state.demoAccount.autoTradeEnabled = Boolean(enabled);
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_ACCOUNT_UPDATED',
      demoAccount: this.getDemoMetrics()
    });
    return this.getDemoMetrics();
  }

  openActiveTrade(payload) {
    const symbol = String(payload.symbol || '').toUpperCase();
    const record = this.stockResults.get(symbol);
    const entryPrice = Number(payload.entryPrice || record?.exactPriceEur || record?.price || 100);
    const lodPrice = Number(payload.lodPrice || record?.analysis?.lodPrice || entryPrice * 0.985);
    const stopLossStock = Number(payload.stopLossStock || record?.sizing?.stopLossStock || lodPrice * 0.998);
    const leverage = Number(payload.leverage || record?.sizing?.activeLeverage || 8);

    const demo = this.state.demoAccount;
    const desiredSize = Number(payload.positionSizeEuro || record?.sizing?.positionSizeEuro || 2500);
    const availableCash = Math.max(0, Number(demo.cashEuro ?? 10000));
    const equityBefore = this.getDemoMetrics().totalEquityEuro || Number(demo.initialBalanceEuro || 10000);
    // Diversifikation: max. 25 % des Demo-Gesamtkapitals pro Auto-Lead, damit bis zu 4–5 Leads parallel laufen können
    const maxSingleAutoAlloc = Math.max(250, Math.round(equityBefore * 0.25 * 100) / 100);

    // Wenn kein Cash mehr frei ist (unter 250 €), kann kein neuer Auto-Trade eröffnet werden
    if (availableCash < 250 && payload.isDemoAuto) {
      return null;
    }

    const cappedDesired = payload.isDemoAuto ? Math.min(desiredSize, maxSingleAutoAlloc) : desiredSize;
    const positionSizeEuro = availableCash >= 250
      ? Math.round(Math.min(cappedDesired, availableCash) * 100) / 100
      : Math.round(cappedDesired * 100) / 100;

    // Ziehe Kaufbetrag vom verfügbaren Demo-Cash ab
    demo.cashEuro = Math.max(0, Math.round((availableCash - positionSizeEuro) * 100) / 100);

    const certEntryPrice = Number(payload.certEntryPrice || record?.sizing?.modelCertEntryPrice || 1.20);
    const quantityPieces = Number(payload.quantityPieces || Math.max(1, Math.floor(positionSizeEuro / certEntryPrice)));

    const trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      name: payload.name || record?.name || symbol,
      currency: '€',
      isDemoAuto: Boolean(payload.isDemoAuto ?? true),
      entryPrice: Math.round(entryPrice * 10000) / 10000,
      lodPrice: Math.round(lodPrice * 100) / 100,
      stopLossStock: Math.round(stopLossStock * 100) / 100,
      initialStopStock: Math.round(stopLossStock * 100) / 100,
      leverage,
      positionSizeEuro,
      quantityPieces,
      certEntryPrice,
      certStopPrice: Number(payload.certStopPrice || record?.sizing?.modelCertStopPrice || certEntryPrice * 0.9),
      catalystNote: payload.catalystNote || 'Phase-4-Lead (M10 Ausbruch)',
      peAtEntry: record?.fundamentals?.peValue || null,
      entryTime: Math.floor(Date.now() / 1000),
      openedAt: new Date().toISOString(),
      status: 'OPEN',
      breakEvenNotified: false,
      lastExitAlertType: null,
      latestEvaluation: null
    };

    const m10Bars = this.m10Store.get(symbol) || [];
    if (m10Bars.length > 0) {
      trade.latestEvaluation = evaluateActiveTrade(trade, m10Bars, record?.marketClock || {});
    }

    demo.orderHistory = [
      {
        id: `ord_buy_${Date.now()}`,
        action: 'BUY',
        timestamp: trade.openedAt,
        time: trade.openedAt,
        side: 'BUY (LEAD ENTRY)',
        symbol: trade.symbol,
        name: trade.name,
        priceEuro: trade.entryPrice,
        stockPriceEuro: trade.entryPrice,
        leverage: trade.leverage,
        positionSizeEuro: trade.positionSizeEuro,
        amountEuro: trade.positionSizeEuro,
        quantityPieces: trade.quantityPieces,
        stopLossEuro: trade.stopLossStock,
        note: trade.catalystNote
      },
      ...(demo.orderHistory || [])
    ].slice(0, 50);

    this.state.activeTrades.unshift(trade);
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_LIVE_TICK',
      serverTime: new Date().toISOString(),
      demoAccount: this.getDemoMetrics(),
      activeTrades: this.state.activeTrades,
      journal: this.state.journal.slice(0, 20),
      livePrices: {}
    });
    return trade;
  }

  closeActiveTrade(tradeId, exitPriceInput = null, exitReason = 'Stagnations-Exit (Kap. 06)') {
    const idx = this.state.activeTrades.findIndex((t) => t.id === tradeId);
    if (idx === -1) throw new Error('Trade nicht gefunden');

    const trade = this.state.activeTrades[idx];
    const record = this.stockResults.get(trade.symbol);
    const exitPrice = Number(
      exitPriceInput || trade.latestEvaluation?.currentPrice || record?.price || trade.entryPrice
    );

    const stockGainPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const derivGainPct = Math.max(-99, stockGainPct * trade.leverage);
    const pnlEuro = Math.round(trade.positionSizeEuro * (derivGainPct / 100) * 100) / 100;
    const payoutEuro = Math.max(0, Math.round((trade.positionSizeEuro + pnlEuro) * 100) / 100);
    const initialStop = Number(trade.initialStopStock || trade.stopLossStock);
    const riskPerShare = Math.max(0.01, trade.entryPrice - initialStop);
    const rMultiple = (exitPrice - trade.entryPrice) / riskPerShare;
    const stopDistancePct = (riskPerShare / trade.entryPrice) * 100;

    // Buche Rückfluss (Kaufbetrag + Gewinn/Verlust) auf das Demo-Cash-Konto
    const demo = this.state.demoAccount;
    demo.cashEuro = Math.round((Number(demo.cashEuro || 0) + payoutEuro) * 100) / 100;
    demo.realizedPnlEuro = Math.round((Number(demo.realizedPnlEuro || 0) + pnlEuro) * 100) / 100;
    demo.totalTrades = Number(demo.totalTrades || 0) + 1;
    if (pnlEuro >= 0) {
      demo.wins = Number(demo.wins || 0) + 1;
    } else {
      demo.losses = Number(demo.losses || 0) + 1;
    }

    this.state.activeTrades.splice(idx, 1);
    const updatedMetrics = this.getDemoMetrics();

    const journalEntry = {
      id: `journal_${Date.now()}`,
      symbol: trade.symbol,
      name: trade.name,
      currency: '€',
      openedAt: trade.openedAt,
      closedAt: new Date().toISOString(),
      catalystAndPe: `${trade.catalystNote}${trade.peAtEntry ? ` (KGV: ${trade.peAtEntry}x)` : ''}`,
      entryPrice: trade.entryPrice,
      lodPrice: trade.lodPrice,
      stopLossStock: trade.stopLossStock,
      stopDistancePct: Math.round(stopDistancePct * 100) / 100,
      exitPrice: Math.round(exitPrice * 100) / 100,
      leverage: trade.leverage,
      positionSizeEuro: Math.round(trade.positionSizeEuro),
      payoutEuro,
      stockGainPct: Math.round(stockGainPct * 100) / 100,
      derivGainPct: Math.round(derivGainPct * 10) / 10,
      pnlEuro,
      rMultiple: Math.round(rMultiple * 100) / 100,
      demoEquityAfterEuro: updatedMetrics.totalEquityEuro,
      exitReason
    };

    demo.orderHistory = [
      {
        id: `ord_sell_${Date.now()}`,
        action: 'SELL',
        timestamp: journalEntry.closedAt,
        time: journalEntry.closedAt,
        side: pnlEuro >= 0 ? 'SELL (TAKE-PROFIT)' : 'SELL (STOP-LOSS)',
        symbol: trade.symbol,
        name: trade.name,
        entryPriceEuro: trade.entryPrice,
        exitPriceEuro: journalEntry.exitPrice,
        stockPriceEuro: journalEntry.exitPrice,
        leverage: trade.leverage,
        payoutEuro,
        amountEuro: payoutEuro,
        pnlEuro,
        derivGainPct: journalEntry.derivGainPct,
        rMultiple: journalEntry.rMultiple,
        note: exitReason
      },
      ...(demo.orderHistory || [])
    ].slice(0, 50);

    this.state.journal.unshift(journalEntry);

    demo.equityCurve = [
      ...(demo.equityCurve || []),
      {
        time: journalEntry.closedAt,
        equityEuro: updatedMetrics.totalEquityEuro,
        pnlEuro,
        label: `${trade.symbol} (${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} €)`
      }
    ].slice(-60);

    // Passe das Berechnungs-Kapital dynamisch an den neuen Kontostand des Demo-Accounts an (Zinseszins / Compounding)
    this.state.settings.accountCapital = Math.round(updatedMetrics.totalEquityEuro);

    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_LIVE_TICK',
      serverTime: new Date().toISOString(),
      demoAccount: updatedMetrics,
      activeTrades: this.state.activeTrades,
      journal: this.state.journal.slice(0, 20),
      livePrices: {}
    });
    return journalEntry;
  }

  /**
   * Berechnet das Live-Gesamtkapital (Equity), freies Cash, investiertes Kapital
   * und den unrealisierten Gewinn/Verlust für Account #2 (Reverse Short-Strategie).
   */
  getReverseDemoMetrics() {
    const demo = this.state.reverseDemoAccount || {
      autoTradeEnabled: true,
      initialBalanceEuro: 10000,
      cashEuro: 10000,
      realizedPnlEuro: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      equityCurve: [],
      orderHistory: []
    };

    const revTrades = this.state.reverseActiveTrades || [];
    let investedEuro = 0;
    let unrealizedPnlEuro = 0;

    for (const trade of revTrades) {
      if (trade.status !== 'OPEN') continue;
      const size = Number(trade.positionSizeEuro || 0);
      investedEuro += size;

      const record = this.stockResults.get(trade.symbol);
      const currentPrice = Number(
        record?.exactPriceEur ??
        trade.latestEvaluation?.currentPrice ??
        record?.price ??
        trade.entryPrice
      );

      // Reverse (Short): Gewinn entsteht wenn currentPrice < entryPrice
      const stockGainPct = trade.entryPrice > 0
        ? ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100
        : 0;
      const derivGainPct = Math.max(-99, stockGainPct * Number(trade.leverage || 8));
      const pnl = Math.round(size * (derivGainPct / 100) * 100) / 100;
      unrealizedPnlEuro += pnl;
    }

    const cashEuro = Math.round(Number(demo.cashEuro ?? 10000) * 100) / 100;
    const currentPositionsValueEuro = Math.round((investedEuro + unrealizedPnlEuro) * 100) / 100;
    const totalEquityEuro = Math.round((cashEuro + currentPositionsValueEuro) * 100) / 100;
    const initialBalanceEuro = Number(demo.initialBalanceEuro || 10000);
    const totalReturnEuro = Math.round((totalEquityEuro - initialBalanceEuro) * 100) / 100;
    const totalReturnPct = initialBalanceEuro > 0
      ? Math.round(((totalEquityEuro - initialBalanceEuro) / initialBalanceEuro) * 10000) / 100
      : 0;
    const totalTrades = Number(demo.totalTrades || 0);
    const wins = Number(demo.wins || 0);
    const losses = Number(demo.losses || 0);
    const winRatePct = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;

    return {
      autoTradeEnabled: demo.autoTradeEnabled !== false,
      strategyMode: 'REVERSE_SHORT',
      initialBalanceEuro,
      cashEuro,
      investedEuro: Math.round(investedEuro * 100) / 100,
      unrealizedPnlEuro: Math.round(unrealizedPnlEuro * 100) / 100,
      realizedPnlEuro: Math.round(Number(demo.realizedPnlEuro || 0) * 100) / 100,
      totalEquityEuro,
      totalReturnEuro,
      totalReturnPct,
      openPositionsCount: revTrades.filter((t) => t.status === 'OPEN').length,
      totalTrades,
      closedTradesCount: totalTrades,
      wins,
      losses,
      winRatePct,
      equityCurve: (demo.equityCurve || []).slice(-60),
      orderHistory: (demo.orderHistory || []).slice(0, 40)
    };
  }

  /**
   * Setzt Account #2 (Reverse Short) auf das Startkapital (10.000 €) zurück,
   * oder synchronisiert ihn auf Wunsch neu mit der Historie von Account #1.
   */
  resetReverseDemoAccount(initialBalanceInput = 10000, resyncFromMain = false) {
    if (resyncFromMain) {
      this.syncReverseFromMainHistory();
      this.notifier.broadcastWs({
        type: 'DEMO_ACCOUNT_UPDATED',
        demoAccount: this.getDemoMetrics(),
        reverseDemoAccount: this.getReverseDemoMetrics()
      });
      return this.getReverseDemoMetrics();
    }

    const startCap = Math.max(1000, Number(initialBalanceInput || 10000));
    this.state.reverseActiveTrades = [];
    this.state.reverseJournal = [];
    this.state.reverseDemoAccount = {
      autoTradeEnabled: true,
      strategyMode: 'REVERSE_SHORT',
      backfilledFromMain: true,
      initialBalanceEuro: startCap,
      cashEuro: startCap,
      realizedPnlEuro: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      equityCurve: [
        {
          time: new Date().toISOString(),
          equityEuro: startCap,
          label: 'Reset / Startkapital (Account #2 Reverse)'
        }
      ],
      orderHistory: []
    };
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_ACCOUNT_UPDATED',
      demoAccount: this.getDemoMetrics(),
      reverseDemoAccount: this.getReverseDemoMetrics()
    });
    return this.getReverseDemoMetrics();
  }

  toggleReverseDemoAutoTrade(enabled) {
    if (!this.state.reverseDemoAccount) {
      this.ensureReverseAccountBackfilled();
    }
    this.state.reverseDemoAccount.autoTradeEnabled = Boolean(enabled);
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_ACCOUNT_UPDATED',
      demoAccount: this.getDemoMetrics(),
      reverseDemoAccount: this.getReverseDemoMetrics()
    });
    return this.getReverseDemoMetrics();
  }

  openReverseActiveTrade(payload) {
    const symbol = String(payload.symbol || '').toUpperCase();
    const record = this.stockResults.get(symbol);
    const entryPrice = Number(payload.entryPrice || record?.exactPriceEur || record?.price || 100);
    const lodPrice = Number(payload.lodPrice || record?.analysis?.lodPrice || entryPrice * 0.985);
    const longStopStock = Number(payload.stopLossStock || record?.sizing?.stopLossStock || lodPrice * 0.998);
    // Beim Reverse-Short liegt der Stop-Loss symmetrisch OBERHALB des Einstiegskurses
    const riskDist = Math.max(entryPrice * 0.012, Math.abs(entryPrice - longStopStock));
    const upperStopStock = Math.round((entryPrice + riskDist) * 100) / 100;
    const leverage = Number(payload.leverage || record?.sizing?.activeLeverage || 8);

    const revDemo = this.state.reverseDemoAccount;
    const desiredSize = Number(payload.positionSizeEuro || record?.sizing?.positionSizeEuro || 2500);
    const availableCash = Math.max(0, Number(revDemo.cashEuro ?? 10000));
    const equityBefore = this.getReverseDemoMetrics().totalEquityEuro || Number(revDemo.initialBalanceEuro || 10000);
    const maxSingleAutoAlloc = Math.max(250, Math.round(equityBefore * 0.25 * 100) / 100);

    if (availableCash < 250 && payload.isDemoAuto) {
      return null;
    }

    const cappedDesired = payload.isDemoAuto ? Math.min(desiredSize, maxSingleAutoAlloc) : desiredSize;
    const positionSizeEuro = availableCash >= 250
      ? Math.round(Math.min(cappedDesired, availableCash) * 100) / 100
      : Math.round(cappedDesired * 100) / 100;

    revDemo.cashEuro = Math.max(0, Math.round((availableCash - positionSizeEuro) * 100) / 100);

    const certEntryPrice = Number(payload.certEntryPrice || record?.sizing?.modelCertEntryPrice || 1.20);
    const quantityPieces = Number(payload.quantityPieces || Math.max(1, Math.floor(positionSizeEuro / certEntryPrice)));

    const trade = {
      id: `rev_trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      name: payload.name || record?.name || symbol,
      direction: 'SHORT',
      currency: '€',
      isDemoAuto: Boolean(payload.isDemoAuto ?? true),
      entryPrice: Math.round(entryPrice * 10000) / 10000,
      lodPrice: Math.round(lodPrice * 100) / 100,
      stopLossStock: upperStopStock,
      leverage,
      positionSizeEuro,
      quantityPieces,
      certEntryPrice,
      certStopPrice: Number(payload.certStopPrice || record?.sizing?.modelCertStopPrice || certEntryPrice * 0.9),
      catalystNote: payload.catalystNote || 'Reverse-Short gegen Phase-4-Lead',
      peAtEntry: record?.fundamentals?.peValue || null,
      entryTime: Math.floor(Date.now() / 1000),
      openedAt: new Date().toISOString(),
      status: 'OPEN',
      breakEvenNotified: false,
      lastExitAlertType: null,
      latestEvaluation: null
    };

    const m10Bars = this.m10Store.get(symbol) || [];
    if (m10Bars.length > 0) {
      trade.latestEvaluation = evaluateReverseActiveTrade(trade, m10Bars, record?.marketClock || {});
    }

    revDemo.orderHistory = [
      {
        id: `rev_ord_short_${Date.now()}`,
        action: 'BUY',
        timestamp: trade.openedAt,
        time: trade.openedAt,
        side: 'SHORT (REVERSE ENTRY)',
        symbol: trade.symbol,
        name: trade.name,
        priceEuro: trade.entryPrice,
        stockPriceEuro: trade.entryPrice,
        leverage: trade.leverage,
        positionSizeEuro: trade.positionSizeEuro,
        amountEuro: trade.positionSizeEuro,
        quantityPieces: trade.quantityPieces,
        stopLossEuro: trade.stopLossStock,
        note: trade.catalystNote
      },
      ...(revDemo.orderHistory || [])
    ].slice(0, 50);

    this.state.reverseActiveTrades.unshift(trade);
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_LIVE_TICK',
      serverTime: new Date().toISOString(),
      demoAccount: this.getDemoMetrics(),
      activeTrades: this.state.activeTrades,
      journal: this.state.journal.slice(0, 20),
      reverseDemoAccount: this.getReverseDemoMetrics(),
      reverseActiveTrades: this.state.reverseActiveTrades,
      reverseJournal: this.state.reverseJournal.slice(0, 20),
      livePrices: {}
    });
    return trade;
  }

  closeReverseActiveTrade(tradeId, exitPriceInput = null, exitReason = 'Reverse Take-Profit / Cover') {
    const idx = this.state.reverseActiveTrades.findIndex((t) => t.id === tradeId);
    if (idx === -1) throw new Error('Reverse-Trade nicht gefunden');

    const trade = this.state.reverseActiveTrades[idx];
    const record = this.stockResults.get(trade.symbol);
    const exitPrice = Number(
      exitPriceInput || trade.latestEvaluation?.currentPrice || record?.price || trade.entryPrice
    );

    // Reverse (Short): Gewinn wenn exitPrice < entryPrice
    const stockGainPct = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
    const derivGainPct = Math.max(-99, stockGainPct * trade.leverage);
    const pnlEuro = Math.round(trade.positionSizeEuro * (derivGainPct / 100) * 100) / 100;
    const payoutEuro = Math.max(0, Math.round((trade.positionSizeEuro + pnlEuro) * 100) / 100);
    const riskPerShare = Math.max(0.01, Math.abs(trade.stopLossStock - trade.entryPrice));
    const rMultiple = (trade.entryPrice - exitPrice) / riskPerShare;
    const stopDistancePct = (riskPerShare / trade.entryPrice) * 100;

    const revDemo = this.state.reverseDemoAccount;
    revDemo.cashEuro = Math.round((Number(revDemo.cashEuro || 0) + payoutEuro) * 100) / 100;
    revDemo.realizedPnlEuro = Math.round((Number(revDemo.realizedPnlEuro || 0) + pnlEuro) * 100) / 100;
    revDemo.totalTrades = Number(revDemo.totalTrades || 0) + 1;
    if (pnlEuro >= 0) {
      revDemo.wins = Number(revDemo.wins || 0) + 1;
    } else {
      revDemo.losses = Number(revDemo.losses || 0) + 1;
    }

    this.state.reverseActiveTrades.splice(idx, 1);
    const updatedMetrics = this.getReverseDemoMetrics();

    const journalEntry = {
      id: `rev_journal_${Date.now()}`,
      symbol: trade.symbol,
      name: trade.name,
      direction: 'SHORT',
      currency: '€',
      openedAt: trade.openedAt,
      closedAt: new Date().toISOString(),
      catalystAndPe: `${trade.catalystNote}${trade.peAtEntry ? ` (KGV: ${trade.peAtEntry}x)` : ''}`,
      entryPrice: trade.entryPrice,
      lodPrice: trade.lodPrice,
      stopLossStock: trade.stopLossStock,
      stopDistancePct: Math.round(stopDistancePct * 100) / 100,
      exitPrice: Math.round(exitPrice * 100) / 100,
      leverage: trade.leverage,
      positionSizeEuro: Math.round(trade.positionSizeEuro),
      payoutEuro,
      stockGainPct: Math.round(stockGainPct * 100) / 100,
      derivGainPct: Math.round(derivGainPct * 10) / 10,
      pnlEuro,
      rMultiple: Math.round(rMultiple * 100) / 100,
      demoEquityAfterEuro: updatedMetrics.totalEquityEuro,
      exitReason
    };

    revDemo.orderHistory = [
      {
        id: `rev_ord_cover_${Date.now()}`,
        action: 'SELL',
        timestamp: journalEntry.closedAt,
        time: journalEntry.closedAt,
        side: pnlEuro >= 0 ? 'COVER (SHORT TAKE-PROFIT)' : 'COVER (SHORT STOP-LOSS)',
        symbol: trade.symbol,
        name: trade.name,
        entryPriceEuro: trade.entryPrice,
        exitPriceEuro: journalEntry.exitPrice,
        stockPriceEuro: journalEntry.exitPrice,
        leverage: trade.leverage,
        payoutEuro,
        amountEuro: payoutEuro,
        pnlEuro,
        derivGainPct: journalEntry.derivGainPct,
        rMultiple: journalEntry.rMultiple,
        note: exitReason
      },
      ...(revDemo.orderHistory || [])
    ].slice(0, 50);

    this.state.reverseJournal.unshift(journalEntry);

    revDemo.equityCurve = [
      ...(revDemo.equityCurve || []),
      {
        time: journalEntry.closedAt,
        equityEuro: updatedMetrics.totalEquityEuro,
        pnlEuro,
        label: `SHORT ${trade.symbol} (${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} €)`
      }
    ].slice(-60);

    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_LIVE_TICK',
      serverTime: new Date().toISOString(),
      demoAccount: this.getDemoMetrics(),
      activeTrades: this.state.activeTrades,
      journal: this.state.journal.slice(0, 20),
      reverseDemoAccount: updatedMetrics,
      reverseActiveTrades: this.state.reverseActiveTrades,
      reverseJournal: this.state.reverseJournal.slice(0, 20),
      livePrices: {}
    });
    return journalEntry;
  }

  // --- TAGES-ACCOUNTS (10.000 € PRO HANDELSTAG: TAGES-LONG & TAGES-SHORT) ---

  getDailyMetrics(side = 'long', { skipRollover = false } = {}) {
    if (!skipRollover) {
      this.rolloverDailyAccountsIfNeeded();
    }
    const ds = this.state.dailySession || createEmptyDailySession();
    const isShort = side === 'short';
    const acc = isShort ? ds.shortAccount : ds.longAccount;
    const trades = isShort ? (ds.shortActiveTrades || []) : (ds.longActiveTrades || []);

    let investedEuro = 0;
    let unrealizedPnlEuro = 0;

    for (const trade of trades) {
      if (trade.status !== 'OPEN') continue;
      const size = Number(trade.positionSizeEuro || 0);
      investedEuro += size;

      const record = this.stockResults.get(trade.symbol);
      const currentPrice = Number(
        record?.exactPriceEur ??
        trade.latestEvaluation?.currentPrice ??
        record?.price ??
        trade.entryPrice
      );

      const stockGainPct = trade.entryPrice > 0
        ? (isShort
          ? ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100
          : ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100)
        : 0;
      const derivGainPct = Math.max(-99, stockGainPct * Number(trade.leverage || 8));
      const pnl = Math.round(size * (derivGainPct / 100) * 100) / 100;
      unrealizedPnlEuro += pnl;
    }

    const cashEuro = Math.round(Number(acc?.cashEuro ?? 10000) * 100) / 100;
    const currentPositionsValueEuro = Math.round((investedEuro + unrealizedPnlEuro) * 100) / 100;
    const totalEquityEuro = Math.round((cashEuro + currentPositionsValueEuro) * 100) / 100;
    const initialBalanceEuro = Number(acc?.initialBalanceEuro || 10000);
    const totalReturnEuro = Math.round((totalEquityEuro - initialBalanceEuro) * 100) / 100;
    const totalReturnPct = initialBalanceEuro > 0
      ? Math.round(((totalEquityEuro - initialBalanceEuro) / initialBalanceEuro) * 10000) / 100
      : 0;
    const totalTrades = Number(acc?.totalTrades || 0);
    const wins = Number(acc?.wins || 0);
    const losses = Number(acc?.losses || 0);
    const winRatePct = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;

    return {
      date: ds.date,
      side: isShort ? 'SHORT' : 'LONG',
      autoTradeEnabled: acc?.autoTradeEnabled !== false,
      initialBalanceEuro,
      cashEuro,
      investedEuro: Math.round(investedEuro * 100) / 100,
      unrealizedPnlEuro: Math.round(unrealizedPnlEuro * 100) / 100,
      realizedPnlEuro: Math.round(Number(acc?.realizedPnlEuro || 0) * 100) / 100,
      totalEquityEuro,
      totalReturnEuro,
      totalReturnPct,
      openPositionsCount: trades.filter((t) => t.status === 'OPEN').length,
      totalTrades,
      closedTradesCount: totalTrades,
      wins,
      losses,
      winRatePct,
      equityCurve: (acc?.equityCurve || []).slice(-60),
      orderHistory: (acc?.orderHistory || []).slice(0, 40)
    };
  }

  getDailySessionPayload() {
    this.rolloverDailyAccountsIfNeeded();
    const ds = this.state.dailySession || createEmptyDailySession();
    return {
      date: ds.date,
      longAccount: this.getDailyMetrics('long'),
      shortAccount: this.getDailyMetrics('short'),
      longActiveTrades: ds.longActiveTrades || [],
      shortActiveTrades: ds.shortActiveTrades || [],
      longJournal: ds.longJournal || [],
      shortJournal: ds.shortJournal || []
    };
  }

  resetDailyAccount(side = 'long', initialBalanceInput = 10000) {
    this.rolloverDailyAccountsIfNeeded();
    const ds = this.state.dailySession;
    const startCap = Math.max(1000, Number(initialBalanceInput || 10000));
    const freshAcc = {
      autoTradeEnabled: true,
      initialBalanceEuro: startCap,
      cashEuro: startCap,
      realizedPnlEuro: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      equityCurve: [{ time: new Date().toISOString(), equityEuro: startCap, label: `Reset ${ds.date}` }],
      orderHistory: []
    };
    if (side === 'short') {
      ds.shortAccount = freshAcc;
      ds.shortActiveTrades = [];
      ds.shortJournal = [];
    } else {
      ds.longAccount = freshAcc;
      ds.longActiveTrades = [];
      ds.longJournal = [];
    }
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_ACCOUNT_UPDATED',
      demoAccount: this.getDemoMetrics(),
      reverseDemoAccount: this.getReverseDemoMetrics(),
      dailySession: this.getDailySessionPayload(),
      dailyAccountsHistory: this.state.dailyAccountsHistory || []
    });
    return this.getDailyMetrics(side);
  }

  toggleDailyAutoTrade(side = 'long', enabled = true) {
    this.rolloverDailyAccountsIfNeeded();
    const ds = this.state.dailySession;
    if (side === 'short') {
      ds.shortAccount.autoTradeEnabled = Boolean(enabled);
    } else {
      ds.longAccount.autoTradeEnabled = Boolean(enabled);
    }
    this.saveState();
    this.notifier.broadcastWs({
      type: 'DEMO_ACCOUNT_UPDATED',
      demoAccount: this.getDemoMetrics(),
      reverseDemoAccount: this.getReverseDemoMetrics(),
      dailySession: this.getDailySessionPayload(),
      dailyAccountsHistory: this.state.dailyAccountsHistory || []
    });
    return this.getDailyMetrics(side);
  }

  openDailyTrade(side = 'long', payload = {}) {
    this.rolloverDailyAccountsIfNeeded();
    const ds = this.state.dailySession;
    const isShort = side === 'short';
    const acc = isShort ? ds.shortAccount : ds.longAccount;
    const activeList = isShort ? ds.shortActiveTrades : ds.longActiveTrades;

    const symbol = String(payload.symbol || '').toUpperCase();
    const record = this.stockResults.get(symbol);
    const entryPrice = Number(payload.entryPrice || record?.exactPriceEur || record?.price || 100);
    const lodPrice = Number(payload.lodPrice || record?.analysis?.lodPrice || entryPrice * 0.985);
    const longStopStock = Number(payload.stopLossStock || record?.sizing?.stopLossStock || lodPrice * 0.998);
    const riskDist = Math.max(entryPrice * 0.012, Math.abs(entryPrice - longStopStock));
    const stopLossStock = isShort
      ? Math.round((entryPrice + riskDist) * 100) / 100
      : Math.round(longStopStock * 100) / 100;
    const leverage = Number(payload.leverage || record?.sizing?.activeLeverage || 8);

    const desiredSize = Number(payload.positionSizeEuro || record?.sizing?.positionSizeEuro || 2500);
    const availableCash = Math.max(0, Number(acc.cashEuro ?? 10000));
    const equityBefore = this.getDailyMetrics(side).totalEquityEuro || Number(acc.initialBalanceEuro || 10000);
    const maxSingleAutoAlloc = Math.max(250, Math.round(equityBefore * 0.25 * 100) / 100);

    if (availableCash < 250 && payload.isDemoAuto) {
      return null;
    }

    const cappedDesired = payload.isDemoAuto ? Math.min(desiredSize, maxSingleAutoAlloc) : desiredSize;
    const positionSizeEuro = availableCash >= 250
      ? Math.round(Math.min(cappedDesired, availableCash) * 100) / 100
      : Math.round(cappedDesired * 100) / 100;

    acc.cashEuro = Math.max(0, Math.round((availableCash - positionSizeEuro) * 100) / 100);

    const certEntryPrice = Number(payload.certEntryPrice || record?.sizing?.modelCertEntryPrice || 1.20);
    const quantityPieces = Number(payload.quantityPieces || Math.max(1, Math.floor(positionSizeEuro / certEntryPrice)));

    const trade = {
      id: `daily_${side}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      name: payload.name || record?.name || symbol,
      direction: isShort ? 'SHORT' : 'LONG',
      dailyDate: ds.date,
      currency: '€',
      isDemoAuto: Boolean(payload.isDemoAuto ?? true),
      entryPrice: Math.round(entryPrice * 10000) / 10000,
      lodPrice: Math.round(lodPrice * 100) / 100,
      stopLossStock,
      initialStopStock: stopLossStock,
      leverage,
      positionSizeEuro,
      quantityPieces,
      certEntryPrice,
      certStopPrice: Number(payload.certStopPrice || record?.sizing?.modelCertStopPrice || certEntryPrice * 0.9),
      catalystNote: payload.catalystNote || `Tages-${isShort ? 'Short' : 'Long'} (${ds.date})`,
      peAtEntry: record?.fundamentals?.peValue || null,
      entryTime: Math.floor(Date.now() / 1000),
      openedAt: new Date().toISOString(),
      status: 'OPEN',
      breakEvenNotified: false,
      lastExitAlertType: null,
      latestEvaluation: null
    };

    const m10Bars = this.m10Store.get(symbol) || [];
    if (m10Bars.length > 0) {
      trade.latestEvaluation = isShort
        ? evaluateReverseActiveTrade(trade, m10Bars, record?.marketClock || {})
        : evaluateActiveTrade(trade, m10Bars, record?.marketClock || {});
    }

    acc.orderHistory = [
      {
        id: `daily_ord_${side}_${Date.now()}`,
        action: 'BUY',
        timestamp: trade.openedAt,
        time: trade.openedAt,
        side: isShort ? `SHORT (TAGES-KONTO ${ds.date})` : `BUY (TAGES-KONTO ${ds.date})`,
        symbol: trade.symbol,
        name: trade.name,
        priceEuro: trade.entryPrice,
        stockPriceEuro: trade.entryPrice,
        leverage: trade.leverage,
        positionSizeEuro: trade.positionSizeEuro,
        amountEuro: trade.positionSizeEuro,
        quantityPieces: trade.quantityPieces,
        stopLossEuro: trade.stopLossStock,
        note: trade.catalystNote
      },
      ...(acc.orderHistory || [])
    ].slice(0, 50);

    activeList.unshift(trade);
    this.saveState();
    return trade;
  }

  closeDailyTrade(side = 'long', tradeId, exitPriceInput = null, exitReason = 'Tages-Exit') {
    const ds = this.state.dailySession;
    if (!ds) throw new Error('Kein aktiver Tages-Account');
    const isShort = side === 'short';
    const acc = isShort ? ds.shortAccount : ds.longAccount;
    const activeList = isShort ? ds.shortActiveTrades : ds.longActiveTrades;
    const journalList = isShort ? ds.shortJournal : ds.longJournal;

    const idx = activeList.findIndex((t) => t.id === tradeId);
    if (idx === -1) throw new Error('Tages-Trade nicht gefunden');

    const trade = activeList[idx];
    const record = this.stockResults.get(trade.symbol);
    const exitPrice = Number(
      exitPriceInput || trade.latestEvaluation?.currentPrice || record?.price || trade.entryPrice
    );

    const stockGainPct = isShort
      ? ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100
      : ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const derivGainPct = Math.max(-99, stockGainPct * trade.leverage);
    const pnlEuro = Math.round(trade.positionSizeEuro * (derivGainPct / 100) * 100) / 100;
    const payoutEuro = Math.max(0, Math.round((trade.positionSizeEuro + pnlEuro) * 100) / 100);
    const initialStop = Number(trade.initialStopStock || trade.stopLossStock);
    const riskPerShare = Math.max(0.01, Math.abs(initialStop - trade.entryPrice));
    const rMultiple = isShort
      ? (trade.entryPrice - exitPrice) / riskPerShare
      : (exitPrice - trade.entryPrice) / riskPerShare;
    const stopDistancePct = (riskPerShare / trade.entryPrice) * 100;

    acc.cashEuro = Math.round((Number(acc.cashEuro || 0) + payoutEuro) * 100) / 100;
    acc.realizedPnlEuro = Math.round((Number(acc.realizedPnlEuro || 0) + pnlEuro) * 100) / 100;
    acc.totalTrades = Number(acc.totalTrades || 0) + 1;
    if (pnlEuro >= 0) {
      acc.wins = Number(acc.wins || 0) + 1;
    } else {
      acc.losses = Number(acc.losses || 0) + 1;
    }

    activeList.splice(idx, 1);
    const updatedMetrics = this.getDailyMetrics(side);

    const journalEntry = {
      id: `daily_j_${side}_${Date.now()}`,
      symbol: trade.symbol,
      name: trade.name,
      direction: isShort ? 'SHORT' : 'LONG',
      dailyDate: ds.date,
      currency: '€',
      openedAt: trade.openedAt,
      closedAt: new Date().toISOString(),
      catalystAndPe: `${trade.catalystNote}${trade.peAtEntry ? ` (KGV: ${trade.peAtEntry}x)` : ''}`,
      entryPrice: trade.entryPrice,
      lodPrice: trade.lodPrice,
      stopLossStock: trade.stopLossStock,
      stopDistancePct: Math.round(stopDistancePct * 100) / 100,
      exitPrice: Math.round(exitPrice * 100) / 100,
      leverage: trade.leverage,
      positionSizeEuro: Math.round(trade.positionSizeEuro),
      payoutEuro,
      stockGainPct: Math.round(stockGainPct * 100) / 100,
      derivGainPct: Math.round(derivGainPct * 10) / 10,
      pnlEuro,
      rMultiple: Math.round(rMultiple * 100) / 100,
      demoEquityAfterEuro: updatedMetrics.totalEquityEuro,
      exitReason
    };

    acc.orderHistory = [
      {
        id: `daily_ord_close_${side}_${Date.now()}`,
        action: 'SELL',
        timestamp: journalEntry.closedAt,
        time: journalEntry.closedAt,
        side: isShort ? 'COVER (TAGES-SHORT)' : 'SELL (TAGES-LONG)',
        symbol: trade.symbol,
        name: trade.name,
        entryPriceEuro: trade.entryPrice,
        exitPriceEuro: journalEntry.exitPrice,
        stockPriceEuro: journalEntry.exitPrice,
        leverage: trade.leverage,
        payoutEuro,
        amountEuro: payoutEuro,
        pnlEuro,
        derivGainPct: journalEntry.derivGainPct,
        rMultiple: journalEntry.rMultiple,
        note: exitReason
      },
      ...(acc.orderHistory || [])
    ].slice(0, 50);

    journalList.unshift(journalEntry);

    acc.equityCurve = [
      ...(acc.equityCurve || []),
      {
        time: journalEntry.closedAt,
        equityEuro: updatedMetrics.totalEquityEuro,
        pnlEuro,
        label: `${isShort ? 'SHORT' : 'LONG'} ${trade.symbol} (${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} €)`
      }
    ].slice(-60);

    this.saveState();
    return journalEntry;
  }

  getM10ChartData(symbol) {
    return this.m10Store.get(symbol) || [];
  }

  getSnapshot() {
    this.rolloverDailyAccountsIfNeeded();
    const stocks = Array.from(this.stockResults.values()).sort((a, b) => {
      const pa = a.analysis?.phase ?? -9;
      const pb = b.analysis?.phase ?? -9;
      if (pb !== pa) return pb - pa;
      const ca = a.analysis?.confluenceCount ?? 0;
      const cb = b.analysis?.confluenceCount ?? 0;
      if (cb !== ca) return cb - ca;
      return (a.intradayChangePct || 0) - (b.intradayChangePct || 0);
    });

    return {
      isScanning: this.isScanning,
      lastScanAt: this.lastScanAt,
      nextScanAt: this.nextScanAt,
      settings: this.state.settings,
      demoAccount: this.getDemoMetrics(),
      reverseDemoAccount: this.getReverseDemoMetrics(),
      dailySession: this.getDailySessionPayload(),
      dailyAccountsHistory: this.state.dailyAccountsHistory || [],
      indexRegimes: this.indexRegimes,
      stocks,
      activeTrades: this.state.activeTrades,
      journal: this.state.journal,
      reverseActiveTrades: this.state.reverseActiveTrades,
      reverseJournal: this.state.reverseJournal,
      alerts: this.notifier.alertHistory,
      news: this.newsItems || [],
      hiddenSymbolsCount: (this.state.hiddenSymbols || []).length
    };
  }
}
