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

export class StrategyScanner {
  constructor(marketData, notifier) {
    this.marketData = marketData;
    this.notifier = notifier;
    this.state = this.loadState();

    this.isScanning = false;
    this.lastScanAt = null;
    this.nextScanAt = null;
    this.scanTimer = null;

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
        return {
          settings: mergedSettings,
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
    this.runFullScan({ reason: 'initial' }).catch((err) => {
      console.error('Initialer Scan-Fehler:', err.message);
    });
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
        accountCapital: this.state.settings.accountCapital,
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

      // WICHTIG: Benachrichtigung NUR, wenn sich ein echter Kauf-Lead (Phase 4 Entry) ergibt!
      const lastSession = m10Bars.length > 0 ? m10Bars[m10Bars.length - 1].sessionDate : 'today';
      if (
        analysis.phase === 4 &&
        this.notifier.shouldTriggerPhaseAlert(stockMeta.symbol, 4, lastSession)
      ) {
        // Automatisch als aktiven Lead in die Überwachung aufnehmen, damit wir benachrichtigen können, sobald geclosed werden soll!
        const alreadyOpen = this.state.activeTrades.some(
          (t) => t.symbol === stockMeta.symbol && t.status === 'OPEN'
        );
        if (!alreadyOpen) {
          this.openActiveTrade({
            symbol: stockMeta.symbol,
            name: stockMeta.name,
            currency: '€',
            entryPrice: fullRecord.price,
            lodPrice: analysis.lodPrice,
            stopLossStock: sizing.stopLossStock,
            leverage: sizing.activeLeverage,
            positionSizeEuro: sizing.positionSizeEuro,
            catalystNote: 'Automatischer Phase-4-Lead (M10 Ausbruch)'
          });
        }

        await this.notifier.dispatchSimultaneousAlert({
          kind: 'STRATEGY_SIGNAL',
          symbol: stockMeta.symbol,
          name: stockMeta.name,
          index: idxInfo.name,
          currency: '€',
          phase: 4,
          phaseBadge: '🟢 NEUER LEAD (ENTRY)',
          title: `NEUER LEAD (KAUFSIGNAL): ${stockMeta.name} (${fullRecord.price.toFixed(2)} €)`,
          message: `${analysis.actionText} – Lead wird jetzt automatisch auf Stagnations-Exit / Stop-Loss überwacht!`,
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
          sizing
        });
      }

      return fullRecord;
    } catch (err) {
      console.error(`Fehler bei Analyse von ${stockMeta.symbol}:`, err.message);
      return null;
    }
  }

  /**
   * Überwacht alle offenen Leads/Trades und benachrichtigt NUR, wenn die Position wieder geclosed werden soll
   * (Stagnations-Exit / Take-Profit, Börsenschluss EOD oder Stop-Loss) – KEIN Spam bei Zwischenstufen!
   */
  async evaluateAllActiveTrades() {
    for (const trade of this.state.activeTrades) {
      if (trade.status !== 'OPEN') continue;
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

      // Benachrichtigung NUR, wenn der Lead geschlossen werden soll (Take-Profit / Stagnation oder Stop-Loss)!
      const shouldCloseLead =
        evaluation.alertType === 'STAGNATION_EXIT' ||
        evaluation.alertType === 'STOP_LOSS_HIT' ||
        (stockRecord?.marketClock?.isNearClose && evaluation.stockGainPct !== 0);

      if (shouldCloseLead && trade.lastExitAlertType !== evaluation.alertType) {
        trade.lastExitAlertType = evaluation.alertType || 'EOD_EXIT';
        this.saveState();
        await this.notifier.dispatchSimultaneousAlert({
          kind: 'TRADE_EXIT',
          stage: evaluation.stage,
          symbol: trade.symbol,
          name: trade.name || trade.symbol,
          currency: '€',
          leverage: trade.leverage,
          currentPrice: evaluation.currentPrice,
          stockGainPct: evaluation.stockGainPct,
          derivGainPct: evaluation.derivGainPct,
          rMultiple: evaluation.rMultiple,
          pnlEuro: evaluation.pnlEuro,
          recommendedStopStock: evaluation.recommendedStopStock,
          title:
            evaluation.alertType === 'STOP_LOSS_HIT'
              ? `🛑 LEAD CLOSEN (STOP-LOSS): ${trade.name} unter Tagestief gefallen!`
              : `🏁 LEAD CLOSEN (TAKE-PROFIT / EXIT): ${trade.name} jetzt glattstellen!`,
          message: evaluation.recommendation
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
      accountCapital: this.state.settings.accountCapital || 10000,
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
      const simTrade = {
        id: 'sim_case_study_trade',
        symbol: 'SY1.DE',
        name: stockMeta.name,
        currency: '€',
        entryPrice: 96.50,
        lodPrice: 95.40,
        stopLossStock: 95.20,
        leverage: 8,
        positionSizeEuro: sizing.positionSizeEuro,
        entryTime: entryM10Bars[entryM10Bars.length - 1].time,
        status: 'OPEN'
      };
      const evalTrade = evaluateActiveTrade(simTrade, m10Bars, marketClock);
      alertResult = await this.notifier.dispatchSimultaneousAlert(
        {
          kind: 'TRADE_EXIT',
          stage: 3,
          symbol: 'SY1.DE',
          name: stockMeta.name,
          currency: '€',
          leverage: 8,
          currentPrice: evalTrade.currentPrice,
          stockGainPct: evalTrade.stockGainPct,
          derivGainPct: evalTrade.derivGainPct,
          rMultiple: evalTrade.rMultiple,
          pnlEuro: evalTrade.pnlEuro,
          recommendedStopStock: evalTrade.recommendedStopStock,
          title: `🏁 LEAD CLOSEN (TAKE-PROFIT): Symrise AG bei 100,30 € (+31,5% im Derivat / +1.458 €)`,
          message: evalTrade.recommendation
        },
        { forceTelegram: true }
      );
    } else if (stage === 'phase4_entry') {
      // Nur bei echtem Lead (Phase 4 Entry) benachrichtigen, NICHT bei Phase 2 oder Phase 3!
      alertResult = await this.notifier.dispatchSimultaneousAlert(
        {
          kind: 'STRATEGY_SIGNAL',
          symbol,
          name: stockMeta.name,
          index: 'DAX 40',
          currency: '€',
          phase: 4,
          phaseBadge: '🟢 NEUER LEAD (ENTRY)',
          title: `NEUER LEAD (KAUFSIGNAL): Symrise AG bricht bei 96,50 € über M10-EMA20 aus!`,
          message: analysis.actionText,
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
          sizing
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

  openActiveTrade(payload) {
    const symbol = String(payload.symbol || '').toUpperCase();
    const record = this.stockResults.get(symbol);
    const entryPrice = Number(payload.entryPrice || record?.price || 100);
    const lodPrice = Number(payload.lodPrice || record?.analysis?.lodPrice || entryPrice * 0.985);
    const stopLossStock = Number(payload.stopLossStock || record?.sizing?.stopLossStock || lodPrice * 0.998);
    const leverage = Number(payload.leverage || record?.sizing?.activeLeverage || 8);
    const positionSizeEuro = Number(payload.positionSizeEuro || record?.sizing?.positionSizeEuro || 2500);

    const trade = {
      id: `trade_${Date.now()}`,
      symbol,
      name: payload.name || record?.name || symbol,
      currency: payload.currency || record?.currency || 'EUR',
      entryPrice,
      lodPrice,
      stopLossStock,
      leverage,
      positionSizeEuro,
      catalystNote: payload.catalystNote || 'Temporäre Überreaktion / Playbook A-Setup',
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

    this.state.activeTrades.unshift(trade);
    this.saveState();
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
    const derivGainPct = stockGainPct * trade.leverage;
    const pnlEuro = trade.positionSizeEuro * (derivGainPct / 100);
    const riskPerShare = Math.max(0.01, trade.entryPrice - trade.stopLossStock);
    const rMultiple = (exitPrice - trade.entryPrice) / riskPerShare;
    const stopDistancePct = (riskPerShare / trade.entryPrice) * 100;

    const journalEntry = {
      id: `journal_${Date.now()}`,
      symbol: trade.symbol,
      name: trade.name,
      currency: trade.currency,
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
      stockGainPct: Math.round(stockGainPct * 100) / 100,
      derivGainPct: Math.round(derivGainPct * 10) / 10,
      pnlEuro: Math.round(pnlEuro * 100) / 100,
      rMultiple: Math.round(rMultiple * 100) / 100,
      exitReason
    };

    this.state.activeTrades.splice(idx, 1);
    this.state.journal.unshift(journalEntry);
    this.saveState();
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
      indexRegimes: this.indexRegimes,
      stocks,
      activeTrades: this.state.activeTrades,
      journal: this.state.journal,
      alerts: this.notifier.alertHistory
    };
  }
}
