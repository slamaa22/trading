/**
 * Yahoo Finance Live-Marktdaten-Provider (Bulletproof Edition)
 * - Ruft in 2 schnellen Batch-Requests alle Quotes & Fundamentaldaten (KGV, EPS, Earnings, 52W-Hoch, SMA200) für alle 51 Aktien & 7 Indizes ab
 * - Rotiert zwischen query1 und query2 mit sanftem Rate-Limiting für 5-Minuten-Intraday-Kerzen (Resampling auf M10)
 */

const USER_AGENT = 'Mozilla/5.0';

export class MarketDataService {
  constructor() {
    this.cookieStr = null;
    this.crumb = null;
    this.crumbExpiresAt = 0;
    this.quoteCache = new Map();
    this.intradayCache = new Map(); // symbol -> { fetchedAt, bars, meta }
    this.dailyCache = new Map();    // symbol -> { fetchedAt, bars }
    this.hostToggle = 0;
  }

  getNextHost() {
    this.hostToggle = (this.hostToggle + 1) % 2;
    return this.hostToggle === 0
      ? 'https://query1.finance.yahoo.com'
      : 'https://query2.finance.yahoo.com';
  }

  async ensureCrumb() {
    if (this.crumb && this.cookieStr && Date.now() < this.crumbExpiresAt) {
      return { cookieStr: this.cookieStr, crumb: this.crumb };
    }
    try {
      const fc = await fetch('https://fc.yahoo.com', {
        headers: { 'User-Agent': USER_AGENT }
      });
      const rawCookies = fc.headers.getSetCookie
        ? fc.headers.getSetCookie()
        : [fc.headers.get('set-cookie')].filter(Boolean);
      const cookieStr = rawCookies.map((c) => c.split(';')[0]).join('; ');

      const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': USER_AGENT, Cookie: cookieStr }
      });
      if (crumbRes.ok) {
        const crumb = (await crumbRes.text()).trim();
        if (crumb && !crumb.includes('{') && crumb.length < 40) {
          this.cookieStr = cookieStr;
          this.crumb = crumb;
          this.crumbExpiresAt = Date.now() + 25 * 60 * 1000;
          return { cookieStr, crumb };
        }
      }
    } catch (err) {
      console.error('Crumb Fetch Warnung:', err.message);
    }
    return { cookieStr: null, crumb: null };
  }

  /**
   * Ruft für eine Liste von Symbolen Batch-Quotes (inkl. KGV, Forward P/E, Earnings-Zeitpunkt, SMA200) ab.
   */
  async fetchBatchQuotes(symbols = [], { timeoutMs = 8000 } = {}) {
    const resultMap = new Map();
    if (!symbols.length) return resultMap;

    const { cookieStr, crumb } = await this.ensureCrumb();
    if (cookieStr && crumb) {
      try {
        const chunks = [];
        for (let i = 0; i < symbols.length; i += 30) {
          chunks.push(symbols.slice(i, i + 30));
        }
        for (const chunk of chunks) {
          const host = this.getNextHost();
          const url = `${host}/v7/finance/quote?symbols=${encodeURIComponent(
            chunk.join(',')
          )}&crumb=${encodeURIComponent(crumb)}`;
          const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Cookie: cookieStr },
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (res.ok) {
            const json = await res.json();
            const list = json?.quoteResponse?.result || [];
            for (const q of list) {
              const normalized = {
                symbol: q.symbol,
                shortName: (q.shortName || q.longName || q.symbol).replace(/\s+/g, ' ').trim(),
                regularMarketPrice: q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice ?? 0,
                regularMarketPreviousClose: q.regularMarketPreviousClose ?? q.chartPreviousClose ?? 0,
                regularMarketOpen: q.regularMarketOpen ?? q.regularMarketPrice ?? 0,
                regularMarketDayHigh: q.regularMarketDayHigh ?? q.regularMarketPrice ?? 0,
                regularMarketDayLow: q.regularMarketDayLow ?? q.regularMarketPrice ?? 0,
                regularMarketChangePercent: q.regularMarketChangePercent ?? 0,
                regularMarketVolume: q.regularMarketVolume ?? 0,
                trailingPE: q.trailingPE ?? null,
                forwardPE: q.forwardPE ?? null,
                epsTrailingTwelveMonths: q.epsTrailingTwelveMonths ?? null,
                earningsTimestamp: q.earningsTimestamp ?? null,
                earningsTimestampStart: q.earningsTimestampStart ?? null,
                fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
                fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
                sma200: q.twoHundredDayAverage ?? null,
                sma50: q.fiftyDayAverage ?? null,
                marketState: q.marketState || 'REGULAR',
                currency: q.currency || 'EUR'
              };
              resultMap.set(q.symbol, normalized);
              this.quoteCache.set(q.symbol, normalized);
            }
          }
        }
      } catch (err) {
        console.error('BatchQuote Warnung:', err.message);
      }
    }

    // Fallback auf gecachte Quotes falls einzelne fehlen
    for (const sym of symbols) {
      if (!resultMap.has(sym) && this.quoteCache.has(sym)) {
        resultMap.set(sym, this.quoteCache.get(sym));
      }
    }

    return resultMap;
  }

  /**
   * Ruft 5-Minuten-Intraday-Kerzen (letzte 5 Handelstage) ab, um daraus echte 10-Minuten-Kerzen (M10) zu bilden.
   */
  async fetchIntraday5m(symbol, { forceRefresh = false } = {}) {
    const cached = this.intradayCache.get(symbol);
    // Cache für 90 Sekunden wiederverwenden, außer explizit forceRefresh
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 90 * 1000) {
      return cached;
    }

    const host = this.getNextHost();
    const url = `${host}/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=5m&range=5d&includePrePost=false`;

    const headers = { 'User-Agent': USER_AGENT };
    if (this.cookieStr) headers.Cookie = this.cookieStr;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (cached) return cached;
      throw new Error(`Yahoo Chart API HTTP ${res.status} für ${symbol}`);
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      if (cached) return cached;
      throw new Error(`Keine Intraday-Daten für ${symbol}`);
    }

    const ts = result.timestamp;
    const q = result.indicators?.quote?.[0] || {};
    const bars = [];

    for (let i = 0; i < ts.length; i++) {
      const open = q.open?.[i];
      const high = q.high?.[i];
      const low = q.low?.[i];
      const close = q.close?.[i];
      const volume = q.volume?.[i] ?? 0;
      if (
        open == null ||
        high == null ||
        low == null ||
        close == null ||
        !Number.isFinite(close)
      ) {
        continue;
      }
      bars.push({
        time: ts[i],
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume)
      });
    }

    const entry = {
      fetchedAt: Date.now(),
      bars,
      meta: result.meta || {}
    };
    this.intradayCache.set(symbol, entry);
    return entry;
  }

  /**
   * Ruft Tageskerzen (letzte 6 Monate) für Daily-Unterstützungszonen & 20-Tage-Swing-Hoch ab.
   */
  async fetchDailyBars(symbol) {
    const cached = this.dailyCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) {
      return cached.bars;
    }

    try {
      const host = this.getNextHost();
      const url = `${host}/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?interval=1d&range=6mo`;
      const headers = { 'User-Agent': USER_AGENT };
      if (this.cookieStr) headers.Cookie = this.cookieStr;

      const res = await fetch(url, { headers });
      if (!res.ok) return cached?.bars || [];
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result || !Array.isArray(result.timestamp)) return cached?.bars || [];

      const ts = result.timestamp;
      const q = result.indicators?.quote?.[0] || {};
      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close?.[i] == null || q.low?.[i] == null || q.high?.[i] == null) continue;
        bars.push({
          time: ts[i],
          open: Number(q.open?.[i] ?? q.close[i]),
          high: Number(q.high[i]),
          low: Number(q.low[i]),
          close: Number(q.close[i]),
          volume: Number(q.volume?.[i] ?? 0)
        });
      }
      this.dailyCache.set(symbol, { fetchedAt: Date.now(), bars });
      return bars;
    } catch {
      return cached?.bars || [];
    }
  }
}
