import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resampleToM10,
  analyzeM10BottomFormation,
  evaluateBuyStrategyEntry,
  calculateRiskAndPositionSizing,
  evaluateActiveTrade,
  generatePlaybookCaseStudyBars
} from '../src/strategy.js';

test('Resampling 5m Kerzen zu exakten 10-Minuten-Kerzen (M10)', () => {
  const raw5m = [
    { time: 1700000400, open: 100, high: 101, low: 99.5, close: 100.5, volume: 1000 },
    { time: 1700000700, open: 100.5, high: 102, low: 100.0, close: 101.8, volume: 1500 },
    { time: 1700001000, open: 101.8, high: 102.2, low: 101.0, close: 101.2, volume: 800 }
  ];
  const m10 = resampleToM10(raw5m);
  assert.equal(m10.length, 2);
  assert.equal(m10[0].open, 100);
  assert.equal(m10[0].high, 102);
  assert.equal(m10[0].low, 99.5);
  assert.equal(m10[0].close, 101.8);
  assert.equal(m10[0].volume, 2500);
});

test('Playbook Kapitel 08 Fallstudie durchläuft exakt Phase 1 -> Phase 2 -> Phase 3 -> Phase 4', () => {
  const fundamentals = {
    pePassed: true,
    isSignificantDip: true,
    intradayChangePct: -8.9,
    dipFromSwingHighPct: -8.9
  };

  // Phase 1: Selling Climax (Kaufverbot)
  const barsP1 = generatePlaybookCaseStudyBars('phase1');
  const resP1 = analyzeM10BottomFormation(barsP1, {}, fundamentals);
  assert.equal(resP1.phase, 1);

  // Phase 2: Absorption & Erstes Tagestief (LoD bei 95.40 €)
  const barsP2 = generatePlaybookCaseStudyBars('phase2_watchlist');
  const resP2 = analyzeM10BottomFormation(barsP2, {}, fundamentals);
  assert.equal(resP2.phase, 2);
  assert.equal(resP2.lodPrice, 95.40);

  // Phase 3: Sekundärer Test & Kompression über 4 M10-Kerzen
  const barsP3 = generatePlaybookCaseStudyBars('phase3_prepare');
  const resP3 = analyzeM10BottomFormation(barsP3, {}, fundamentals);
  assert.equal(resP3.phase, 3);
  assert.equal(resP3.lodPrice, 95.40);

  // Phase 4: Impuls-Trigger (Ausbruchskerze auf 96.50 € über EMA20)
  const barsP4 = generatePlaybookCaseStudyBars('phase4_entry');
  const resP4 = analyzeM10BottomFormation(barsP4, {}, fundamentals);
  assert.equal(resP4.phase, 4);
  assert.equal(resP4.currentPrice, 96.50);
  assert.ok(resP4.confluenceCount >= 2, 'Mindestens 2 Konfluenz-Signale müssen aktiv sein');
});

test('5%-Kapitalrisiko & Derivate-Berechnung stimmt mit Playbook Kapitel 05 & 08 überein', () => {
  const sizing = calculateRiskAndPositionSizing({
    entryPrice: 96.50,
    lodPrice: 95.40,
    accountCapital: 10000,
    maxRiskPct: 5.0,
    noiseBufferPct: 0.21, // ergibt Stop-Loss 95.20 €
    stockProfile: 'conservative',
    customLeverage: 8,
    customCertPrice: 1.20
  });

  assert.equal(sizing.rMaxEuro, 500);
  assert.equal(sizing.stopLossStock, 95.20);
  assert.ok(Math.abs(sizing.stopDistanceStockPct - 1.35) <= 0.02);
  assert.ok(Math.abs(sizing.dDerivatPct - 10.78) <= 0.1);
  assert.ok(sizing.positionSizeEuro >= 4600 && sizing.positionSizeEuro <= 4660);
});

test('Dynamischer Stagnations-Exit (Kapitel 06) erkennt Stufe 3 bei 100,30 €', () => {
  const barsExit = generatePlaybookCaseStudyBars('stagnation_exit');
  const trade = {
    id: 't1',
    symbol: 'SY1.DE',
    name: 'Symrise AG',
    entryPrice: 96.50,
    lodPrice: 95.40,
    stopLossStock: 95.20,
    leverage: 8,
    positionSizeEuro: 4630,
    entryTime: barsExit[20].time
  };

  const evalRes = evaluateActiveTrade(trade, barsExit, { isOpen: true });
  assert.equal(evalRes.stage, 3);
  assert.equal(evalRes.alertType, 'STAGNATION_EXIT');
  assert.ok(evalRes.derivGainPct > 30);
});

test('Buy-Strategie v2 Entry-Gate akzeptiert starke Phase-4-Setups und filtert schwache aus', () => {
  const strongAnalysis = {
    phase: 4,
    confluenceCount: 2,
    barsSinceFirstLow: 5,
    currentPrice: 101.2,
    ema20: 100.5,
    vwap: 100.8,
    rsi14: 48
  };
  const okFund = { fundamentalPassed: true };
  const okSizing = { stopDistanceStockPct: 1.4 };
  const okIndex = { changePct: -0.2, isFallingHard: false };

  const accepted = evaluateBuyStrategyEntry(strongAnalysis, okFund, okSizing, okIndex);
  assert.equal(accepted.qualified, true);
  assert.equal(accepted.reasons.length, 0);

  const weakConfluence = evaluateBuyStrategyEntry(
    { ...strongAnalysis, confluenceCount: 1 },
    okFund,
    okSizing,
    okIndex
  );
  assert.equal(weakConfluence.qualified, false);

  const weakIndex = evaluateBuyStrategyEntry(
    strongAnalysis,
    okFund,
    okSizing,
    { changePct: -1.15, isFallingHard: true }
  );
  assert.equal(weakIndex.qualified, false);

  const wideStop = evaluateBuyStrategyEntry(
    strongAnalysis,
    okFund,
    { stopDistanceStockPct: 3.2 },
    okIndex
  );
  assert.equal(wideStop.qualified, false);
});

test('Buy-Strategie v2 Trade-Management: +1.0R Break-Even, +1.1R Pullback-TP, 80-Min. Time-Stop & initialStopStock', () => {
  const baseTime = 1700000000;
  const makeBars = (candles) =>
    candles.map((c, idx) => ({
      time: baseTime + idx * 600,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      ema20: c.ema20 ?? 100.0,
      atr14: 0.5
    }));

  // 1) +1.0R Break-Even & R-Multiple Berechnung über initialStopStock (nicht verzerrt durch nachgezogenen Stop)
  const beBars = makeBars([
    { open: 100.0, high: 100.4, low: 99.8, close: 100.3, ema20: 99.9 },
    { open: 100.3, high: 101.2, low: 100.2, close: 101.1, ema20: 100.1 }
  ]);
  const beTrade = {
    entryPrice: 100.0,
    initialStopStock: 99.0,
    stopLossStock: 100.1, // bereits auf Break-Even nachgezogen
    leverage: 8,
    positionSizeEuro: 2500,
    entryTime: baseTime
  };
  const beEval = evaluateActiveTrade(beTrade, beBars, { isOpen: true });
  assert.equal(beEval.stage, 2);
  assert.equal(beEval.alertType, 'MOVE_TO_BREAKEVEN');
  assert.equal(beEval.rMultiple, 1.1);

  // 2) +1.1R Momentum-Pullback Take-Profit bei erster roter Kerze >= 0.25% unter Hoch
  const pullbackBars = makeBars([
    { open: 100.0, high: 101.8, low: 99.9, close: 101.7, ema20: 100.2 },
    { open: 101.7, high: 101.75, low: 101.2, close: 101.3, ema20: 100.4 }
  ]);
  const pbTrade = {
    entryPrice: 100.0,
    initialStopStock: 99.0,
    stopLossStock: 99.0,
    leverage: 8,
    positionSizeEuro: 2500,
    entryTime: baseTime
  };
  const pbEval = evaluateActiveTrade(pbTrade, pullbackBars, { isOpen: true });
  assert.equal(pbEval.stage, 3);
  assert.equal(pbEval.alertType, 'STAGNATION_EXIT');
  assert.ok(pbEval.stagnationCriteria.some((c) => c.id === 'long_momentum_pullback'));

  // 3) 80-Minuten Weak-Bounce Time-Stop (8 M10-Kerzen, < -0.25R & unter EMA20)
  const weakBars = makeBars(
    Array.from({ length: 8 }, (_, i) => ({
      open: 99.8,
      high: 99.9,
      low: 99.5,
      close: i === 7 ? 99.6 : 99.7,
      ema20: 100.1
    }))
  );
  const tsEval = evaluateActiveTrade(pbTrade, weakBars, { isOpen: true });
  assert.equal(tsEval.alertType, 'TIME_STOP_EXIT');
  assert.ok(tsEval.rMultiple <= -0.3);
});

