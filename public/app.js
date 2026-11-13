/**
 * Mean-Reversion Playbook Terminal (TradingView Lightweight Charts Edition)
 * - Echte 10-Minuten-Kerzen (M10), EMA 20, Intraday-VWAP, Volumen, Tagestief (LoD), Stop-Loss & RSI(14)
 * - Alle 51 Qualitätsaktien & 7 Leitindizes in Echtzeit
 * - @PureSiteTrading_bot Direkt-Kopplung & synchrone Web-/Telegram-Alarme
 */

const state = {
  snapshot: null,
  selectedSymbol: 'SY1.DE',
  activeFilter: 'all',
  activeRegion: 'ALL',
  searchQuery: '',
  chartBars: [],
  chartRecord: null,
  ws: null,

  // TradingView Lightweight Charts Instanzen
  tvMain: null,
  tvRsi: null,
  candleSeries: null,
  volumeSeries: null,
  emaSeries: null,
  vwapSeries: null,
  rsiSeries: null,
  lodPriceLine: null,
  slPriceLine: null
};

document.addEventListener('DOMContentLoaded', () => {
  initTradingViewCharts();
  bindUIEvents();
  connectWebSocket();
  fetchInitialSnapshot();
});

// --- TRADINGVIEW LIGHTWEIGHT CHARTS INITIALISIERUNG ---

function initTradingViewCharts() {
  const mainEl = document.getElementById('tvMainChart');
  const rsiEl = document.getElementById('tvRsiChart');
  if (!mainEl || !rsiEl || !window.LightweightCharts) return;

  const LWC = window.LightweightCharts;

  state.tvMain = LWC.createChart(mainEl, {
    width: mainEl.clientWidth || 800,
    height: 330,
    layout: {
      background: { type: 'solid', color: '#070b14' },
      textColor: '#94a3b8',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11
    },
    grid: {
      vertLines: { color: 'rgba(148, 163, 184, 0.06)' },
      horzLines: { color: 'rgba(148, 163, 184, 0.06)' }
    },
    crosshair: {
      mode: LWC.CrosshairMode.Normal
    },
    rightPriceScale: {
      borderColor: 'rgba(148, 163, 184, 0.14)',
      scaleMargins: { top: 0.08, bottom: 0.22 }
    },
    timeScale: {
      borderColor: 'rgba(148, 163, 184, 0.14)',
      timeVisible: true,
      secondsVisible: false
    }
  });

  state.candleSeries = state.tvMain.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444'
  });

  state.volumeSeries = state.tvMain.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: ''
  });
  state.volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.80, bottom: 0 }
  });

  state.emaSeries = state.tvMain.addLineSeries({
    color: '#38bdf8',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'EMA 20'
  });

  state.vwapSeries = state.tvMain.addLineSeries({
    color: '#a855f7',
    lineWidth: 2,
    lineStyle: LWC.LineStyle.Dashed,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'VWAP'
  });

  // RSI(14) Sub-Chart
  state.tvRsi = LWC.createChart(rsiEl, {
    width: rsiEl.clientWidth || 800,
    height: 115,
    layout: {
      background: { type: 'solid', color: '#070b14' },
      textColor: '#64748b',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10.5
    },
    grid: {
      vertLines: { color: 'rgba(148, 163, 184, 0.05)' },
      horzLines: { color: 'rgba(148, 163, 184, 0.06)' }
    },
    rightPriceScale: {
      borderColor: 'rgba(148, 163, 184, 0.14)',
      scaleMargins: { top: 0.12, bottom: 0.12 }
    },
    timeScale: {
      visible: false
    }
  });

  state.rsiSeries = state.tvRsi.addLineSeries({
    color: '#10b981',
    lineWidth: 2,
    priceLineVisible: false,
    title: 'RSI 14'
  });

  // RSI 30 & 70 Referenzlinien
  state.rsiSeries.createPriceLine({
    price: 30,
    color: 'rgba(16, 185, 129, 0.5)',
    lineWidth: 1,
    lineStyle: LWC.LineStyle.Dashed,
    axisLabelVisible: true,
    title: '30'
  });
  state.rsiSeries.createPriceLine({
    price: 70,
    color: 'rgba(239, 68, 68, 0.4)',
    lineWidth: 1,
    lineStyle: LWC.LineStyle.Dashed,
    axisLabelVisible: true,
    title: '70'
  });

  // Synchronisiere sichtbare Zeitskala zwischen Hauptchart und RSI-Chart
  state.tvMain.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) state.tvRsi.timeScale().setVisibleLogicalRange(range);
  });

  // Crosshair-Hover Info
  state.tvMain.subscribeCrosshairMove((param) => {
    const infoEl = document.getElementById('chartHoverInfo');
    if (!param || !param.time || !param.seriesData) {
      infoEl.textContent = 'Maus über Chart bewegen für exakte M10-Kerzendaten';
      return;
    }
    const c = param.seriesData.get(state.candleSeries);
    if (!c) return;
    const tStr = new Date(param.time * 1000).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const chgPct = c.open ? (((c.close - c.open) / c.open) * 100).toFixed(2) : '0.00';
    infoEl.innerHTML = `<b>${tStr} Uhr</b> · O: ${c.open.toFixed(2)} · H: ${c.high.toFixed(2)} · L: ${c.low.toFixed(2)} · <b>C: ${c.close.toFixed(2)} (${chgPct >= 0 ? '+' : ''}${chgPct}%)</b>`;
  });

  // Responsive ResizeObserver
  const ro = new ResizeObserver(() => {
    if (state.tvMain && mainEl.clientWidth > 0) {
      state.tvMain.applyOptions({ width: mainEl.clientWidth });
    }
    if (state.tvRsi && rsiEl.clientWidth > 0) {
      state.tvRsi.applyOptions({ width: rsiEl.clientWidth });
    }
  });
  ro.observe(mainEl);
}

function updateTradingViewChartData() {
  if (!state.candleSeries || !state.chartBars || state.chartBars.length === 0) return;
  const LWC = window.LightweightCharts;

  // Dedupliziere & sortiere nach Zeit aufsteigend
  const seen = new Set();
  const sorted = [...state.chartBars]
    .sort((a, b) => a.time - b.time)
    .filter((b) => {
      if (!b.time || seen.has(b.time)) return false;
      seen.add(b.time);
      return true;
    });

  const candles = sorted.map((b) => ({
    time: b.time,
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close)
  }));

  const volumes = sorted.map((b) => ({
    time: b.time,
    value: Number(b.volume || 0),
    color: b.close >= b.open ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)'
  }));

  const emaData = sorted
    .filter((b) => Number.isFinite(b.ema20))
    .map((b) => ({ time: b.time, value: Number(b.ema20) }));

  const vwapData = sorted
    .filter((b) => Number.isFinite(b.vwap))
    .map((b) => ({ time: b.time, value: Number(b.vwap) }));

  const rsiData = sorted
    .filter((b) => Number.isFinite(b.rsi14))
    .map((b) => ({ time: b.time, value: Number(b.rsi14) }));

  state.candleSeries.setData(candles);
  state.volumeSeries.setData(volumes);
  state.emaSeries.setData(emaData);
  state.vwapSeries.setData(vwapData);
  state.rsiSeries.setData(rsiData);

  // Entferne alte Preislinien (LoD & Stop-Loss) und zeichne aktuelle ein
  if (state.lodPriceLine) {
    state.candleSeries.removePriceLine(state.lodPriceLine);
    state.lodPriceLine = null;
  }
  if (state.slPriceLine) {
    state.candleSeries.removePriceLine(state.slPriceLine);
    state.slPriceLine = null;
  }

  const rec = state.chartRecord;
  const lodPrice = rec?.analysis?.lodPrice;
  const slPrice = rec?.sizing?.stopLossStock;

  if (lodPrice && lodPrice > 0) {
    state.lodPriceLine = state.candleSeries.createPriceLine({
      price: Number(lodPrice),
      color: '#f59e0b',
      lineWidth: 2,
      lineStyle: LWC.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Tagestief (LoD) ${lodPrice.toFixed(2)}`
    });
  }

  if (slPrice && slPrice > 0) {
    state.slPriceLine = state.candleSeries.createPriceLine({
      price: Number(slPrice),
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: LWC.LineStyle.Dotted,
      axisLabelVisible: true,
      title: `Stop-Loss ${slPrice.toFixed(2)}`
    });
  }

  state.tvMain.timeScale().fitContent();
  state.tvRsi.timeScale().fitContent();
}

// --- UI EVENTS ---

function bindUIEvents() {
  document.getElementById('btnScanNow').addEventListener('click', async () => {
    const btn = document.getElementById('btnScanNow');
    btn.disabled = true;
    btn.textContent = '⏳ Scanne...';
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const snap = await res.json();
      applySnapshot(snap);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Scan';
    }
  });

  // Fallstudie (Kapitel 08) Dropdown
  const simDropdown = document.querySelector('.sim-dropdown');
  document.getElementById('btnSimCaseStudy').addEventListener('click', (e) => {
    e.stopPropagation();
    simDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => simDropdown.classList.remove('open'));

  document.querySelectorAll('#simMenu button[data-sim]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      simDropdown.classList.remove('open');
      const stage = btn.getAttribute('data-sim');
      await runCaseStudySimulation(stage);
    });
  });

  // Phasen-Filter Pills
  document.querySelectorAll('#phaseFilterTabs .filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#phaseFilterTabs .filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeFilter = pill.getAttribute('data-filter');
      renderStockList();
    });
  });

  // Region-Filter Chips
  document.querySelectorAll('#regionFilterTabs .reg-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#regionFilterTabs .reg-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeRegion = chip.getAttribute('data-region');
      renderStockList();
    });
  });

  // Suche
  document.getElementById('inputSearchStock').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderStockList();
  });

  // Aktie hinzufügen
  document.getElementById('btnAddSymbol').addEventListener('click', addStockFromInput);
  document.getElementById('inputAddSymbol').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addStockFromInput();
  });

  // Chart Aktionen
  document.getElementById('btnRefreshChart').addEventListener('click', () => {
    if (state.selectedSymbol) loadChartForSymbol(state.selectedSymbol, true);
  });
  document.getElementById('btnFitChart').addEventListener('click', () => {
    state.tvMain?.timeScale().fitContent();
    state.tvRsi?.timeScale().fitContent();
  });

  // Workbench Tabs (Alarme / Aktive Trades / Journal)
  document.querySelectorAll('.wb-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-wbtab');
      document.querySelectorAll('.wb-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.wb-pane').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`wbtab-${target}`).classList.add('active');
    });
  });

  // 5%-Risiko-Rechner Inputs
  ['calcCapital', 'calcRiskPct', 'calcEntryPrice', 'calcLodPrice', 'calcNoiseBuffer', 'calcLeverage', 'calcCertPrice', 'calcCertRatio'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', recalculateSizingFromInputs);
      el.addEventListener('change', recalculateSizingFromInputs);
    }
  });

  document.getElementById('btnOpenTradeFromCalc').addEventListener('click', openActiveTradeFromCalculator);

  // Live Toast Banner
  document.getElementById('btnBannerClose').addEventListener('click', () => {
    document.getElementById('liveAlertBanner').classList.add('hidden');
  });

  // Telegram Quick-Connect Buttons in Topbar & Modal
  document.getElementById('btnQuickDetectChat').addEventListener('click', quickDetectChatFromHeader);
  document.getElementById('btnQuickTestAlert').addEventListener('click', triggerTestAlert);
  document.getElementById('btnTriggerTestAlert').addEventListener('click', triggerTestAlert);
  document.getElementById('btnModalTestAlert').addEventListener('click', triggerTestAlert);

  // Settings Modal
  document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnCancelSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettingsFromModal);
  document.getElementById('btnDetectChatId').addEventListener('click', detectTelegramChatIdInModal);
}

// --- WEBSOCKET & SNAPSHOT ---

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => {
    document.getElementById('wsStatusDot').classList.remove('scanning');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'INITIAL_SNAPSHOT' || data.type === 'SCAN_COMPLETED') {
        applySnapshot(data.snapshot);
      } else if (data.type === 'SCAN_STATUS') {
        const dot = document.getElementById('wsStatusDot');
        if (data.isScanning) {
          dot.classList.add('scanning');
          document.getElementById('scanStatusText').textContent = 'Scanne M10...';
        }
      } else if (data.type === 'LIVE_ALERT') {
        handleIncomingLiveAlert(data.alert);
      } else if (data.type === 'ALERT_DELIVERY_UPDATE') {
        updateAlertDeliveryInHistory(data.alertId, data.delivery);
      } else if (data.type === 'SETTINGS_UPDATED') {
        if (state.snapshot) {
          state.snapshot.settings = data.settings;
          updateTelegramStatusUI();
        }
      }
    } catch (err) {
      console.error('WS Fehler:', err);
    }
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 3000);
  };
}

async function fetchInitialSnapshot() {
  try {
    const res = await fetch('/api/snapshot');
    const snap = await res.json();
    applySnapshot(snap);
  } catch (err) {
    console.error('Snapshot Fehler:', err);
  }
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;

  const stocks = snapshot.stocks || [];
  const loadedCount = stocks.filter((s) => s.price > 0).length;

  const dot = document.getElementById('wsStatusDot');
  if (snapshot.isScanning) {
    dot.classList.add('scanning');
    document.getElementById('scanStatusText').textContent = `Scanne (${loadedCount}/${stocks.length})...`;
  } else {
    dot.classList.remove('scanning');
    const t = snapshot.lastScanAt
      ? new Date(snapshot.lastScanAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'Bereit';
    document.getElementById('scanStatusText').textContent = `${loadedCount}/${stocks.length} Live · ${t}`;
  }

  updateTelegramStatusUI();
  renderIndexRegimes();
  renderStockList();
  renderActiveTradesAndJournal();
  renderAlertsHistory();

  if (!state.selectedSymbol && stocks.length > 0) {
    state.selectedSymbol = stocks[0].symbol;
  }

  if (state.selectedSymbol) {
    const rec = stocks.find((s) => s.symbol === state.selectedSymbol);
    if (rec) {
      state.chartRecord = rec;
      renderSelectedStockDetails(rec);
    }
    if (state.chartBars.length === 0) {
      loadChartForSymbol(state.selectedSymbol, false);
    }
  }
}

function updateTelegramStatusUI() {
  const s = state.snapshot?.settings || {};
  const bar = document.getElementById('tgConnectBar');
  const dot = document.getElementById('tgStatusDot');
  const title = document.getElementById('tgBotTitle');
  const sub = document.getElementById('tgBotSub');
  const openBtn = document.getElementById('btnOpenTelegramBot');

  if (s.telegramBotToken && s.telegramChatId) {
    bar.classList.add('connected');
    dot.classList.add('connected');
    title.textContent = `@PureSiteTrading_bot · Verbunden (ID: ${s.telegramChatId})`;
    sub.textContent = 'Echtzeit-Alarme werden synchron an Web & Telegram gesendet';
    openBtn.textContent = '📲 Telegram öffnen';
  } else {
    bar.classList.remove('connected');
    dot.classList.remove('connected');
    title.textContent = '@PureSiteTrading_bot (API-Key hinterlegt)';
    sub.textContent = 'Klicke auf „1. Bot in Telegram öffnen (/start)“ & danach auf „2. Chat-ID koppeln“';
    openBtn.textContent = '📲 1. Bot in Telegram öffnen (/start)';
  }
}

async function quickDetectChatFromHeader() {
  const btn = document.getElementById('btnQuickDetectChat');
  const orig = btn.textContent;
  btn.textContent = '⏳ Prüfe...';
  try {
    const res = await fetch('/api/telegram/detect-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.found) {
      if (state.snapshot?.settings) {
        state.snapshot.settings.telegramChatId = data.chatId;
      }
      updateTelegramStatusUI();
      btn.textContent = `✅ Gekoppelt (${data.chatId})`;
      // Direkt Begrüßungs-/Test-Alarm schicken
      await triggerTestAlert();
    } else {
      btn.textContent = '⚠️ Erst /start im Bot klicken!';
      window.open('https://t.me/PureSiteTrading_bot?start=connect', '_blank');
    }
  } catch {
    btn.textContent = '❌ Fehler';
  } finally {
    setTimeout(() => {
      btn.textContent = orig;
    }, 3500);
  }
}

// --- LEITINDIZES REGIME RIBBON ---

function renderIndexRegimes() {
  const container = document.getElementById('indexRegimeItems');
  const regimes = state.snapshot?.indexRegimes || {};
  const entries = Object.values(regimes);

  if (entries.length === 0) {
    container.innerHTML = `<span class="sub-counter">Leitindizes werden synchronisiert...</span>`;
    return;
  }

  container.innerHTML = entries
    .map((r) => {
      const chg = Number(r.changePct || 0);
      const sign = chg >= 0 ? '+' : '';
      const cls = r.isFallingHard ? 'warn' : 'ok';
      const color = chg >= 0 ? '#34d399' : '#f87171';
      return `<div class="regime-pill ${cls}" title="${escapeHtml(r.summary)}">
        <strong>${escapeHtml(r.name)}</strong>
        <span class="idx-val" style="color:${color}">${sign}${chg.toFixed(2)}%</span>
      </div>`;
    })
    .join('');
}

// --- SIDEBAR: AKTIEN-LISTE (ALLE 51 QUALITÄTSAKTIEN) ---

function renderStockList() {
  const container = document.getElementById('stockListContainer');
  const stocks = state.snapshot?.stocks || [];
  const withPrice = stocks.filter((s) => s.price > 0).length;

  document.getElementById('universeCountLabel').textContent = `${withPrice} / ${stocks.length} Qualitätsaktien mit Live-Kurs`;

  // Zähler für Filter-Pills aktualisieren
  const p4Cnt = stocks.filter((s) => s.analysis?.phase === 4).length;
  const p3Cnt = stocks.filter((s) => s.analysis?.phase === 3).length;
  const p2Cnt = stocks.filter((s) => s.analysis?.phase === 2).length;
  const dipCnt = stocks.filter((s) => s.intradayChangePct <= -2.0 || s.dipFromSwingHighPct <= -3.8).length;

  document.getElementById('cntAll').textContent = `(${stocks.length})`;
  document.getElementById('cntP4').textContent = p4Cnt ? `(${p4Cnt})` : '';
  document.getElementById('cntP3').textContent = p3Cnt ? `(${p3Cnt})` : '';
  document.getElementById('cntP2').textContent = p2Cnt ? `(${p2Cnt})` : '';
  document.getElementById('cntDips').textContent = dipCnt ? `(${dipCnt})` : '';

  const filtered = stocks.filter((s) => {
    const phase = s.analysis?.phase ?? 0;
    if (state.activeFilter === 'phase4' && phase !== 4) return false;
    if (state.activeFilter === 'phase3' && phase !== 3) return false;
    if (state.activeFilter === 'phase2' && phase !== 2) return false;
    if (state.activeFilter === 'dips' && s.intradayChangePct > -2.0 && s.dipFromSwingHighPct > -3.8) return false;

    if (state.activeRegion === 'DAX' && !['DAX', 'MDAX'].includes(s.index)) return false;
    if (state.activeRegion === 'ATX' && !['ATX', 'SMI', 'EUROSTOXX'].includes(s.index)) return false;
    if (state.activeRegion === 'US' && s.region !== 'US') return false;

    if (state.searchQuery) {
      const hay = `${s.symbol} ${s.name} ${s.indexName} ${s.sector}`.toLowerCase();
      if (!hay.includes(state.searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:24px 14px;text-align:center;color:#64748b;font-size:12px;">
      Keine Aktie in diesem Filter.<br/><br/>
      Klicke oben rechts auf <b>„⚡ Playbook-Fallstudie (Kap. 08)“</b>, um ein komplettes Phase-4-Setup live zu simulieren!
    </div>`;
    return;
  }

  container.innerHTML = filtered
    .map((s) => {
      const p = s.analysis?.phase ?? 0;
      const isSelected = s.symbol === state.selectedSymbol;
      const tagClass = p === 4 ? 'p4' : p === 3 ? 'p3' : p === 2 ? 'p2' : p === 1 ? 'p1' : 'p0';
      const cardPhase = p >= 2 ? `phase-${p}` : '';
      const chg = Number(s.intradayChangePct || 0);
      const chgCls = chg >= 0 ? 'pos' : 'neg';
      const conf = s.analysis?.confluenceCount || 0;
      const lod = s.analysis?.lodPrice ? s.analysis.lodPrice.toFixed(2) : '--';
      const pe = s.fundamentals?.peValue ? `KGV ${s.fundamentals.peValue}x` : '';

      const dotsHtml = [0, 1, 2, 3]
        .map((i) => `<span class="conf-dot ${i < conf ? 'on' : ''}"></span>`)
        .join('');

      return `<div class="stock-card ${cardPhase} ${isSelected ? 'selected' : ''}" data-symbol="${escapeHtml(s.symbol)}">
        <div class="sc-top">
          <div class="sc-ident">
            <div class="sc-sym-row">
              <span class="sc-sym">${escapeHtml(s.symbol)}</span>
              <span class="sc-idx">${escapeHtml(s.indexName)}</span>
            </div>
            <span class="sc-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
          </div>
          <div class="sc-price-col">
            <div class="sc-price">${Number(s.price || 0).toFixed(2)} ${escapeHtml(s.currency)}</div>
            <div class="sc-chg ${chgCls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% <span style="color:#64748b;font-weight:400">(${Number(s.dipFromSwingHighPct || 0).toFixed(1)}% 20T)</span></div>
          </div>
        </div>
        <div class="sc-bottom">
          <span class="phase-tag ${tagClass}">${escapeHtml(s.analysis?.phaseBadge || 'NEUTRAL')}</span>
          <div class="sc-meta">
            <span>LoD ${lod}</span>
            ${pe ? `<span>· ${pe}</span>` : ''}
            <span class="conf-dots" title="${conf}/4 Konfluenz-Signale">${dotsHtml}</span>
          </div>
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.stock-card').forEach((el) => {
    el.addEventListener('click', () => {
      const sym = el.getAttribute('data-symbol');
      state.selectedSymbol = sym;
      renderStockList();
      loadChartForSymbol(sym, false);
    });
  });
}

// --- MAIN STAGE: HERO DETAILS, 4-PHASEN-STEPPER & M10 CHART ---

async function loadChartForSymbol(symbol, forceRefresh = false) {
  try {
    const res = await fetch(`/api/chart/${encodeURIComponent(symbol)}${forceRefresh ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (data.record) {
      state.chartRecord = data.record;
      renderSelectedStockDetails(data.record);
      syncCalculatorWithRecord(data.record);
    }
    if (Array.isArray(data.m10Bars)) {
      state.chartBars = data.m10Bars;
      updateTradingViewChartData();
    }
  } catch (err) {
    console.error('Chart-Ladefehler:', err);
  }
}

function renderSelectedStockDetails(rec) {
  if (!rec) return;
  const cur = rec.currency || 'EUR';
  document.getElementById('detailStockName').textContent = rec.name;
  document.getElementById('detailStockSymbol').textContent = rec.symbol;
  document.getElementById('detailStockIndex').textContent = `${rec.indexName} · ${rec.sector}`;

  const mhEl = document.getElementById('detailMarketHours');
  mhEl.textContent = rec.marketClock?.reason || 'Handelszeit';
  mhEl.className = `mkt-badge ${rec.marketClock?.isOpen ? 'open' : 'closed'}`;

  const f = rec.fundamentals || {};
  document.getElementById('detailFundamentalSummary').innerHTML =
    `<b>Bewertung:</b> ${escapeHtml(f.peReason || '-')} &nbsp;·&nbsp; <b>Dip-Analyse:</b> ${escapeHtml(f.dipReason || '-')} &nbsp;·&nbsp; <b>Schutzfilter:</b> ${escapeHtml(f.earningsNote || '-')}`;

  document.getElementById('detailCurrentPrice').textContent = `${Number(rec.price || 0).toFixed(2)} ${cur}`;

  const chgEl = document.getElementById('detailIntradayChange');
  const chg = Number(rec.intradayChangePct || 0);
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% heute`;
  chgEl.className = `delta-pill ${chg >= 0 ? 'pos' : 'neg'}`;

  const swingEl = document.getElementById('detailSwingDip');
  const sw = Number(rec.dipFromSwingHighPct || 0);
  swingEl.textContent = `${sw.toFixed(1)}% v. 20T-Hoch`;

  // Hero Mini-KPIs
  const a = rec.analysis || {};
  const s = rec.sizing || {};
  document.getElementById('heroKpiLod').textContent = a.lodPrice ? `${a.lodPrice.toFixed(2)} ${cur}` : '--';
  document.getElementById('heroKpiSl').textContent = s.stopLossStock ? `${s.stopLossStock.toFixed(2)} ${cur}` : '--';
  document.getElementById('heroKpiLev').textContent = `${s.activeLeverage || 8}x`;
  document.getElementById('heroKpiBuy').textContent = s.positionSizeEuro ? `${s.positionSizeEuro.toFixed(0)} €` : '--';

  // 4-Phasen-Stepper
  const phase = a.phase ?? 0;
  document.querySelectorAll('#phaseStepper .pipe-step').forEach((stepEl) => {
    const sNum = Number(stepEl.getAttribute('data-step'));
    stepEl.className = 'pipe-step';
    if (phase > sNum) {
      stepEl.classList.add('passed');
    } else if (phase === sNum) {
      stepEl.classList.add(`current-${sNum}`);
    }
  });

  const actionBox = document.getElementById('phaseActionBox');
  actionBox.innerHTML = `<strong>${escapeHtml(a.phaseName || '')}:</strong> ${escapeHtml(a.actionText || '')}`;
  actionBox.style.borderLeftColor =
    phase === 4 ? '#10b981' : phase === 3 ? '#f59e0b' : phase === 2 ? '#38bdf8' : phase === 1 ? '#ef4444' : '#64748b';

  // Chart-Legende
  document.getElementById('legEma20').textContent = a.ema20 ? a.ema20.toFixed(2) : '--';
  document.getElementById('legVwap').textContent = a.vwap ? a.vwap.toFixed(2) : '--';
  document.getElementById('legLod').textContent = a.lodPrice ? `${a.lodPrice.toFixed(2)} ${cur}` : '--';
  document.getElementById('legSl').textContent = s.stopLossStock ? `${s.stopLossStock.toFixed(2)} ${cur}` : '--';
  document.getElementById('legRsi').textContent = a.rsi14 ? a.rsi14.toFixed(1) : '--';

  // 4 Konfluenz-Signale
  const confSignals = a.confluenceSignals || [];
  const confCount = a.confluenceCount || 0;
  const confBadge = document.getElementById('confluenceScoreBadge');
  confBadge.textContent = `${confCount} / 4 Konfluenz`;
  confBadge.style.color = confCount >= 2 ? '#34d399' : '#94a3b8';

  document.getElementById('confluenceList').innerHTML = confSignals
    .map((c) => {
      return `<div class="conf-box ${c.active ? 'active' : ''}">
        <span>${c.active ? '✅' : '⚪'}</span>
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.detail || '')}</span>
        </div>
      </div>`;
    })
    .join('');

  // 9-Punkte Pre-Trade-Checkliste
  const checklist = rec.checklist || [];
  const passedCount = checklist.filter((c) => c.passed).length;
  const chkBadge = document.getElementById('checklistScoreBadge');
  chkBadge.textContent = `${passedCount} / ${checklist.length || 9} erfüllt`;
  chkBadge.style.color = passedCount >= 8 ? '#34d399' : '#fbbf24';

  document.getElementById('preTradeChecklist').innerHTML = checklist
    .map((item) => {
      return `<div class="chk-row ${item.passed ? 'passed' : ''}">
        <span>${item.passed ? '☑️' : '⬜'}</span>
        <div>
          <strong>${escapeHtml(item.nr)}. ${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail || item.requirement)}</span>
        </div>
      </div>`;
    })
    .join('');
}

// --- 5%-RISIKO & DERIVATE-RECHNER (HEBEL 5x-10x) ---

function syncCalculatorWithRecord(rec) {
  if (!rec || !rec.sizing) return;
  const s = rec.sizing;
  document.getElementById('calcCapital').value = s.accountCapital;
  document.getElementById('calcRiskPct').value = s.maxRiskPct;
  document.getElementById('calcEntryPrice').value = s.entryPrice;
  document.getElementById('calcLodPrice').value = s.lodPrice;
  document.getElementById('calcNoiseBuffer').value = s.noiseBufferPct;
  renderSizingOutput(s, rec.currency || '€');
}

async function recalculateSizingFromInputs() {
  const entryPrice = Number(document.getElementById('calcEntryPrice').value);
  const lodPrice = Number(document.getElementById('calcLodPrice').value);
  const accountCapital = Number(document.getElementById('calcCapital').value);
  const maxRiskPct = Number(document.getElementById('calcRiskPct').value);
  const noiseBufferPct = Number(document.getElementById('calcNoiseBuffer').value);
  const levVal = document.getElementById('calcLeverage').value;
  const certPriceVal = Number(document.getElementById('calcCertPrice').value);
  const certRatio = Number(document.getElementById('calcCertRatio').value);

  if (!entryPrice || !lodPrice || entryPrice <= lodPrice) return;

  try {
    const res = await fetch('/api/calculate-sizing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entryPrice,
        lodPrice,
        accountCapital,
        maxRiskPct,
        noiseBufferPct,
        stockProfile: state.chartRecord?.profile || 'conservative',
        customLeverage: levVal === 'auto' ? null : Number(levVal),
        customCertPrice: certPriceVal > 0 ? certPriceVal : null,
        certRatio
      })
    });
    const data = await res.json();
    if (data.sizing) {
      if (state.chartRecord) state.chartRecord.sizing = data.sizing;
      renderSizingOutput(data.sizing, state.chartRecord?.currency || '€');
      updateTradingViewChartData();
    }
  } catch (err) {
    console.error('Rechenfehler:', err);
  }
}

function renderSizingOutput(sizing, cur = '€') {
  if (!sizing) return;
  document.getElementById('heroKpiSl').textContent = `${sizing.stopLossStock.toFixed(2)} ${cur}`;
  document.getElementById('heroKpiLev').textContent = `${sizing.activeLeverage}x`;
  document.getElementById('heroKpiBuy').textContent = `${sizing.positionSizeEuro.toFixed(0)} €`;

  const box = document.getElementById('calcResultsBox');
  box.innerHTML = `
    <div class="calc-row">
      <span>1. Max. erlaubter Verlust (R_max = ${sizing.maxRiskPct}%):</span>
      <strong class="text-red">-${sizing.rMaxEuro.toFixed(2)} €</strong>
    </div>
    <div class="calc-row">
      <span>2. Struktureller Stop-Loss Aktie (LoD - ${sizing.noiseBufferPct}%):</span>
      <strong>${sizing.stopLossStock.toFixed(2)} ${cur} (-${sizing.stopDistanceStockPct.toFixed(2)}%)</strong>
    </div>
    <div class="calc-row">
      <span>3. Kalibrierter Hebel &amp; Risiko im Derivat:</span>
      <strong class="text-cyan">Hebel ${sizing.activeLeverage}x → -${sizing.dDerivatPct.toFixed(2)}% bis SL</strong>
    </div>
    <div class="calc-row">
      <span>4. Max. erlaubte K.O.-Barriere (Kap. 4.3):</span>
      <strong>&lt; ${sizing.maxAllowedKoBarrier.toFixed(2)} ${cur} (Strike ~${sizing.impliedStrike.toFixed(2)})</strong>
    </div>
    <div class="calc-buy-banner">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>📌 <b>Kaufbetrag Derivat (P_Kauf):</b></span>
        <strong style="font-family:var(--font-mono);font-size:15px;color:#34d399">${sizing.positionSizeEuro.toFixed(0)} € (${sizing.accountAllocationPct.toFixed(1)}% Konto)</strong>
      </div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">
        Order: <b>${sizing.quantityPieces} Stück</b> à ${sizing.modelCertEntryPrice.toFixed(2)} € →
        <b>Stop-Loss im Derivat direkt bei ${sizing.modelCertStopPrice.toFixed(2)} €</b> eintragen
      </div>
    </div>
  `;

  const tbody = document.getElementById('calcMatrixBody');
  tbody.innerHTML = (sizing.matrix || [])
    .map((row) => {
      return `<tr class="${row.isRecommended ? 'rec-row' : ''}">
        <td>${row.leverage}x ${row.isRecommended ? '★' : ''}</td>
        <td>-${row.stopDerivatPct.toFixed(1)}%</td>
        <td>${row.accountSharePct.toFixed(1)}%</td>
        <td>${row.buyAmountEuro.toFixed(0)} €</td>
        <td>${row.stopAmountEuro.toFixed(0)} € (-${row.maxLossEuro.toFixed(0)} €)</td>
      </tr>`;
    })
    .join('');
}

// --- AKTIVE TRADES & JOURNAL ---

async function openActiveTradeFromCalculator() {
  const symbol = state.selectedSymbol || 'SY1.DE';
  const entryPrice = Number(document.getElementById('calcEntryPrice').value);
  const lodPrice = Number(document.getElementById('calcLodPrice').value);
  const s = state.chartRecord?.sizing;

  const res = await fetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      name: state.chartRecord?.name || symbol,
      currency: state.chartRecord?.currency || 'EUR',
      entryPrice,
      lodPrice,
      stopLossStock: s?.stopLossStock || lodPrice * 0.998,
      leverage: s?.activeLeverage || 8,
      positionSizeEuro: s?.positionSizeEuro || 2500
    })
  });
  const data = await res.json();
  if (data.snapshot) {
    applySnapshot(data.snapshot);
    document.querySelector('.wb-tab[data-wbtab="trades"]').click();
  }
}

function renderActiveTradesAndJournal() {
  const trades = state.snapshot?.activeTrades || [];
  const journal = state.snapshot?.journal || [];
  document.getElementById('activeTradesCount').textContent = trades.length;

  const tradesContainer = document.getElementById('activeTradesList');
  if (trades.length === 0) {
    tradesContainer.innerHTML = `<div style="padding:18px;text-align:center;color:#64748b;font-size:12px;">Keine offenen Trades in der 3-Stufen-Überwachung.</div>`;
  } else {
    tradesContainer.innerHTML = trades
      .map((t) => {
        const ev = t.latestEvaluation || {};
        const pnlEuro = Number(ev.pnlEuro || 0);
        const derivPct = Number(ev.derivGainPct || 0);
        const rMult = Number(ev.rMultiple || 0);
        const pnlColor = pnlEuro >= 0 ? '#34d399' : '#f87171';

        return `<div class="trade-item">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${escapeHtml(t.name)} (${escapeHtml(t.symbol)}) · ${t.leverage}x</strong>
            <strong style="font-family:var(--font-mono);color:${pnlColor}">${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} € (${derivPct >= 0 ? '+' : ''}${derivPct.toFixed(1)}% | ${rMult.toFixed(2)}R)</strong>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;font-family:var(--font-mono);">
            Entry: ${t.entryPrice.toFixed(2)} · Aktuell: ${(ev.currentPrice || t.entryPrice).toFixed(2)} · Empf. SL: <b>${(ev.recommendedStopStock || t.stopLossStock).toFixed(2)}</b>
          </div>
          <div style="margin-top:6px;padding:6px 8px;background:#070b14;border-radius:6px;font-size:11px;">
            <b>${escapeHtml(ev.stageName || 'Stufe 1: Initial Risk')}:</b> ${escapeHtml(ev.recommendation || 'Stop unter LoD belassen.')}
          </div>
          <div style="margin-top:8px;display:flex;justify-content:flex-end;">
            <button class="btn btn-xs btn-secondary btn-close-trade" data-id="${escapeHtml(t.id)}">
              🏁 Glattstellen &amp; ins Journal buchen
            </button>
          </div>
        </div>`;
      })
      .join('');

    tradesContainer.querySelectorAll('.btn-close-trade').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const res = await fetch(`/api/trades/${encodeURIComponent(id)}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      });
    });
  }

  const journalContainer = document.getElementById('journalList');
  if (journal.length === 0) {
    journalContainer.innerHTML = `<div style="padding:18px;text-align:center;color:#64748b;font-size:12px;">Noch keine abgeschlossenen Trades im Journal.</div>`;
  } else {
    journalContainer.innerHTML = journal
      .slice(0, 20)
      .map((j) => {
        const win = j.pnlEuro >= 0;
        return `<div class="journal-item">
          <div style="display:flex;justify-content:space-between;">
            <strong>${escapeHtml(j.name)} (${escapeHtml(j.symbol)}) · ${j.leverage}x</strong>
            <strong style="font-family:var(--font-mono);color:${win ? '#34d399' : '#f87171'}">${win ? '+' : ''}${j.pnlEuro.toFixed(0)} € (${win ? '+' : ''}${j.rMultiple.toFixed(2)}R)</strong>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;font-family:var(--font-mono);">
            Entry ${j.entryPrice} → Exit ${j.exitPrice} (${j.stockGainPct >= 0 ? '+' : ''}${j.stockGainPct}% Aktie | ${j.derivGainPct >= 0 ? '+' : ''}${j.derivGainPct}% Derivat)
          </div>
        </div>`;
      })
      .join('');
  }
}

// --- ECHTZEIT-BENACHRICHTIGUNGEN (SYNCHRON WEB + TELEGRAM) ---

function handleIncomingLiveAlert(alert) {
  if (!alert) return;

  if (state.snapshot) {
    state.snapshot.alerts = [
      alert,
      ...(state.snapshot.alerts || []).filter((a) => a.id !== alert.id)
    ];
    renderAlertsHistory();
  }

  const banner = document.getElementById('liveAlertBanner');
  document.getElementById('bannerBadge').textContent = alert.phaseBadge || `PHASE ${alert.phase || 4}`;
  document.getElementById('bannerTitle').textContent = alert.title;
  document.getElementById('bannerSub').textContent = alert.message;
  document.getElementById('bannerDelivery').textContent = alert.delivery?.telegram?.ok
    ? '✅ Web + @PureSiteTrading_bot gleichzeitig zugestellt'
    : '🔔 Web-Dashboard Live-Alarm';

  document.getElementById('btnBannerView').onclick = () => {
    if (alert.symbol) {
      state.selectedSymbol = alert.symbol;
      loadChartForSymbol(alert.symbol, false);
    }
  };
  banner.classList.remove('hidden');

  const settings = state.snapshot?.settings || {};
  if (settings.soundAlertsEnabled !== false) {
    playAlertChime(alert.phase || 4);
  }

  if (settings.browserNotificationsEnabled !== false && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(alert.title, { body: alert.message });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(alert.title, { body: alert.message });
      });
    }
  }
}

function updateAlertDeliveryInHistory(alertId, delivery) {
  if (!state.snapshot?.alerts) return;
  const item = state.snapshot.alerts.find((a) => a.id === alertId);
  if (item) {
    item.delivery = delivery;
    renderAlertsHistory();
  }
  if (delivery?.telegram?.ok) {
    document.getElementById('bannerDelivery').textContent =
      '✅ Web + @PureSiteTrading_bot gleichzeitig zugestellt!';
  }
}

function renderAlertsHistory() {
  const list = state.snapshot?.alerts || [];
  document.getElementById('alertsCount').textContent = list.length;
  const container = document.getElementById('alertsHistoryList');

  if (list.length === 0) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b;font-size:12px;">
      Noch keine Alarme ausgelöst.<br/>
      Klicke oben rechts auf <b>„⚡ Playbook-Fallstudie (Kap. 08)“</b> oder <b>„🚀 Test-Alarm“</b>!
    </div>`;
    return;
  }

  container.innerHTML = list
    .map((a) => {
      const timeStr = new Date(a.timestamp).toLocaleTimeString('de-DE');
      const tgOk = a.delivery?.telegram?.ok;
      const tgStatus = tgOk
        ? `<span class="text-cyan">📲 Telegram ✓</span>`
        : `<span style="color:#fbbf24">📲 Telegram: Bitte /start im Bot klicken</span>`;

      return `<div class="alert-item" style="cursor:pointer" data-symbol="${escapeHtml(a.symbol || '')}">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;margin-bottom:4px;">
          <span class="phase-tag p${a.phase || 4}">${escapeHtml(a.phaseBadge || 'SIGNAL')}</span>
          <span style="font-family:var(--font-mono);color:#94a3b8">${timeStr} · 🖥️ Web ✓ · ${tgStatus}</span>
        </div>
        <strong style="display:block;font-size:12px;margin-bottom:3px;">${escapeHtml(a.title)}</strong>
        <p style="font-size:11px;color:#cbd5e1;">${escapeHtml(a.message)}</p>
        ${
          a.sizing
            ? `<div style="margin-top:6px;padding:5px 8px;background:#070b14;border-radius:5px;font-family:var(--font-mono);font-size:10.5px;color:#34d399;">
                SL: ${a.sizing.stopLossStock.toFixed(2)} · Hebel ${a.sizing.activeLeverage}x · Kauf: <b>${a.sizing.positionSizeEuro.toFixed(0)} €</b> (Risiko: -${a.sizing.rMaxEuro.toFixed(0)} €)
              </div>`
            : ''
        }
      </div>`;
    })
    .join('');

  container.querySelectorAll('.alert-item').forEach((card) => {
    card.addEventListener('click', () => {
      const sym = card.getAttribute('data-symbol');
      if (sym) {
        state.selectedSymbol = sym;
        loadChartForSymbol(sym, false);
      }
    });
  });
}

function playAlertChime(phase = 4) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = phase === 4 ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37, 659.25];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.14, ctx.currentTime + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.11 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.11);
      osc.stop(ctx.currentTime + i * 0.11 + 0.3);
    });
  } catch {
    // Ignoriere falls Audio vor erster Interaktion
  }
}

// --- SIMULATION & WATCHLIST ---

async function runCaseStudySimulation(stage = 'phase4_entry') {
  try {
    const res = await fetch('/api/simulate-case-study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage })
    });
    const data = await res.json();
    if (data.ok) {
      state.selectedSymbol = 'SY1.DE';
      await loadChartForSymbol('SY1.DE', false);
    }
  } catch (err) {
    console.error('Simulations-Fehler:', err);
  }
}

async function addStockFromInput() {
  const input = document.getElementById('inputAddSymbol');
  const symbol = input.value.trim().toUpperCase();
  if (!symbol) return;
  input.value = '';
  const res = await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol })
  });
  const data = await res.json();
  if (data.snapshot) {
    state.selectedSymbol = symbol;
    applySnapshot(data.snapshot);
    loadChartForSymbol(symbol, false);
  }
}

// --- SETTINGS MODAL ---

function openSettingsModal() {
  const s = state.snapshot?.settings || {};
  document.getElementById('setTelegramToken').value =
    s.telegramBotToken || '8545580896:AAH_cLbkPJMpfnhjdo5t5bhh5dde38EWE6I';
  document.getElementById('setTelegramChatId').value = s.telegramChatId || '';
  document.getElementById('setTelegramEnabled').checked = s.telegramEnabled !== false;
  document.getElementById('setAccountCapital').value = s.accountCapital || 10000;
  document.getElementById('setMaxRiskPct').value = s.maxRiskPct || 5.0;
  document.getElementById('setNoiseBufferPct').value = s.noiseBufferPct ?? 0.20;
  document.getElementById('setMinAlertPhase').value = String(s.minAlertPhase ?? 2);
  document.getElementById('setScanIntervalSec').value = s.scanIntervalSec || 60;
  document.getElementById('setMinDipPct').value = s.minDipPct ?? -2.0;
  document.getElementById('setSoundAlerts').checked = s.soundAlertsEnabled !== false;
  document.getElementById('setBrowserNotifications').checked = s.browserNotificationsEnabled !== false;

  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

async function saveSettingsFromModal() {
  const payload = {
    telegramBotToken: document.getElementById('setTelegramToken').value.trim(),
    telegramChatId: document.getElementById('setTelegramChatId').value.trim(),
    telegramEnabled: document.getElementById('setTelegramEnabled').checked,
    accountCapital: Number(document.getElementById('setAccountCapital').value || 10000),
    maxRiskPct: Number(document.getElementById('setMaxRiskPct').value || 5.0),
    noiseBufferPct: Number(document.getElementById('setNoiseBufferPct').value || 0.20),
    minAlertPhase: Number(document.getElementById('setMinAlertPhase').value || 2),
    scanIntervalSec: Number(document.getElementById('setScanIntervalSec').value || 60),
    minDipPct: Number(document.getElementById('setMinDipPct').value || -2.0),
    soundAlertsEnabled: document.getElementById('setSoundAlerts').checked,
    browserNotificationsEnabled: document.getElementById('setBrowserNotifications').checked
  };

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok && state.snapshot) {
    state.snapshot.settings = data.settings;
    updateTelegramStatusUI();
    closeSettingsModal();
    recalculateSizingFromInputs();
  }
}

async function detectTelegramChatIdInModal() {
  const token = document.getElementById('setTelegramToken').value.trim();
  const fb = document.getElementById('telegramDetectFeedback');
  fb.classList.remove('hidden');
  fb.textContent = '🔍 Suche nach deiner Nachricht an @PureSiteTrading_bot...';

  try {
    const res = await fetch('/api/telegram/detect-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramBotToken: token })
    });
    const data = await res.json();
    if (data.found) {
      document.getElementById('setTelegramChatId').value = data.chatId;
      fb.style.borderColor = '#10b981';
      fb.innerHTML = `✅ <b>Chat-ID erkannt:</b> <code>${escapeHtml(data.chatId)}</code> (${escapeHtml(data.chatTitle)}) – ab sofort gekoppelt!`;
      if (state.snapshot?.settings) {
        state.snapshot.settings.telegramBotToken = token;
        state.snapshot.settings.telegramChatId = data.chatId;
        updateTelegramStatusUI();
      }
    } else {
      fb.style.borderColor = '#f59e0b';
      fb.innerHTML = `⚠️ Noch keine Nachricht gefunden. Bitte klicke auf <a href="https://t.me/PureSiteTrading_bot?start=connect" target="_blank" style="color:#38bdf8;font-weight:700">@PureSiteTrading_bot öffnen</a> und drücke dort auf <b>Starten</b>!`;
    }
  } catch (err) {
    fb.style.borderColor = '#ef4444';
    fb.textContent = `❌ Fehler: ${err.message}`;
  }
}

async function triggerTestAlert() {
  const token = document.getElementById('setTelegramToken')?.value?.trim();
  const chatId = document.getElementById('setTelegramChatId')?.value?.trim();
  const fb = document.getElementById('telegramDetectFeedback');

  const res = await fetch('/api/telegram/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegramBotToken: token || undefined,
      telegramChatId: chatId || undefined
    })
  });
  const data = await res.json();
  if (fb && !document.getElementById('settingsModal').classList.contains('hidden')) {
    fb.classList.remove('hidden');
    const tg = data.alert?.delivery?.telegram;
    if (tg?.ok) {
      fb.style.borderColor = '#10b981';
      fb.innerHTML = `✅ <b>Test-Alarm gleichzeitig an Web-Dashboard UND @PureSiteTrading_bot (Chat ${escapeHtml(tg.chatId)}) gesendet!</b>`;
    } else {
      fb.style.borderColor = '#f59e0b';
      fb.innerHTML = `🔔 <b>Web-Dashboard-Alarm ausgelöst!</b> Für Telegram: Klicke erst auf <a href="https://t.me/PureSiteTrading_bot?start=connect" target="_blank" style="color:#38bdf8;font-weight:700">@PureSiteTrading_bot öffnen</a> und sende <code>/start</code>.`;
    }
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
