/**
 * Kern-Engine für das Systematische Trading-Playbook:
 * "Antizyklische Mean-Reversion-Strategie (Long-Only)"
 *
 * Implementiert:
 * - Resampling von 5m-Daten auf echte 10-Minuten-Kerzen (M10)
 * - Berechnung von M10 EMA 20, Intraday-VWAP, RSI(14), ATR(14) & Daily Support-Zonen
 * - Fundamental- & Katalysator-Vorfilter (KGV, Dip-Größe -4% bis -15%, Earnings-Sperre, Index-Regime)
 * - 4-Phasen-Bodenbildungs-Erkennung im M10-Chart (Phase 1 bis Phase 4)
 * - 4 Objektive Konfluenz-Signale (RSI-Divergenz, Volumen-Divergenz, EMA20/VWAP-Reclaim, Liquidity Sweep)
 * - Disqualifikations-Filter (Schleichendes Abbröckeln, FOMO-Chasing > +3.5% vom LoD)
 * - 5%-Kapitalrisiko & Knock-Out-Derivate-Rechner (Hebel 5x–10x, Noise-Buffer, Psychologische Marken)
 * - 3-Stufen Trade-Management & Dynamischer Stagnations-Exit (Kapitel 06)
 */

/**
 * Aggregiert 5-Minuten-Kerzen (oder 1m/2m/5m) in exakte 10-Minuten-Kerzen (M10).
 * @param {Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>} rawBars
 * @returns {Array<{time: number, open: number, high: number, low: number, close: number, volume: number, sessionDate: string}>}
 */
export function resampleToM10(rawBars, timezone = 'Europe/Berlin') {
  if (!Array.isArray(rawBars) || rawBars.length === 0) return [];

  const buckets = new Map();
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  for (const bar of rawBars) {
    if (
      bar == null ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      continue;
    }
    // 10-Minuten-Bucket (600 Sekunden)
    const bucketTime = Math.floor(bar.time / 600) * 600;
    const sessionDate = dateFmt.format(new Date(bucketTime * 1000));

    let existing = buckets.get(bucketTime);
    if (!existing) {
      existing = {
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Number.isFinite(bar.volume) ? bar.volume : 0,
        sessionDate
      };
      buckets.set(bucketTime, existing);
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += Number.isFinite(bar.volume) ? bar.volume : 0;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

/**
 * Berechnet EMA 20, Intraday-VWAP, RSI(14) und ATR(14) auf den M10-Kerzen.
 */
export function enrichM10Indicators(m10Bars) {
  if (!m10Bars || m10Bars.length === 0) return [];

  const bars = m10Bars.map((b) => ({ ...b }));
  const emaPeriod = 20;
  const emaMultiplier = 2 / (emaPeriod + 1);
  const rsiPeriod = 14;

  let ema20 = null;
  let currentSession = null;
  let cumPV = 0;
  let cumVol = 0;

  let avgGain = 0;
  let avgLoss = 0;
  let prevClose = null;
  let trSum = 0;
  let atr14 = null;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];

    // 1. EMA 20
    if (ema20 === null) {
      ema20 = b.close;
    } else {
      ema20 = (b.close - ema20) * emaMultiplier + ema20;
    }
    b.ema20 = round4(ema20);

    // 2. Intraday VWAP (Reset bei neuem Handelstag)
    if (b.sessionDate !== currentSession) {
      currentSession = b.sessionDate;
      cumPV = 0;
      cumVol = 0;
    }
    const typicalPrice = (b.high + b.low + b.close) / 3;
    const vol = b.volume > 0 ? b.volume : 1;
    cumPV += typicalPrice * vol;
    cumVol += vol;
    b.vwap = round4(cumPV / cumVol);

    // 3. True Range & ATR(14)
    const tr =
      prevClose === null
        ? b.high - b.low
        : Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
    if (i < 14) {
      trSum += tr;
      atr14 = trSum / (i + 1);
    } else {
      atr14 = (atr14 * 13 + tr) / 14;
    }
    b.atr14 = round4(atr14);

    // 4. RSI (14) nach Wilder
    if (i === 0) {
      b.rsi14 = 50;
    } else {
      const change = b.close - prevClose;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      if (i <= rsiPeriod) {
        avgGain += gain / rsiPeriod;
        avgLoss += loss / rsiPeriod;
        if (i < rsiPeriod) {
          const tempGain = avgGain * (rsiPeriod / i);
          const tempLoss = avgLoss * (rsiPeriod / i);
          b.rsi14 = tempLoss === 0 ? 100 : round2(100 - 100 / (1 + tempGain / tempLoss));
        } else {
          b.rsi14 = avgLoss === 0 ? 100 : round2(100 - 100 / (1 + avgGain / avgLoss));
        }
      } else {
        avgGain = (avgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
        avgLoss = (avgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
        b.rsi14 = avgLoss === 0 ? 100 : round2(100 - 100 / (1 + avgGain / avgLoss));
      }
    }

    prevClose = b.close;
  }

  return bars;
}

/**
 * Ermittelt übergeordnete Unterstützungszonen aus dem Tageschart (Daily) & Metadaten (Kapitel 3.1).
 */
export function findDailySupportZones(dailyBars = [], quoteMeta = {}, currentPrice = 0) {
  const supports = [];

  if (quoteMeta.sma200 && Number.isFinite(quoteMeta.sma200)) {
    supports.push({
      price: round2(quoteMeta.sma200),
      type: 'SMA 200 (Tageschart)',
      strength: 'Hoch'
    });
  }

  if (dailyBars.length >= 5) {
    // Vorherige markante Swing-Tiefs im Tageschart
    for (let i = 2; i < dailyBars.length - 2; i++) {
      const cur = dailyBars[i];
      const prev1 = dailyBars[i - 1];
      const prev2 = dailyBars[i - 2];
      const next1 = dailyBars[i + 1];
      const next2 = dailyBars[i + 2];
      if (
        cur.low <= prev1.low &&
        cur.low <= prev2.low &&
        cur.low <= next1.low &&
        cur.low <= next2.low
      ) {
        supports.push({
          price: round2(cur.low),
          type: 'Markantes Daily Swing-Tief',
          strength: 'Hoch'
        });
      }
    }

    // Letztes Wochentief / 20-Tage-Tief
    const recent20 = dailyBars.slice(-22, -1);
    if (recent20.length > 0) {
      const low20 = Math.min(...recent20.map((d) => d.low));
      supports.push({
        price: round2(low20),
        type: '20-Tage-Unterstützung',
        strength: 'Mittel'
      });
    }
  }

  // Prüfe, ob eine Unterstützung nahe am aktuellen Kurs / Tagestief liegt (+/- 2.0%)
  const nearSupports = supports.filter((s) => {
    if (!currentPrice) return true;
    const diffPct = Math.abs(currentPrice - s.price) / currentPrice;
    return diffPct <= 0.035; // innerhalb 3.5%
  });

  // Sortiere nach geringstem Abstand zum aktuellen Preis
  nearSupports.sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price));

  return {
    allSupports: supports.slice(-8),
    nearestSupport: nearSupports[0] || null,
    atMajorSupport: nearSupports.some((s) => Math.abs(currentPrice - s.price) / currentPrice <= 0.018)
  };
}

/**
 * Bewertet die Fundamentaldaten & Schutzfilter gemäß Kapitel 02:
 * - Profitabilität & KGV-Check (Ausschluss bei negativem KGV oder KGV > 50)
 * - Größenordnung des Dips (-4% bis -15% vom Swing-Hoch bzw. signifikanter Intraday-Abverkauf, Ausschluss bei < -30%)
 * - Filter 1: Earnings-Sperre (Keine Position unmittelbar VOR Quartalszahlen)
 * - Filter 2: Synchronisation mit dem Gesamtmarkt (Index-Regime)
 */
export function evaluateFundamentalAndFilters(stockMeta, quote = {}, dailyBars = [], indexRegime = {}, settings = {}) {
  const trailingPE = quote.trailingPE ?? null;
  const forwardPE = quote.forwardPE ?? null;
  const eps = quote.epsTrailingTwelveMonths ?? null;
  const effectivePE = forwardPE && forwardPE > 0 ? forwardPE : trailingPE;

  // 1. KGV & Profitabilitäts-Check
  let peStatus = 'OK';
  let pePassed = true;
  let peReason = 'Attraktive/Moderate Bewertung';

  if ((eps !== null && eps < 0) || (effectivePE !== null && effectivePE < 0)) {
    peStatus = 'DISQUALIFIZIERT';
    pePassed = false;
    peReason = 'Negatives KGV / Operative Verluste (Ausschlusskriterium Kap. 2.2)';
  } else if (effectivePE !== null && effectivePE > 50 && (forwardPE === null || forwardPE > 45)) {
    peStatus = 'WARNUNG';
    pePassed = false;
    peReason = `Überteuerte Bewertung (KGV ${effectivePE.toFixed(1)} > 50)`;
  } else if (effectivePE !== null) {
    peReason = `Solides KGV (${effectivePE.toFixed(1)}x${forwardPE ? ' Fwd' : ''})`;
  } else {
    peReason = 'Qualitätsaktie aus Kern-Index (KGV-Daten ausstehend)';
  }

  // 2. Größenordnung des Dips (Vom letzten 20-Tage Swing-Hoch und Intraday)
  const currentPrice = quote.regularMarketPrice || (dailyBars.length ? dailyBars[dailyBars.length - 1].close : 0);
  const prevClose = quote.chartPreviousClose || quote.regularMarketPreviousClose || currentPrice;
  const intradayChangePct = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;

  let swingHigh20 = quote.fiftyTwoWeekHigh || currentPrice;
  if (dailyBars.length >= 3) {
    const recentSlice = dailyBars.slice(-25);
    swingHigh20 = Math.max(...recentSlice.map((b) => b.high), prevClose);
  }
  const dipFromSwingHighPct = swingHigh20 > 0 ? ((currentPrice - swingHigh20) / swingHigh20) * 100 : intradayChangePct;

  const minDipPct = settings.minDipPct ?? -2.5; // Einstellbar, Standard: ab -2.5% Intraday oder -4.0% vom Swing-Hoch
  const isCrashExcluded = intradayChangePct <= -30.0;
  const isSignificantDip =
    !isCrashExcluded &&
    (dipFromSwingHighPct <= -3.8 || intradayChangePct <= minDipPct);

  let dipStatus = 'NEUTRAL';
  let dipReason = `Vom Swing-Hoch: ${dipFromSwingHighPct.toFixed(2)}% | Heute: ${intradayChangePct >= 0 ? '+' : ''}${intradayChangePct.toFixed(2)}%`;
  if (isCrashExcluded) {
    dipStatus = 'DISQUALIFIZIERT';
    dipReason = `Totaler Kollaps (${intradayChangePct.toFixed(1)}% < -30%) – Existenzkrisen-Ausschluss!`;
  } else if (dipFromSwingHighPct <= -4.0 && dipFromSwingHighPct >= -18.0) {
    dipStatus = 'IDEAL';
    dipReason = `Idealer Playbook-Dip (${dipFromSwingHighPct.toFixed(1)}% vom Swing-Hoch | Heute ${intradayChangePct.toFixed(2)}%)`;
  } else if (intradayChangePct <= minDipPct) {
    dipStatus = 'AKTIV';
    dipReason = `Deutlicher Intraday-Rücksetzer (${intradayChangePct.toFixed(2)}%)`;
  }

  // 3. Schutzfilter 1: Earnings-Sperre (Kapitel 2.3)
  const nowSec = Math.floor(Date.now() / 1000);
  const earningsTs = quote.earningsTimestampStart || quote.earningsTimestamp || null;
  let earningsLocked = false;
  let earningsNote = 'Kein binäres Event in den nächsten 36h';

  if (earningsTs) {
    const hoursToEarnings = (earningsTs - nowSec) / 3600;
    if (hoursToEarnings > 0 && hoursToEarnings <= 36) {
      earningsLocked = true;
      earningsNote = `EARNINGS-SPERRE AKTIV: Quartalszahlen in ca. ${Math.round(hoursToEarnings)} Std.!`;
    } else if (hoursToEarnings < 0 && hoursToEarnings >= -48) {
      earningsNote = 'Zahlen vor kurzem veröffentlicht (Post-Earnings Überreaktions-Setup möglich)';
    }
  }

  // 4. Schutzfilter 2: Gesamtmarkt-Regime (Index-Synchronisation)
  const indexOk = indexRegime?.isFallingHard !== true;
  const indexNote = indexRegime?.summary || 'Leitindex stabil / synchronisiert';

  return {
    pePassed,
    peStatus,
    peValue: effectivePE ? round1(effectivePE) : null,
    trailingPE: trailingPE ? round1(trailingPE) : null,
    forwardPE: forwardPE ? round1(forwardPE) : null,
    peReason,
    intradayChangePct: round2(intradayChangePct),
    dipFromSwingHighPct: round2(dipFromSwingHighPct),
    swingHigh20: round2(swingHigh20),
    isSignificantDip,
    isCrashExcluded,
    dipStatus,
    dipReason,
    earningsLocked,
    earningsNote,
    indexOk,
    indexNote,
    fundamentalPassed: pePassed && !isCrashExcluded && !earningsLocked
  };
}

/**
 * Kern-Algorithmus für Kapitel 03:
 * Analysiert die 10-Minuten-Kerzen (M10) des aktuellen Handelstages auf die 4 Phasen der Bodenbildung
 * sowie die 4 objektiven Konfluenz-Signale und etwaige Disqualifikationen.
 */
export function analyzeM10BottomFormation(m10Bars, dailySupportInfo = {}, fundamentals = {}) {
  if (!m10Bars || m10Bars.length < 4) {
    return {
      phase: 0,
      phaseName: 'Keine Daten / Warten auf M10-Kerzen',
      actionText: 'Warten auf ausreichende Intraday-Historie',
      isActionable: false
    };
  }

  // Bestimme die Kerzen der aktuellen (letzten) Handelssitzung
  const lastSessionDate = m10Bars[m10Bars.length - 1].sessionDate;
  let sessionBars = m10Bars.filter((b) => b.sessionDate === lastSessionDate);

  // Falls die Sitzung gerade erst 1-2 Kerzen hat, nimm die letzten 18 M10-Kerzen (3 Stunden) hinzu
  if (sessionBars.length < 5) {
    sessionBars = m10Bars.slice(-Math.min(m10Bars.length, 24));
  }

  const latestBar = sessionBars[sessionBars.length - 1];
  const prevBar = sessionBars[sessionBars.length - 2] || latestBar;

  // Sitzungs-Hoch vor dem Tief und Tagestief (Low of Day - LoD)
  const sessionOpen = sessionBars[0].open;
  const sessionHigh = Math.max(...sessionBars.map((b) => b.high));

  let lodPrice = Infinity;
  let lodIndex = 0;
  for (let i = 0; i < sessionBars.length; i++) {
    if (sessionBars[i].low < lodPrice) {
      lodPrice = sessionBars[i].low;
      lodIndex = i;
    }
  }

  // Prüfe, ob es vor dem absoluten LoD ein erstes markantes Tief gab (für Liquidity Sweep / Doppelboden)
  let firstLodPrice = lodPrice;
  let firstLodIndex = lodIndex;
  for (let i = 1; i < lodIndex; i++) {
    const b = sessionBars[i];
    const prev = sessionBars[i - 1];
    const next = sessionBars[i + 1];
    if (b.low <= prev.low && b.low <= next.low) {
      // Lag dieses erste Tief sehr nah am späteren absoluten Tagestief (innerhalb 0.6%)?
      const diffPct = Math.abs(b.low - lodPrice) / lodPrice;
      if (diffPct <= 0.0065 && i <= lodIndex - 1) {
        firstLodPrice = b.low;
        firstLodIndex = i;
        break;
      }
    }
  }

  const barsSinceFirstLow = sessionBars.length - 1 - firstLodIndex;
  const barsSinceAbsoluteLow = sessionBars.length - 1 - lodIndex;

  // Rückgang vom Tageshoch bzw. Vortagesschluss bis zum Tagestief
  const dropToLodPct = sessionHigh > 0 ? ((lodPrice - sessionHigh) / sessionHigh) * 100 : 0;
  const effectiveDropPct = Math.min(dropToLodPct, fundamentals.intradayChangePct || 0, fundamentals.dipFromSwingHighPct || 0);

  // Abstand aktueller Kurs zum Tagestief (LoD)
  const distanceFromLodPct = lodPrice > 0 ? ((latestBar.close - lodPrice) / lodPrice) * 100 : 0;

  // Durchschnittsvolumen der Sitzung
  const avgSessionVol =
    sessionBars.reduce((acc, b) => acc + (b.volume || 0), 0) / Math.max(1, sessionBars.length);

  // --- PRÜFUNG DER 4 OBJEKTIVEN KONFLUENZ-SIGNALE (Kapitel 3.3) ---

  // 1. Bullische RSI-Divergenz im M10-Chart
  // Entweder RSI beim zweiten Test höher als beim ersten Tief + RSI steigt über 30/35,
  // oder nach überverkauftem RSI (< 35 am Tief) klarer Anstieg über 35.
  const rsiAtFirstLow = sessionBars[firstLodIndex]?.rsi14 ?? 50;
  const rsiAtAbsLow = sessionBars[lodIndex]?.rsi14 ?? 50;
  const minRsiInDrop = Math.min(
    ...sessionBars.slice(0, Math.max(1, lodIndex + 1)).map((b) => b.rsi14 ?? 50)
  );
  const hasSecondaryTestRsiDiv =
    firstLodIndex !== lodIndex &&
    sessionBars[lodIndex].low <= sessionBars[firstLodIndex].low * 1.003 &&
    rsiAtAbsLow > rsiAtFirstLow + 1.5 &&
    latestBar.rsi14 >= 32;

  const hasRetestHigherRsi = (() => {
    if (barsSinceFirstLow < 2) return false;
    const retestBars = sessionBars.slice(firstLodIndex + 1);
    const retestLowBar = retestBars.reduce((minB, b) => (b.low < minB.low ? b : minB), retestBars[0]);
    const nearLod = (retestLowBar.low - lodPrice) / lodPrice <= 0.006;
    return nearLod && retestLowBar.rsi14 > minRsiInDrop + 2.0 && latestBar.rsi14 >= 32;
  })();

  const rsiDivergence =
    hasSecondaryTestRsiDiv ||
    hasRetestHigherRsi ||
    (minRsiInDrop <= 33 && latestBar.rsi14 >= minRsiInDrop + 6 && latestBar.rsi14 >= 34);

  // 2. Volumen-Divergenz (Climax vs. Retest)
  const climaxSlice = sessionBars.slice(Math.max(0, firstLodIndex - 1), Math.min(sessionBars.length, firstLodIndex + 2));
  const climaxPeakVol = Math.max(...climaxSlice.map((b) => b.volume || 0), 1);
  const retestSlice = sessionBars.slice(firstLodIndex + 1, Math.max(firstLodIndex + 2, sessionBars.length - 1));
  const retestAvgVol =
    retestSlice.length > 0
      ? retestSlice.reduce((s, b) => s + (b.volume || 0), 0) / retestSlice.length
      : climaxPeakVol;
  const volumeDivergence =
    climaxPeakVol > avgSessionVol * 1.15 && retestSlice.length >= 1 && retestAvgVol <= climaxPeakVol * 0.82;

  // 3. Rückeroberung des Intraday-VWAP oder EMA 20 (M10)
  const reclaimedEma20 = latestBar.close > latestBar.ema20;
  const reclaimedVwap = latestBar.close > latestBar.vwap;
  const emaVwapReclaim = reclaimedEma20 || reclaimedVwap;

  // 4. Erfolgreicher Liquidity Sweep (Bärenfalle am Tagestief) oder markanter Hammer-Docht am LoD
  const lodBar = sessionBars[lodIndex];
  const lodBarRange = Math.max(0.0001, lodBar.high - lodBar.low);
  const lodLowerWick = Math.min(lodBar.open, lodBar.close) - lodBar.low;
  const hasHammerAtLod = lodLowerWick / lodBarRange >= 0.38 && lodBar.close > lodBar.low + lodBarRange * 0.45;
  const hasUndercutSweep =
    firstLodIndex < lodIndex &&
    lodBar.low < firstLodPrice &&
    lodBar.close > firstLodPrice;
  const liquiditySweep = hasUndercutSweep || hasHammerAtLod;

  const confluenceSignals = [
    {
      id: 'rsi_divergence',
      name: 'Bullische RSI-Divergenz (M10)',
      active: rsiDivergence,
      detail: `RSI am Tief: ${minRsiInDrop.toFixed(1)} → Aktuell: ${latestBar.rsi14.toFixed(1)}`
    },
    {
      id: 'volume_divergence',
      name: 'Volumen-Divergenz (Climax vs. Retest)',
      active: volumeDivergence,
      detail: volumeDivergence
        ? `Climax-Volumen absorbiert, Retest-Volumen -${Math.round((1 - retestAvgVol / climaxPeakVol) * 100)}% geringer`
        : 'Volumen-Kompression noch in Ausbildung'
    },
    {
      id: 'ema_vwap_reclaim',
      name: 'Rückeroberung M10 EMA 20 / VWAP',
      active: emaVwapReclaim,
      detail: `Kurs ${latestBar.close.toFixed(2)} | EMA20: ${latestBar.ema20.toFixed(2)} | VWAP: ${latestBar.vwap.toFixed(2)}`
    },
    {
      id: 'liquidity_sweep',
      name: 'Liquidity Sweep / Hammer-Absorption am LoD',
      active: liquiditySweep,
      detail: hasUndercutSweep
        ? `Bärenfalle unter ${firstLodPrice.toFixed(2)} mit dynamischem Reclaim`
        : hasHammerAtLod
          ? `Starker Absorptions-Docht (${Math.round((lodLowerWick / lodBarRange) * 100)}% Lunte) bei ${lodPrice.toFixed(2)}`
          : 'Kein ausgeprägter Sweep-Docht'
    }
  ];

  const confluenceCount = confluenceSignals.filter((c) => c.active).length;

  // --- DISQUALIFIKATIONS-PRÜFUNG (Kapitel 3.3) ---
  // 1. Zu später Einstieg (Verpassen des Bodens / FOMO-Verbot ab +3.5% über LoD)
  const isFomoDisqualified = distanceFromLodPct > 3.5;

  // 2. Schleichendes Abbröckeln ohne Gegenwehr:
  // Mehrere Kerzen nach dem Tief, aber immer tiefere Zwischenhochs und Schlusskurs klebt direkt am Tief (< 0.15% über LoD) bei roten Kerzen
  const last3 = sessionBars.slice(-3);
  const isSlowBleed =
    barsSinceFirstLow >= 4 &&
    last3.length === 3 &&
    last3[2].high <= last3[1].high &&
    last3[1].high <= last3[0].high &&
    latestBar.close <= latestBar.open &&
    distanceFromLodPct < 0.18;

  // --- BESTIMMUNG DER 4 PHASEN IM 10-MINUTEN-CHART (Kapitel 3.2) ---
  let phase = 0;
  let phaseName = 'Neutral / Kein aktiver Abverkauf';
  let phaseBadge = 'NEUTRAL';
  let actionText = 'Kein Setup aktiv – Aktie beobachten.';
  let isActionable = false;
  let alertLevel = 'none'; // 'none' | 'phase2_watchlist' | 'phase3_prepare' | 'phase4_entry'

  const hasMeaningfulDrop = effectiveDropPct <= -1.8 || fundamentals.isSignificantDip;

  if (!hasMeaningfulDrop) {
    phase = 0;
    phaseName = 'Kein signifikanter Dip (Kein Überverkauf)';
    phaseBadge = 'KEIN DIP';
    actionText = 'Aktie zeigt aktuell keinen ausreichenden Abverkauf (-4% bis -15% vom Swing-Hoch bzw. starker Intraday-Dip erforderlich).';
  } else if (fundamentals.isCrashExcluded || fundamentals.earningsLocked || !fundamentals.pePassed) {
    phase = -1;
    phaseName = 'Durch Vorfilter gesperrt (Kein Trade!)';
    phaseBadge = 'GESPERRT';
    actionText = fundamentals.earningsLocked
      ? fundamentals.earningsNote
      : !fundamentals.pePassed
        ? fundamentals.peReason
        : fundamentals.dipReason;
  } else if (isFomoDisqualified) {
    phase = -2;
    phaseName = 'Disqualifiziert: Zu später Einstieg (FOMO-Verbot > +3,5% vom LoD)';
    phaseBadge = 'ZU SPÄT (FOMO)';
    actionText = `Kurs ist bereits +${distanceFromLodPct.toFixed(2)}% vom Tagestief (${lodPrice.toFixed(2)}) weggelaufen. Laut Playbook Kap. 3.3 & 07 nicht mehr hinterherkaufen!`;
  } else if (isSlowBleed) {
    phase = -3;
    phaseName = 'Disqualifiziert: Schleichendes Abbröckeln ohne Gegenwehr';
    phaseBadge = 'ABBRÖCKELN';
    actionText = 'Tiefe Zwischenhochs drücken auf das Tagestief ohne Käufer-Gegenwehr (Durchbruchsdruck nach unten). Kein Kauf!';
  } else {
    // Prüfe Phase 1 bis 4
    const latestRange = Math.max(0.0001, latestBar.high - latestBar.low);
    const isDynamicGreenCandle =
      latestBar.close > latestBar.open &&
      (latestBar.close - latestBar.open) / latestRange >= 0.42 &&
      (latestBar.high - latestBar.close) / latestRange <= 0.35;

    // Vorangegangene Korrektur-/Box-Kerzen vor der aktuellen Kerze
    const baseWindow = sessionBars.slice(Math.max(firstLodIndex, sessionBars.length - 6), sessionBars.length - 1);
    const baseHigh = baseWindow.length > 0 ? Math.max(...baseWindow.map((b) => Math.max(b.open, b.close))) : latestBar.high;
    const breaksBaseStructure =
      baseWindow.length >= 2 &&
      latestBar.close > baseHigh &&
      latestBar.close > prevBar.high;

    if (barsSinceAbsoluteLow === 0 && latestBar.close <= latestBar.open && !hasHammerAtLod && !hasUndercutSweep) {
      // PHASE 1: Kapitulation (Selling Climax) - Aktie macht gerade noch neue Tiefs mit roter Kerze
      phase = 1;
      phaseName = 'Phase 1: Kapitulation (Selling Climax)';
      phaseBadge = 'PHASE 1 · KAUFVERBOT';
      actionText = 'STRIKTES KAUFVERBOT! Fallendes Messer – warten bis der Verkaufsdruck stoppt und ein Tagestief (LoD) markiert wird.';
      alertLevel = 'none';
    } else if (barsSinceFirstLow < 3) {
      // PHASE 2: Absorption & Erstes Tagestief (LoD)
      phase = 2;
      phaseName = 'Phase 2: Absorption & Erstes Tagestief (LoD)';
      phaseBadge = 'PHASE 2 · WATCHLIST-ALARM';
      actionText = `WATCHLIST-ALARM: Vorläufiges Tagestief (LoD) bei ${lodPrice.toFixed(2)} markiert. Jetzt 3–6 M10-Kerzen (30–60 Min.) Kompression / Sekundären Test abwarten!`;
      alertLevel = 'phase2_watchlist';
      isActionable = true;
    } else if (
      barsSinceFirstLow >= 3 &&
      isDynamicGreenCandle &&
      (breaksBaseStructure || (reclaimedEma20 && prevBar.close <= prevBar.ema20)) &&
      distanceFromLodPct <= 3.5
    ) {
      // PHASE 4: Impuls-Trigger (Break of Structure)
      phase = 4;
      phaseName = 'Phase 4: Impuls-Trigger (Break of Structure)';
      phaseBadge = 'PHASE 4 · KAUFSIGNAL (ENTRY)';
      actionText = `KAUFAUSFÜHRUNG (ENTRY): Dynamische grüne M10-Kerze bricht aus Bodenbildungs-Range über ${baseHigh.toFixed(2)} aus! Stop-Loss strikt unter Tagestief (${lodPrice.toFixed(2)}) setzen.`;
      alertLevel = 'phase4_entry';
      isActionable = true;
    } else {
      // PHASE 3: Sekundärer Test & Kompression (3+ M10-Kerzen über Tagestief gehalten)
      phase = 3;
      phaseName = 'Phase 3: Sekundärer Test & Kompression';
      phaseBadge = 'PHASE 3 · VORBEREITUNG';
      actionText = `Bodenbildung läuft (${barsSinceFirstLow} M10-Kerzen über LoD ${lodPrice.toFixed(2)} verteidigt). Derivat (Hebel 5x–10x) bereitlegen & auf grüne M10-Ausbruchskerze (Phase 4) warten!`;
      alertLevel = 'phase3_prepare';
      isActionable = true;
    }
  }

  return {
    phase,
    phaseName,
    phaseBadge,
    actionText,
    alertLevel,
    isActionable,
    lodPrice: round2(lodPrice),
    firstLodPrice: round2(firstLodPrice),
    sessionHigh: round2(sessionHigh),
    sessionOpen: round2(sessionOpen),
    currentPrice: round2(latestBar.close),
    barsSinceFirstLow,
    barsSinceAbsoluteLow,
    distanceFromLodPct: round2(distanceFromLodPct),
    effectiveDropPct: round2(effectiveDropPct),
    ema20: round2(latestBar.ema20),
    vwap: round2(latestBar.vwap),
    rsi14: round1(latestBar.rsi14),
    atr14: round4(latestBar.atr14),
    confluenceSignals,
    confluenceCount,
    isHighQualitySetup: phase >= 3 && confluenceCount >= 2,
    dailySupport: dailySupportInfo
  };
}

/**
 * Berechnet gemäß Kapitel 04 & 05:
 * - Strukturellen Stop-Loss in der Aktie (LoD minus 0,15%–0,30% Noise-Buffer + Psychologische Marken)
 * - Optimalen Hebel (5x–10x) anhand Stop-Abstand & Aktien-Volatilitätsprofil
 * - 4-Schritt-Formel für 5% Kontorisiko (R_max, d_Aktie, d_Derivat, P_Kauf)
 * - Komplette Positionsgrößen-Matrix für Hebel 5x bis 10x
 */
export function calculateRiskAndPositionSizing({
  entryPrice,
  lodPrice,
  accountCapital = 10000,
  maxRiskPct = 5.0,
  noiseBufferPct = 0.20,
  stockProfile = 'conservative',
  customLeverage = null,
  customCertPrice = null,
  certRatio = 0.1
}) {
  if (!entryPrice || !lodPrice || entryPrice <= 0 || lodPrice <= 0) {
    return null;
  }

  const safeLod = Math.min(entryPrice * 0.995, lodPrice);

  // Noise Buffer (0.15% bis 0.30% unter dem Tagestief)
  let rawStopStock = safeLod * (1 - noiseBufferPct / 100);

  // Prüfe auf glatte psychologische Marken (z.B. 50.00, 100.00, 20.00, 25.00, 150.00, 200.00)
  const psychStep = entryPrice >= 80 ? 10 : entryPrice >= 30 ? 5 : 1;
  const nearestRound = Math.round(rawStopStock / psychStep) * psychStep;
  let psychAdjusted = false;
  if (rawStopStock >= nearestRound && (rawStopStock - nearestRound) / entryPrice <= 0.0025) {
    // Legt den Stop knapp unter die glatte psychologische Marke (Kapitel 5.1)
    rawStopStock = nearestRound - entryPrice * 0.0015;
    psychAdjusted = true;
  }

  const stopLossStock = round2(rawStopStock);
  const stopDistanceStockAbs = Math.max(0.01, entryPrice - stopLossStock);
  const stopDistanceStockPct = (stopDistanceStockAbs / entryPrice) * 100; // in %

  // Empfohlener Hebel laut Kapitel 4.2 (5x bis 10x)
  let recommendedLeverage = 8;
  let leverageReason = '';
  if (stopDistanceStockPct <= 1.2 && stockProfile === 'conservative') {
    recommendedLeverage = 10;
    leverageReason = 'Kompakter Boden (Stop-Abstand ≤ 1,2%) bei schwankungsarmem Blue Chip → Hebel 10x optimal (Kap. 4.2)';
  } else if (stopDistanceStockPct <= 1.8 && stockProfile === 'conservative') {
    recommendedLeverage = 8;
    leverageReason = 'Moderater Stop-Abstand (0,8%–1,8%) bei Qualitätsaktie → Hebel 8x optimal (Kap. 4.2)';
  } else if (stopDistanceStockPct <= 2.3) {
    recommendedLeverage = 7;
    leverageReason = 'Erhöhter Stop-Abstand / Volatilität → Hebel 7x zur Risikoglättung (Kap. 4.2)';
  } else if (stopDistanceStockPct <= 2.9) {
    recommendedLeverage = 6;
    leverageReason = 'Tieferer Boden (Stop-Abstand > 2,3%) → Hebel 6x empfohlen (Kap. 4.2)';
  } else {
    recommendedLeverage = 5;
    leverageReason = 'Weiter Stop-Abstand / hohe Intraday-Spanne → Konservativer Hebel 5x am unteren Rand der Spanne (Kap. 4.2)';
  }

  const activeLeverage = customLeverage
    ? Math.min(10, Math.max(5, Number(customLeverage)))
    : recommendedLeverage;

  // 4-SCHRITT-FORMEL (Kapitel 5.2)
  // Schritt 1: R_max = Gesamtes Trading-Kapital * (maxRiskPct / 100)
  const rMaxEuro = round2(accountCapital * (maxRiskPct / 100));

  // Schritt 2: d_Aktie (Dezimal & Prozent)
  const dAktie = stopDistanceStockAbs / entryPrice;

  // Schritt 3: d_Derivat = d_Aktie * Hebel
  const dDerivat = Math.min(0.95, dAktie * activeLeverage);
  const dDerivatPct = round2(dDerivat * 100);

  // Schritt 4: P_Kauf = R_max / d_Derivat
  const rawPositionSizeEuro = rMaxEuro / dDerivat;
  const isCappedByCapital = rawPositionSizeEuro > accountCapital;
  const positionSizeEuro = round2(Math.min(accountCapital, rawPositionSizeEuro));
  const accountAllocationPct = round2((positionSizeEuro / accountCapital) * 100);

  // Modellrechnung für das Knock-Out-Zertifikat (Open-End Turbo Long / Mini-Future Long)
  // Kurs des Derivats ≈ (Aktienkurs - Basispreis/Strike) * Bezugsverhältnis
  // Bei Hebel L gilt: Basispreis (Strike) ≈ Aktienkurs * (1 - 1 / L)
  const impliedStrike = round2(entryPrice * (1 - 1 / activeLeverage));
  const modelCertEntryPrice =
    customCertPrice && customCertPrice > 0
      ? Number(customCertPrice)
      : round2(Math.max(0.1, (entryPrice - impliedStrike) * certRatio));

  const modelCertStopPrice = round2(modelCertEntryPrice * (1 - dDerivat));
  const quantityPieces = Math.max(1, Math.floor(positionSizeEuro / modelCertEntryPrice));
  const actualInvestedEuro = round2(quantityPieces * modelCertEntryPrice);
  const actualRiskEuro = round2(actualInvestedEuro * dDerivat);

  // K.O.-Barriere Sicherheits-Check (Kapitel 4.3): K.O. liegt bei Hebel 5-10 ca. 10% bis 20% unter Kurs,
  // muss zwingend deutlich unter dem eigenen Stop-Loss liegen!
  const maxAllowedKoBarrier = round2(stopLossStock * 0.94);

  // Matrix für alle Hebel 5x bis 10x (Kapitel 5.3)
  const matrix = [10, 8, 7, 6, 5].map((lev) => {
    const dDer = dAktie * lev;
    const rawBuy = rMaxEuro / dDer;
    const buyEuro = round2(Math.min(accountCapital, rawBuy));
    const stopValueEuro = round2(buyEuro * (1 - dDer));
    return {
      leverage: lev,
      isRecommended: lev === recommendedLeverage,
      stopDerivatPct: round2(dDer * 100),
      accountSharePct: round1((buyEuro / accountCapital) * 100),
      buyAmountEuro: buyEuro,
      stopAmountEuro: stopValueEuro,
      maxLossEuro: round2(buyEuro - stopValueEuro)
    };
  });

  return {
    accountCapital,
    maxRiskPct,
    rMaxEuro,
    entryPrice: round2(entryPrice),
    lodPrice: round2(safeLod),
    noiseBufferPct,
    psychAdjusted,
    stopLossStock,
    stopDistanceStockAbs: round2(stopDistanceStockAbs),
    stopDistanceStockPct: round2(stopDistanceStockPct),
    recommendedLeverage,
    activeLeverage,
    leverageReason,
    dDerivatPct,
    rawPositionSizeEuro: round2(rawPositionSizeEuro),
    positionSizeEuro,
    isCappedByCapital,
    accountAllocationPct,
    impliedStrike,
    maxAllowedKoBarrier,
    certRatio,
    modelCertEntryPrice,
    modelCertStopPrice,
    quantityPieces,
    actualInvestedEuro,
    actualRiskEuro,
    matrix
  };
}

/**
 * Überwacht einen laufenden Trade gemäß Kapitel 06 (3-Stufen-Plan & Dynamischer Stagnations-Exit).
 */
export function evaluateActiveTrade(trade, m10Bars, marketClock = {}) {
  if (!trade || !m10Bars || m10Bars.length === 0) return null;

  const latestBar = m10Bars[m10Bars.length - 1];
  const currentPrice = latestBar.close;
  const entryPrice = trade.entryPrice;
  const initialStopStock = trade.stopLossStock;
  const leverage = trade.leverage || 8;
  const riskPerShare = Math.max(0.01, entryPrice - initialStopStock);

  const stockGainAbs = currentPrice - entryPrice;
  const stockGainPct = (stockGainAbs / entryPrice) * 100;
  const derivGainPct = stockGainPct * leverage;
  const rMultiple = stockGainAbs / riskPerShare;
  const pnlEuro = (trade.positionSizeEuro || 1000) * (derivGainPct / 100);

  // Kerzen seit Einstieg
  const barsSinceEntry = m10Bars.filter((b) => b.time >= (trade.entryTime || 0));
  const activeSlice = barsSinceEntry.length >= 2 ? barsSinceEntry : m10Bars.slice(-8);
  const highestSinceEntry = Math.max(...activeSlice.map((b) => b.high), entryPrice);

  // Prüfe, ob der Stop-Loss unter dem Tagestief gerissen wurde
  if (currentPrice <= initialStopStock) {
    return {
      stage: 0,
      stageName: 'STOP-LOSS AUSGELÖST (Unter Tagestief)',
      actionRequired: true,
      alertType: 'STOP_LOSS_HIT',
      recommendation: `STRUKTURELLER STOP-LOSS (${initialStopStock.toFixed(2)}) UNTERSCHRITTEN! Position sofort glattstellen – Verbot der Stop-Loss-Aufweichung (Kap. 07)!`,
      recommendedStopStock: initialStopStock,
      currentPrice: round2(currentPrice),
      stockGainPct: round2(stockGainPct),
      derivGainPct: round2(derivGainPct),
      rMultiple: round2(rMultiple),
      pnlEuro: round2(pnlEuro),
      stagnationCriteria: []
    };
  }

  // Prüfe die 3 Stagnations-Kriterien aus Kapitel 6.2 (nur relevant wenn Trade im Gewinn / nach Aufwärtsimpuls)
  const stagnationCriteria = [];

  // Kriterium 1: Zeitliche & strukturelle Kompression (4 bis 6 M10-Kerzen ohne signifikantes neues Hoch + kleine Kerzenkörper)
  const last4 = m10Bars.slice(-4);
  let barsSincePeak = 0;
  for (let i = activeSlice.length - 1; i >= 0; i--) {
    if (activeSlice[i].high >= highestSinceEntry * 0.999) break;
    barsSincePeak++;
  }
  const high4Ago = m10Bars.length >= 5 ? m10Bars[m10Bars.length - 5].high : highestSinceEntry;
  const noMeaningfulProgress = highestSinceEntry <= high4Ago * 1.0015 || barsSincePeak >= 3;
  const hasMomentumCompression =
    rMultiple >= 1.2 &&
    m10Bars.length >= 5 &&
    noMeaningfulProgress &&
    last4.every((b) => Math.abs(b.close - b.open) <= Math.max(b.atr14 || 0.3, b.high - b.low) * 0.65);

  if (hasMomentumCompression) {
    stagnationCriteria.push({
      id: 'compression',
      name: 'Kriterium 1: Momentum-Abriss (Kompression)',
      detail: `Mindestens 4 M10-Kerzen (40+ Min.) ohne dynamisches neues Hoch bei schrumpfenden Kerzenkörpern`
    });
  }

  // Kriterium 2: Abprall an Widerstand / Mehrfache obere Dochte (Shooting-Star-Kerzen)
  const last5 = m10Bars.slice(-5);
  const upperWickBars = last5.filter((b) => {
    const range = Math.max(0.0001, b.high - b.low);
    const upperWick = b.high - Math.max(b.open, b.close);
    return upperWick / range >= 0.38;
  });
  const hasRejectionWicks = rMultiple >= 1.2 && upperWickBars.length >= 2 && currentPrice <= highestSinceEntry * 0.999;
  if (hasRejectionWicks) {
    stagnationCriteria.push({
      id: 'rejection',
      name: 'Kriterium 2: Abprall am Widerstand (Obere Dochte)',
      detail: `${upperWickBars.length} M10-Kerzen mit ausgeprägten oberen Verkaufsdochten nahe ${highestSinceEntry.toFixed(2)}`
    });
  }

  // Kriterium 3: Strukturbruch im M10-Aufwärtstrend (Schlusskurs unter letztem Higher Low & unter M10-EMA 20)
  const prev3Lows = m10Bars.slice(-4, -1).map((b) => b.low);
  const lastHigherLow = prev3Lows.length > 0 ? Math.min(...prev3Lows) : initialStopStock;
  const hasStructureBreak =
    rMultiple >= 1.0 &&
    latestBar.close < latestBar.open &&
    latestBar.close < lastHigherLow &&
    latestBar.close < latestBar.ema20;

  if (hasStructureBreak) {
    stagnationCriteria.push({
      id: 'structure_break',
      name: 'Kriterium 3: Strukturbruch im M10 (Unter Higher Low & EMA 20)',
      detail: `Rote M10-Kerze schließt bei ${currentPrice.toFixed(2)} unter Zwischentief (${lastHigherLow.toFixed(2)}) & EMA 20 (${latestBar.ema20.toFixed(2)})`
    });
  }

  // Overnight-Regel (Kapitel 6.3): Kurz vor Handelsschluss (17:30 EU / 22:00 US) ohne Gewinnpolster (< 1.5R)
  const overnightWarning = marketClock.isNearClose && rMultiple < 1.5;

  let stage = 1;
  let stageName = 'Stufe 1: Initial Risk (Stop unter Tagestief belassen)';
  let actionRequired = false;
  let alertType = 'HOLD_STAGE_1';
  let recommendedStopStock = initialStopStock;
  let recommendation = `Stop-Loss bleibt unangetastet bei ${initialStopStock.toFixed(2)} (unter LoD). Der Trade braucht anfangs Luft zum Atmen.`;

  if (stagnationCriteria.length > 0) {
    stage = 3;
    stageName = 'Stufe 3: DYNAMISCHER STAGNATIONS-EXIT AUSGELÖST!';
    actionRequired = true;
    alertType = 'STAGNATION_EXIT';
    recommendedStopStock = round2(lastHigherLow);
    recommendation = `TAKE PROFIT / VERKAUF BEI STAGNATION: ${stagnationCriteria.map((c) => c.name).join(' + ')}. Position glattstellen (oder 50% Teilverkauf + enger Trailing-Stop auf ${lastHigherLow.toFixed(2)})!`;
  } else if (overnightWarning) {
    stage = 1;
    stageName = 'Overnight-Schutzregel (Kap. 6.3): Vor Börsenschluss glattstellen!';
    actionRequired = true;
    alertType = 'OVERNIGHT_CLOSE_WARNING';
    recommendation = 'Börsenschluss naht und Position hat noch kein Stufe-2-Gewinnpolster! Laut Kapitel 6.3 vor Handelsschluss manuell schließen (Schutz vor Eröffnungs-Gap).';
  } else if (rMultiple >= 1.5) {
    stage = 2;
    stageName = 'Stufe 2: Free-Ride-Sicherung (Break-Even erreicht!)';
    actionRequired = !trade.breakEvenNotified;
    alertType = 'MOVE_TO_BREAKEVEN';
    recommendedStopStock = round2(Math.max(entryPrice, lastHigherLow * 0.9985));
    recommendation = `Buchgewinn liegt bei +${rMultiple.toFixed(2)}R (+${stockGainPct.toFixed(2)}% in Aktie / +${derivGainPct.toFixed(1)}% im Derivat). Stop-Loss jetzt auf Einstiegskurs (${entryPrice.toFixed(2)} = Break-Even) bzw. letztes M10-Zwischentief (${recommendedStopStock.toFixed(2)}) nachziehen!`;
  }

  return {
    stage,
    stageName,
    actionRequired,
    alertType,
    recommendation,
    recommendedStopStock,
    currentPrice: round2(currentPrice),
    highestSinceEntry: round2(highestSinceEntry),
    stockGainPct: round2(stockGainPct),
    derivGainPct: round2(derivGainPct),
    rMultiple: round2(rMultiple),
    pnlEuro: round2(pnlEuro),
    stagnationCriteria,
    overnightWarning
  };
}

/**
 * Überwacht einen laufenden Reverse-/Short-Trade (Account 2: Inverse Strategie / Turbo-Short):
 * - Gewinnt, wenn die Aktie nach dem Phase-4-Signal weiter fällt (oder auf das alte LoD/darunter durchbricht).
 * - Stop-Loss liegt oberhalb des Einstiegskurses (Entry + originaler Risikoabstand).
 * - Take-Profit / Exit greift bei >= +2.0R Abwärtsimpuls, Abwärts-Stagnation am neuen Tief (>= +1.2R) oder zum Börsenschluss.
 */
export function evaluateReverseActiveTrade(trade, m10Bars, marketClock = {}) {
  if (!trade || !m10Bars || m10Bars.length === 0) return null;

  const latestBar = m10Bars[m10Bars.length - 1];
  const currentPrice = latestBar.close;
  const entryPrice = trade.entryPrice;
  const initialStopStock = trade.stopLossStock; // Beim Short liegt der Stop ÜBER dem Entry!
  const leverage = trade.leverage || 8;
  const riskPerShare = Math.max(0.01, Math.abs(initialStopStock - entryPrice));

  // Beim Short-Trade ist ein Kursrückgang (entryPrice - currentPrice > 0) ein Gewinn!
  const stockGainAbs = entryPrice - currentPrice;
  const stockGainPct = (stockGainAbs / entryPrice) * 100;
  const derivGainPct = Math.max(-99, stockGainPct * leverage);
  const rMultiple = stockGainAbs / riskPerShare;
  const pnlEuro = (trade.positionSizeEuro || 1000) * (derivGainPct / 100);

  const barsSinceEntry = m10Bars.filter((b) => b.time >= (trade.entryTime || 0));
  const activeSlice = barsSinceEntry.length >= 2 ? barsSinceEntry : m10Bars.slice(-8);
  const lowestSinceEntry = Math.min(...activeSlice.map((b) => b.low), entryPrice);

  // 1. Prüfe Short-Stop-Loss (Kurs steigt über den oberen Stop-Loss)
  if (currentPrice >= initialStopStock) {
    return {
      stage: 0,
      stageName: 'SHORT STOP-LOSS AUSGELÖST (Über oberem Stop)',
      actionRequired: true,
      alertType: 'STOP_LOSS_HIT',
      recommendation: `SHORT STOP-LOSS (${initialStopStock.toFixed(2)} €) ÜBERSCHRITTEN! Short-Position glattstellen.`,
      recommendedStopStock: initialStopStock,
      currentPrice: round2(currentPrice),
      stockGainPct: round2(stockGainPct),
      derivGainPct: round2(derivGainPct),
      rMultiple: round2(rMultiple),
      pnlEuro: round2(pnlEuro),
      stagnationCriteria: []
    };
  }

  // 2. Prüfe Short Take-Profit / Abwärts-Stagnation
  const stagnationCriteria = [];
  const prev3Highs = m10Bars.slice(-4, -1).map((b) => b.high);
  const lastLowerHigh = prev3Highs.length > 0 ? Math.max(...prev3Highs) : initialStopStock;

  // Direktes Kursziel (+2.2R im Short erreicht) oder Stagnation nach starkem Drop (>= 1.2R)
  if (rMultiple >= 2.2) {
    stagnationCriteria.push({
      id: 'short_target_hit',
      name: 'Short-Kursziel (+2.2R Abwärtsimpuls) erreicht',
      detail: `Aktie ist nach Signal unter das Tagestief gefallen (+${rMultiple.toFixed(2)}R Gewinn im Short)`
    });
  } else if (
    rMultiple >= 1.2 &&
    latestBar.close > latestBar.open &&
    latestBar.close > lowestSinceEntry * 1.003
  ) {
    stagnationCriteria.push({
      id: 'short_bounce_exit',
      name: 'Short-Gewinnmitnahme nach neuem Tief',
      detail: `Abwärtsbewegung stagniert nach +${rMultiple.toFixed(2)}R bei ${currentPrice.toFixed(2)} €`
    });
  }

  const overnightWarning = marketClock.isNearClose && rMultiple < 1.5;

  let stage = 1;
  let stageName = 'Stufe 1: Short aktiv (Stop über Einstieg)';
  let actionRequired = false;
  let alertType = 'HOLD_STAGE_1';
  let recommendedStopStock = initialStopStock;
  let recommendation = `Short läuft. Stop-Loss liegt bei ${initialStopStock.toFixed(2)} €.`;

  if (stagnationCriteria.length > 0) {
    stage = 3;
    stageName = 'Stufe 3: SHORT TAKE-PROFIT AUSGELÖST!';
    actionRequired = true;
    alertType = 'STAGNATION_EXIT';
    recommendedStopStock = round2(Math.min(entryPrice, lastLowerHigh));
    recommendation = `SHORT TAKE-PROFIT: ${stagnationCriteria.map((c) => c.name).join(' + ')}.`;
  } else if (overnightWarning) {
    stage = 1;
    stageName = 'Overnight-Schutz: Vor Börsenschluss glattstellen';
    actionRequired = true;
    alertType = 'OVERNIGHT_CLOSE_WARNING';
    recommendation = 'Vor Handelsschluss Short glattstellen.';
  } else if (rMultiple >= 1.5) {
    stage = 2;
    stageName = 'Stufe 2: Short Break-Even gesichert';
    actionRequired = !trade.breakEvenNotified;
    alertType = 'MOVE_TO_BREAKEVEN';
    recommendedStopStock = round2(Math.min(entryPrice, lastLowerHigh * 1.0015));
    recommendation = `Short-Gewinn bei +${rMultiple.toFixed(2)}R. Stop-Loss auf Break-Even (${recommendedStopStock.toFixed(2)} €) nachgezogen.`;
  }

  return {
    stage,
    stageName,
    actionRequired,
    alertType,
    recommendation,
    recommendedStopStock,
    currentPrice: round2(currentPrice),
    lowestSinceEntry: round2(lowestSinceEntry),
    stockGainPct: round2(stockGainPct),
    derivGainPct: round2(derivGainPct),
    rMultiple: round2(rMultiple),
    pnlEuro: round2(pnlEuro),
    stagnationCriteria,
    overnightWarning
  };
}

/**
 * Generiert die Pre-Trade-Checkliste (9 Pflichtkriterien aus Kapitel 09) für ein analysiertes Setup.
 */
export function buildPreTradeChecklist(analysis, fundamentals, marketClock, sizing) {
  return [
    {
      nr: '01',
      title: 'Qualität & Liquidität des Basiswerts',
      requirement: 'Etabliertes, profitables Qualitätsunternehmen (Large/Mid Cap) mit engem Spread?',
      passed: Boolean(fundamentals?.pePassed),
      detail: fundamentals?.peReason || 'Geprüft'
    },
    {
      nr: '02',
      title: 'Katalysator & KGV-Bewertung',
      requirement: 'Abverkauf ist eine temporäre Überreaktion (keine Existenzkrise); KGV attraktiv?',
      passed: Boolean(fundamentals?.pePassed && !fundamentals?.isCrashExcluded && fundamentals?.isSignificantDip),
      detail: `${fundamentals?.dipReason || ''} | ${fundamentals?.peReason || ''}`
    },
    {
      nr: '03',
      title: 'Kein bevorstehendes Binär-Event',
      requirement: 'Keine Quartalszahlen (Earnings) in den nächsten Stunden / vor dem nächsten Handelstag?',
      passed: !fundamentals?.earningsLocked,
      detail: fundamentals?.earningsNote || 'Keine unmittelbaren Earnings'
    },
    {
      nr: '04',
      title: '4-Phasen-Boden im 10m-Chart (M10)',
      requirement: 'Selling Climax beendet, klares Tagestief (LoD) markiert und über mehrere M10-Kerzen verteidigt?',
      passed: analysis?.phase >= 3,
      detail: `Aktuell in ${analysis?.phaseName} (${analysis?.barsSinceFirstLow || 0} M10-Kerzen seit LoD ${analysis?.lodPrice ?? '-'})`
    },
    {
      nr: '05',
      title: 'Konfluenz & Impuls-Trigger',
      requirement: 'Grüne M10-Ausbruchskerze sichtbar (idealerweise + RSI-Divergenz / übergeordneter Support)?',
      passed: analysis?.phase === 4 && (analysis?.confluenceCount || 0) >= 2,
      detail: `${analysis?.confluenceCount || 0}/4 Konfluenz-Signale aktiv (${analysis?.phase === 4 ? 'Breakout bestätigt' : 'Warten auf Trigger-Kerze'})`
    },
    {
      nr: '06',
      title: 'Derivate-Wahl & Handelszeit',
      requirement: 'Klassischer Turbo Long / Mini-Future mit Hebel 5x–10x; Heimatbörse der Aktie ist geöffnet?',
      passed: Boolean(marketClock?.isOpen),
      detail: `${marketClock?.reason || ''} | Empfohlener Hebel: ${sizing?.activeLeverage || 8}x`
    },
    {
      nr: '07',
      title: 'Struktureller Stop-Loss definiert',
      requirement: 'Stop-Loss-Marke in der Aktie knapp unterhalb des Tagestiefs (inkl. Puffer) exakt abgemessen?',
      passed: Boolean(sizing?.stopLossStock),
      detail: sizing
        ? `Stop-Loss Aktie: ${sizing.stopLossStock.toFixed(2)} (LoD ${sizing.lodPrice.toFixed(2)} - ${sizing.noiseBufferPct}% Puffer = -${sizing.stopDistanceStockPct.toFixed(2)}%)`
        : 'Ausstehend'
    },
    {
      nr: '08',
      title: '5-%-Risiko-Berechnung & Order',
      requirement: 'Positionsgröße nach Formel berechnet (Max. Verlust <= 5 % Gesamtkapital) und Stop-Order gesetzt?',
      passed: Boolean(sizing?.positionSizeEuro),
      detail: sizing
        ? `Kaufbetrag: ${sizing.positionSizeEuro.toFixed(0)} € (${sizing.accountAllocationPct}% vom Konto) | Max. Risiko: ${sizing.rMaxEuro.toFixed(0)} € (${sizing.maxRiskPct}%)`
        : 'Ausstehend'
    },
    {
      nr: '09',
      title: 'Exit-Plan verinnerlicht',
      requirement: 'Nachziehen auf Break-Even ab erstem Impuls; Komplettverkauf erst bei Stagnation im M10-Chart?',
      passed: true,
      detail: 'Stufe 1 (LoD-Stop) → Stufe 2 (Break-Even ab 1.5R) → Stufe 3 (Dynamischer Stagnations-Exit)'
    }
  ];
}

/**
 * Erzeugt die exakte End-to-End Praxis-Fallstudie aus Kapitel 08 des Playbooks
 * (Symrise / Erste Group: Vortag 106,00 €, Eröffnung 98,00 € (-7,5%),
 *  09:00-09:30 Selling Climax auf 95,40 €, 09:40 Hammer-Kerze (Phase 2),
 *  09:40-10:20 4 M10-Kerzen Kompression (Phase 3),
 *  10:30 Grüne Ausbruchskerze auf 96,50 € über EMA20 (Phase 4 Entry),
 *  und optional 10:30-16:40 Aufwärtstrend bis 100,40 € mit Stagnations-Exit).
 */
export function generatePlaybookCaseStudyBars(targetStage = 'phase4_entry') {
  // Basis-Zeitpunkt: Heutiger Tag 09:00 Uhr (bzw. vor einigen Stunden)
  const baseTs = Math.floor(Date.now() / 600000) * 600 - 30 * 600;
  const sessionDate = 'PLAYBOOK-CASE-STUDY';

  // Vorlauf am Vortag bei ~106.00 € (damit EMA20 & RSI realistisch einlaufen)
  const prevDayBars = [];
  for (let i = 0; i < 12; i++) {
    const t = baseTs - (14 - i) * 600;
    prevDayBars.push({
      time: t,
      open: 106.2 - (i % 2) * 0.15,
      high: 106.4,
      low: 105.8,
      close: 106.0,
      volume: 18000,
      sessionDate: 'PREV-DAY'
    });
  }

  // Heutiger Handelstag ab 09:00 Uhr (Gap-Down auf 98.00 €)
  const intradaySteps = [
    // 09:00 - 09:30: Phase 1 (Selling Climax: 3 lange rote M10-Kerzen von 98,00 € auf 95,40 €)
    { offset: 0, open: 98.00, high: 98.15, low: 96.90, close: 97.00, volume: 65000 }, // 09:00
    { offset: 1, open: 97.00, high: 97.10, low: 96.05, close: 96.15, volume: 78000 }, // 09:10
    { offset: 2, open: 96.15, high: 96.25, low: 95.42, close: 95.50, volume: 95000 }, // 09:20
    // 09:40: Phase 2 (Hammer-Kerze mit Tief bei 95,40 € und Schlusskurs bei 96,10 € bei hohem Climax-Volumen)
    { offset: 3, open: 95.55, high: 96.15, low: 95.40, close: 96.10, volume: 125000 }, // 09:30/09:40 LoD markiert!
    // 09:40 - 10:20: Phase 3 (4 M10-Kerzen Kompression zwischen 95,60 € und 96,20 € bei stark sinkendem Volumen)
    { offset: 4, open: 96.10, high: 96.20, low: 95.75, close: 95.85, volume: 42000 },
    { offset: 5, open: 95.85, high: 96.05, low: 95.60, close: 95.95, volume: 31000 },
    { offset: 6, open: 95.95, high: 96.15, low: 95.62, close: 95.80, volume: 26000 },
    { offset: 7, open: 95.80, high: 96.18, low: 95.70, close: 96.12, volume: 24000 },
    // 10:30: Phase 4 (Dynamische grüne Ausbruchskerze schließt bei 96,50 € über dem M10-EMA 20!)
    { offset: 8, open: 96.12, high: 96.58, low: 96.08, close: 96.50, volume: 68000 }
  ];

  // Falls Stagnations-Exit (16:40 Uhr bei 100,30 €) simuliert werden soll:
  const rallyAndStagnationSteps = [
    { offset: 9, open: 96.50, high: 97.25, low: 96.45, close: 97.15, volume: 54000 },
    { offset: 10, open: 97.15, high: 98.10, low: 97.10, close: 98.00, volume: 61000 }, // Stufe 2 Break-Even!
    { offset: 11, open: 98.00, high: 98.95, low: 97.85, close: 98.80, volume: 49000 },
    { offset: 12, open: 98.80, high: 99.70, low: 98.75, close: 99.60, volume: 52000 },
    { offset: 13, open: 99.60, high: 100.48, low: 99.55, close: 100.40, volume: 58000 },
    // 16:00 - 16:40: 4x Abprall an 100,50 € mit oberen Dochten & kleinen Kerzenkörpern (Stagnation!)
    { offset: 14, open: 100.40, high: 100.52, low: 100.15, close: 100.25, volume: 35000 },
    { offset: 15, open: 100.25, high: 100.50, low: 100.18, close: 100.28, volume: 29000 },
    { offset: 16, open: 100.28, high: 100.49, low: 100.20, close: 100.24, volume: 25000 },
    { offset: 17, open: 100.24, high: 100.48, low: 100.18, close: 100.30, volume: 22000 }
  ];

  let cutIndex = 9; // Standard: bis inkl. Phase 4 (offset 8)
  if (targetStage === 'phase1') cutIndex = 3;
  else if (targetStage === 'phase2_watchlist') cutIndex = 4;
  else if (targetStage === 'phase3_prepare') cutIndex = 8;
  else if (targetStage === 'phase4_entry') cutIndex = 9;
  else if (targetStage === 'stagnation_exit') cutIndex = 9 + rallyAndStagnationSteps.length;

  const allIntraday = [...intradaySteps, ...rallyAndStagnationSteps].slice(0, cutIndex);
  const currentBars = allIntraday.map((s) => ({
    time: baseTs + s.offset * 600,
    open: s.open,
    high: s.high,
    low: s.low,
    close: s.close,
    volume: s.volume,
    sessionDate
  }));

  return enrichM10Indicators([...prevDayBars, ...currentBars]);
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}
