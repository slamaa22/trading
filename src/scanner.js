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
  calculateRiskAndPositionSizing,
  evaluateActiveTrade,
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
        return {
          settings: mergedSettings,
          demoAccount: mergedDemo,
          customStocks: Array.isArray(raw.customStocks) ? raw.customStocks : [],
          activeTrades: Array.isArray(raw.activeTrades) ? raw.activeTrades : [],
          journal: Array.isArray(raw.journal) ? raw.journal : []
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
      customStocks: [],
      activeTrades: [],
      journal: []
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
    const map = new Map();
    for (const s of DEFAULT_UNIVERSE) map.set(s.symbol, s);
    for (const c of this.state.customStocks) map.set(c.symbol, c);
    return Array.from(map.values());
  }

  addCustomStock(stock) {
    const symbol = String(stock.symbol || '').trim().toUpperCase();
    if (!symbol) throw new Error('Symbol fehlt');
    const entry = {
      symbol,
      name: stock.name || symbol,
      index: stock.index || (symbol.includes('.') ? 'DAX' : 'SP500'),
      sector: stock.sector || 'Watchlist',
      profile: stock.profile || 'conservative',
      currency: stock.currency || (symbol.endsWith('.SW') ? 'CHF' : symbol.includes('.') ? 'EUR' : 'USD'),
      isCustom: true
    };
    this.state.customStocks = [
      ...this.state.customStocks.filter((s) => s.symbol !== symbol),
      entry
    ];
    this.saveState();
    return entry;
  }

  removeCustomStock(symbol) {
    const clean = String(symbol || '').trim().toUpperCase();
    this.state.customStocks = this.state.customStocks.filter((s) => s.symbol !== clean);
    this.stockResults.delete(clean);
    this.saveState();
  }

  startAutoScan() {
    this.restartAutoScan();
    this.startDemoLiveTicker();
    this.runFullScan({ reason: 'initial' }).catch((err) => {
      console.error('Initialer Scan-Fehler:', err.message);
    });
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
      const openTrades = this.state.activeTrades.filter((t) => t.status === 'OPEN');
      const liveSymbolSet = new Set();

      for (const t of openTrades) {
        if (t.symbol) liveSymbolSet.add(t.symbol);
      }
      for (const sym of this.watchedSymbols.values()) {
        if (sym) liveSymbolSet.add(sym);
      }

      const livePrices = {};
      const targetSymbols = Array.from(liveSymbolSet).slice(0, 15);

      if (targetSymbols.length > 0 && this.notifier.wsClients.size > 0) {
        try {
          const quoteMap = await this.marketData.fetchBatchQuotes(targetSymbols, { timeoutMs: 850 });
          for (const sym of targetSymbols) {
            const rawQ = quoteMap.get(sym);
            const rec = this.stockResults.get(sym);
            if (!rawQ || !rec || rec.isSimulation) continue;

            const fx = this.getFxRateToEur(rec.nativeCurrency || rawQ.currency || 'EUR');
            const qEur = this.convertQuoteToEur(rawQ, fx);
            const newPrice = Number(qEur.regularMarketPrice || 0);
            if (newPrice > 0) {
              rec.price = Math.round(newPrice * 100) / 100;
              rec.intradayChangePct = Math.round(Number(rawQ.regularMarketChangePercent ?? rec.intradayChangePct ?? 0) * 100) / 100;
              if (rec.analysis) rec.analysis.currentPrice = rec.price;
              rec.updatedAt = new Date().toISOString();

              const bars = this.m10Store.get(sym);
              let lastBar = null;
              if (Array.isArray(bars) && bars.length > 0) {
                lastBar = bars[bars.length - 1];
                lastBar.close = rec.price;
                if (rec.price > lastBar.high) lastBar.high = rec.price;
                if (rec.price < lastBar.low) lastBar.low = rec.price;
              }

              livePrices[sym] = {
                price: rec.price,
                intradayChangePct: rec.intradayChangePct,
                lastBar
              };
            }
          }
        } catch {
          // Wenn einzelner 1s-Quote-Abruf langsam ist, trotzdem Demo-Account-Tick senden
        }
      }

      if (openTrades.length > 0) {
        await this.evaluateAllActiveTrades();
      }

      if (this.notifier.wsClients.size > 0) {
        this.notifier.broadcastWs({
          type: 'DEMO_LIVE_TICK',
          serverTime: new Date().toISOString(),
          demoAccount: this.getDemoMetrics(),
          activeTrades: this.state.activeTrades,
          journal: this.state.journal.slice(0, 20),
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

      // 4. Sortieren nach Dip-Relevanz (größte Tagesverlierer + noch nicht geladene M10-Charts zuerst)
      const rankedUniverse = [...universe].sort((a, b) => {
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

      // Pro Scan-Zyklus die 60 wichtigsten Dips/Kandidaten tiefenscannen
      const deepScanTargets = rankedUniverse.slice(0, 60);
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
      }

      const currentPrice =
        quote?.regularMarketPrice ||
        (m10Bars.length > 0 ? m10Bars[m10Bars.length - 1].close : 0);

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

      // WICHTIG: Benachrichtigung & automatischer Demo-Account-Trade NUR bei echtem Kauf-Lead (Phase 4 Entry)!
      const lastSession = m10Bars.length > 0 ? m10Bars[m10Bars.length - 1].sessionDate : 'today';
      if (
        analysis.phase === 4 &&
        this.notifier.shouldTriggerPhaseAlert(stockMeta.symbol, 4, lastSession)
      ) {
        let openedDemoTrade = null;
        const alreadyOpen = this.state.activeTrades.some(
          (t) => t.symbol === stockMeta.symbol && t.status === 'OPEN'
        );
        if (
          !alreadyOpen &&
          this.state.demoAccount.autoTradeEnabled !== false &&
          Number(this.state.demoAccount.cashEuro || 0) >= 250
        ) {
          openedDemoTrade = this.openActiveTrade({
            symbol: stockMeta.symbol,
            name: stockMeta.name,
            currency: '€',
            isDemoAuto: true,
            entryPrice: fullRecord.price,
            lodPrice: analysis.lodPrice,
            stopLossStock: sizing.stopLossStock,
            leverage: sizing.activeLeverage,
            positionSizeEuro: sizing.positionSizeEuro,
            quantityPieces: sizing.quantityPieces,
            certEntryPrice: sizing.modelCertEntryPrice,
            certStopPrice: sizing.modelCertStopPrice,
            catalystNote: 'Auto-Trade Demo-Account (Phase-4-Lead M10 Ausbruch)'
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
            ? `${analysis.actionText} — Demo-Account hat automatisch für ${openedDemoTrade.positionSizeEuro.toFixed(0)} € (${sizing.activeLeverage}x Long) gekauft und überwacht den Exit!`
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
   * Überwacht alle offenen Leads/Trades des Demo-Accounts:
   * - Bei Stufe 2 (>= 1.5R) wird der Stop-Loss im Demo-Account automatisch auf Break-Even (+0,1%) nachgezogen (lautlos ohne Spam).
   * - Sobald das Close-Signal (Stagnations-Exit, Stop-Loss oder EOD) erreicht wird, verkauft der Demo-Account automatisch,
   *   bucht Gewinn/Verlust in € auf das Demo-Konto und sendet sofort die Close-Benachrichtigung (Web + Telegram)!
   */
  async evaluateAllActiveTrades() {
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
      const evaluation = evaluateActiveTrade(trade, m10Bars, stockRecord?.marketClock || {});
      if (!evaluation) continue;

      trade.latestEvaluation = evaluation;
      trade.currency = '€';

      // Automatischer Break-Even Stop-Nachzug im Demo-Account ab 1,5R (lautlos im Hintergrund)
      if (evaluation.stage >= 2 && evaluation.recommendedStopStock > trade.stopLossStock) {
        trade.stopLossStock = evaluation.recommendedStopStock;
        trade.breakEvenActive = true;
      }

      // Prüfe, ob der Lead geschlossen werden soll (Take-Profit / Stagnation, Stop-Loss oder EOD)
      const isStopHit = evaluation.alertType === 'STOP_LOSS_HIT';
      const isStagnationExit = evaluation.alertType === 'STAGNATION_EXIT';
      const isEodClose = Boolean(stockRecord?.marketClock?.isNearClose && evaluation.stockGainPct !== 0);

      if (isStopHit || isStagnationExit || isEodClose) {
        const exitReason = isStopHit
          ? 'Stop-Loss unter Tagestief ausgelöst (Kap. 05)'
          : isStagnationExit
            ? 'Stagnations-Exit / Take-Profit am Widerstand (Kap. 06)'
            : 'EOD Time-Stop vor Börsenschluss (Kap. 6.2)';

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
          title: isStopHit
            ? `🛑 LEAD GECLOSED (STOP-LOSS): ${trade.name} im Demo-Account verkauft (${closedJournal.pnlEuro >= 0 ? '+' : ''}${closedJournal.pnlEuro.toFixed(0)} €)`
            : `🏁 LEAD GECLOSED (TAKE-PROFIT): ${trade.name} im Demo-Account verkauft (${closedJournal.pnlEuro >= 0 ? '+' : ''}${closedJournal.pnlEuro.toFixed(0)} €)`,
          message: `${evaluation.recommendation} — Demo-Account Kontostand: ${this.getDemoMetrics().totalEquityEuro.toFixed(2)} €`
        });
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
      const curPrice = Number(t.latestEvaluation?.currentPrice || rec?.price || t.entryPrice);
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
    const entryPrice = Number(payload.entryPrice || record?.price || 100);
    const lodPrice = Number(payload.lodPrice || record?.analysis?.lodPrice || entryPrice * 0.985);
    const stopLossStock = Number(payload.stopLossStock || record?.sizing?.stopLossStock || lodPrice * 0.998);
    const leverage = Number(payload.leverage || record?.sizing?.activeLeverage || 8);

    const demo = this.state.demoAccount;
    const desiredSize = Number(payload.positionSizeEuro || record?.sizing?.positionSizeEuro || 2500);
    const availableCash = Math.max(0, Number(demo.cashEuro ?? 10000));

    // Wenn kein Cash mehr frei ist (unter 250 €), kann kein neuer Auto-Trade eröffnet werden
    if (availableCash < 250 && payload.isDemoAuto) {
      return null;
    }

    const positionSizeEuro = availableCash >= 250
      ? Math.round(Math.min(desiredSize, availableCash) * 100) / 100
      : Math.round(desiredSize * 100) / 100;

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
      entryPrice: Math.round(entryPrice * 100) / 100,
      lodPrice: Math.round(lodPrice * 100) / 100,
      stopLossStock: Math.round(stopLossStock * 100) / 100,
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
    const riskPerShare = Math.max(0.01, trade.entryPrice - trade.stopLossStock);
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

  getM10ChartData(symbol) {
    return this.m10Store.get(symbol) || [];
  }

  getSnapshot() {
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
      indexRegimes: this.indexRegimes,
      stocks,
      activeTrades: this.state.activeTrades,
      journal: this.state.journal,
      alerts: this.notifier.alertHistory
    };
  }
}
