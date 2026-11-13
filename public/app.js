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

  // Zeichne Kerzen-Marker für Tagestief (LoD) und Phase-4-Kaufsignal (Lead) direkt in den Chart
  const markers = [];
  if (candles.length > 0) {
    let minBar = candles[0];
    for (const c of candles.slice(-45)) {
      if (c.low <= minBar.low) minBar = c;
    }
    if (minBar) {
      markers.push({
        time: minBar.time,
        position: 'belowBar',
        color: '#f59e0b',
        shape: 'arrowUp',
        text: `LoD ${minBar.low.toFixed(2)} €`
      });
    }
    const rec = state.chartRecord;
    if (rec?.analysis?.phase === 4 && candles.length > 1) {
      const lastBar = candles[candles.length - 1];
      if (lastBar.time !== minBar?.time) {
        markers.push({
          time: lastBar.time,
          position: 'belowBar',
          color: '#10b981',
          shape: 'arrowUp',
          text: `BUY LEAD ${lastBar.close.toFixed(2)} €`
        });
      }
    }
  }
  markers.sort((a, b) => a.time - b.time);
  state.candleSeries.setMarkers(markers);

  // Entferne alte Preislinien (LoD & Stop-Loss) und zeichne aktuelle in € ein
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
      title: `Tagestief (LoD) ${lodPrice.toFixed(2)} €`
    });
  }

  if (slPrice && slPrice > 0) {
    state.slPriceLine = state.candleSeries.createPriceLine({
      price: Number(slPrice),
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: LWC.LineStyle.Dotted,
      axisLabelVisible: true,
      title: `Stop-Loss ${slPrice.toFixed(2)} €`
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
    btn.textContent = '⏳ Scanne 196...';
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const snap = await res.json();
      applySnapshot(snap);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Komplett-Scan';
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

  // Index-Filter Chips (alle 7 Leitindizes)
  document.querySelectorAll('#regionFilterTabs .reg-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#regionFilterTabs .reg-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeRegion = chip.getAttribute('data-region');
      renderStockList();
    });
  });

  // Suche & Sortierung
  document.getElementById('inputSearchStock').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderStockList();
  });

  const sortSelect = document.getElementById('selectSortStocks');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderStockList();
    });
  }

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

  // Demo-Account Steuerung (Auto-Trade Schalter, Orderbuch anzeigen, Reset)
  const chkAuto = document.getElementById('chkDemoAutoTrade');
  if (chkAuto) {
    chkAuto.addEventListener('change', async (e) => {
      try {
        const res = await fetch('/api/demo/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoTradeEnabled: e.target.checked })
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      } catch (err) {
        console.error('Demo-Toggle Fehler:', err);
      }
    });
  }

  const btnShowOrders = document.getElementById('btnShowDemoOrders');
  if (btnShowOrders) {
    btnShowOrders.addEventListener('click', () => {
      const openCnt = state.snapshot?.activeTrades?.length || 0;
      const tabKey = openCnt > 0 ? 'trades' : 'journal';
      const tabBtn = document.querySelector(`.wb-tab[data-wbtab="${tabKey}"]`);
      if (tabBtn) tabBtn.click();
      document.getElementById('wbCardTradesAndAlerts')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const btnResetDemo = document.getElementById('btnResetDemoAccount');
  if (btnResetDemo) {
    btnResetDemo.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/demo/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initialBalanceEuro: 10000 })
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      } catch (err) {
        console.error('Demo-Reset Fehler:', err);
      }
    });
  }

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
      } else if (data.type === 'DEMO_ACCOUNT_UPDATED') {
        if (state.snapshot) {
          state.snapshot.demoAccount = data.demoAccount;
          renderDemoAccount();
        }
      } else if (data.type === 'SCAN_STATUS') {
        const dot = document.getElementById('wsStatusDot');
        if (data.isScanning) {
          dot.classList.add('scanning');
          document.getElementById('scanStatusText').textContent = 'Scanne 196 Aktien...';
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
    document.getElementById('scanStatusText').textContent = `${loadedCount}/${stocks.length} Live (€) · ${t}`;
  }

  updateTelegramStatusUI();
  renderDemoAccount();
  renderIndexRegimes();
  renderTopRadarStrip();
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

function renderDemoAccount() {
  const demo = state.snapshot?.demoAccount;
  if (!demo) return;

  const fmtEuro = (val) =>
    `${Number(val || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  const badge = document.getElementById('demoStatusBadge');
  const chk = document.getElementById('chkDemoAutoTrade');
  if (chk) chk.checked = demo.autoTradeEnabled !== false;
  if (badge) {
    if (demo.autoTradeEnabled !== false) {
      badge.textContent = '🤖 AUTO-TRADER AKTIV';
      badge.classList.remove('paused');
    } else {
      badge.textContent = '⏸️ AUTO-TRADER PAUSIERT';
      badge.classList.add('paused');
    }
  }

  const openBadge = document.getElementById('demoOpenCountBadge');
  if (openBadge) openBadge.textContent = demo.openPositionsCount || 0;

  const eqEl = document.getElementById('demoTotalEquity');
  if (eqEl) eqEl.textContent = fmtEuro(demo.totalEquityEuro);

  const retEl = document.getElementById('demoTotalReturn');
  if (retEl) {
    const rEuro = Number(demo.totalReturnEuro || 0);
    const rPct = Number(demo.totalReturnPct || 0);
    const sign = rEuro >= 0 ? '+' : '';
    retEl.textContent = `${sign}${fmtEuro(rEuro)} (${sign}${rPct.toFixed(2)}%) vs. Start`;
    retEl.style.color = rEuro > 0 ? '#34d399' : rEuro < 0 ? '#f87171' : '#94a3b8';
  }

  const cashEl = document.getElementById('demoCashEuro');
  if (cashEl) cashEl.textContent = fmtEuro(demo.cashEuro);

  const initSub = document.getElementById('demoInitialSub');
  if (initSub) initSub.textContent = `Startkapital: ${Number(demo.initialBalanceEuro || 10000).toLocaleString('de-DE')} €`;

  const invEl = document.getElementById('demoInvestedEuro');
  if (invEl) invEl.textContent = fmtEuro(demo.investedEuro);

  const openSub = document.getElementById('demoOpenPositionsSub');
  if (openSub) openSub.textContent = `${demo.openPositionsCount || 0} offene Knock-Out-Trades`;

  const unrEl = document.getElementById('demoUnrealizedPnl');
  if (unrEl) {
    const u = Number(demo.unrealizedPnlEuro || 0);
    unrEl.textContent = `${u >= 0 ? '+' : ''}${fmtEuro(u)}`;
    unrEl.style.color = u > 0 ? '#34d399' : u < 0 ? '#f87171' : '#e2e8f0';
  }

  const realEl = document.getElementById('demoRealizedPnl');
  if (realEl) {
    const r = Number(demo.realizedPnlEuro || 0);
    realEl.textContent = `${r >= 0 ? '+' : ''}${fmtEuro(r)}`;
    realEl.style.color = r > 0 ? '#34d399' : r < 0 ? '#f87171' : '#e2e8f0';
  }

  const closedSub = document.getElementById('demoClosedTradesSub');
  if (closedSub) closedSub.textContent = `${demo.closedTradesCount || 0} abgeschlossene Trades`;

  const wrEl = document.getElementById('demoWinRate');
  if (wrEl) {
    wrEl.textContent = demo.closedTradesCount > 0 ? `${Number(demo.winRatePct || 0).toFixed(1)}%` : '--%';
    wrEl.style.color = demo.winRatePct >= 50 ? '#34d399' : '#e2e8f0';
  }

  const wlSub = document.getElementById('demoWinLossSub');
  if (wlSub) wlSub.textContent = `${demo.wins || 0} Wins · ${demo.losses || 0} Losses`;
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
    title.textContent = `@PureSiteTrading_bot · Verbunden (${s.telegramChatId})`;
    sub.textContent = 'Nur Lead-Entry & Lead-Close Alarme (Kein Phasen-Spam)';
    openBtn.textContent = '📲 Bot öffnen';
  } else {
    bar.classList.remove('connected');
    dot.classList.remove('connected');
    title.textContent = '@PureSiteTrading_bot';
    sub.textContent = 'Klicke auf „Bot öffnen“ & danach auf „Koppeln“';
    openBtn.textContent = '📲 Bot öffnen';
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
      btn.textContent = `✅ ID: ${data.chatId}`;
      await triggerTestAlert();
    } else {
      btn.textContent = '⚠️ Erst /start senden!';
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

// --- TOP MEAN-REVERSION RADAR STRIP (TOP 6 KANDIDATEN AUS 196 AKTIEN) ---

function renderTopRadarStrip() {
  const grid = document.getElementById('topRadarGrid');
  if (!grid) return;
  const stocks = state.snapshot?.stocks || [];
  if (stocks.length === 0) return;

  // Sortiere die 6 spannendsten Setups (höchste Phase >= 2, danach stärkste Tagesverlierer / Swing-Dips)
  const topCandidates = [...stocks]
    .filter((s) => s.price > 0)
    .sort((a, b) => {
      const pa = a.analysis?.phase ?? 0;
      const pb = b.analysis?.phase ?? 0;
      const scoreA = (pa >= 2 ? pa * 10 : 0) + (a.analysis?.confluenceCount || 0) * 2 - (a.intradayChangePct || 0);
      const scoreB = (pb >= 2 ? pb * 10 : 0) + (b.analysis?.confluenceCount || 0) * 2 - (b.intradayChangePct || 0);
      return scoreB - scoreA;
    })
    .slice(0, 6);

  grid.innerHTML = topCandidates
    .map((s) => {
      const p = s.analysis?.phase ?? 0;
      const chg = Number(s.intradayChangePct || 0);
      const chgColor = chg >= 0 ? '#34d399' : '#f87171';
      const isSel = s.symbol === state.selectedSymbol;
      const tagClass = p === 4 ? 'p4' : p === 3 ? 'p3' : p === 2 ? 'p2' : p === 1 ? 'p1' : 'p0';
      const shortBadge = p === 4 ? '🟢 LEAD P4' : p === 3 ? '⚡ P3 BODEN' : p === 2 ? '👁️ P2 LOD' : p === 1 ? '⛔ P1 FALL' : 'NEUTRAL';

      return `<div class="radar-card ${isSel ? 'active' : ''} ${p === 4 ? 'lead-p4' : ''}" data-radar-sym="${escapeHtml(s.symbol)}">
        <div class="rc-row1">
          <span class="rc-sym">${escapeHtml(s.symbol)}</span>
          <span class="rc-price">${Number(s.price).toFixed(2)} €</span>
        </div>
        <div class="rc-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
        <div class="rc-row3">
          <span class="phase-tag ${tagClass}" style="padding:1px 5px;font-size:9.5px">${shortBadge}</span>
          <span style="color:${chgColor};font-weight:700">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
        </div>
      </div>`;
    })
    .join('');

  grid.querySelectorAll('.radar-card').forEach((card) => {
    card.addEventListener('click', () => {
      const sym = card.getAttribute('data-radar-sym');
      state.selectedSymbol = sym;
      renderTopRadarStrip();
      renderStockList();
      loadChartForSymbol(sym, false);
    });
  });
}

// --- SIDEBAR: AKTIEN-LISTE (ALLE 196 QUALITÄTSAKTIEN IN EURO €) ---

function renderStockList() {
  const container = document.getElementById('stockListContainer');
  const stocks = state.snapshot?.stocks || [];
  const withPrice = stocks.filter((s) => s.price > 0).length;

  document.getElementById('universeCountLabel').textContent = `${withPrice} / ${stocks.length} Aktien in Euro (€) aktiv`;

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

    if (state.activeRegion && state.activeRegion !== 'ALL') {
      if (s.index !== state.activeRegion) return false;
    }

    if (state.searchQuery) {
      const hay = `${s.symbol} ${s.name} ${s.indexName} ${s.sector}`.toLowerCase();
      if (!hay.includes(state.searchQuery)) return false;
    }
    return true;
  });

  // Sortierung anwenden
  const sortMode = state.sortBy || 'phase';
  filtered.sort((a, b) => {
    if (sortMode === 'intraday') {
      return (a.intradayChangePct || 0) - (b.intradayChangePct || 0);
    }
    if (sortMode === 'swing') {
      return (a.dipFromSwingHighPct || 0) - (b.dipFromSwingHighPct || 0);
    }
    if (sortMode === 'pe') {
      const peA = a.fundamentals?.peValue > 0 ? a.fundamentals.peValue : 999;
      const peB = b.fundamentals?.peValue > 0 ? b.fundamentals.peValue : 999;
      return peA - peB;
    }
    if (sortMode === 'name') {
      return String(a.name).localeCompare(String(b.name), 'de');
    }
    // Standard: Setup-Phase & Konfluenz, danach stärkster Tagesverlust
    const pa = a.analysis?.phase ?? -9;
    const pb = b.analysis?.phase ?? -9;
    if (pb !== pa) return pb - pa;
    const ca = a.analysis?.confluenceCount ?? 0;
    const cb = b.analysis?.confluenceCount ?? 0;
    if (cb !== ca) return cb - ca;
    return (a.intradayChangePct || 0) - (b.intradayChangePct || 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:24px 14px;text-align:center;color:#64748b;font-size:12px;">
      Keine Aktie in diesem Filter.<br/><br/>
      Klicke oben rechts auf <b>„⚡ Playbook-Fallstudie (Kap. 08)“</b>, um einen kompletten Phase-4-Lead live zu simulieren!
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
      const lod = s.analysis?.lodPrice ? `${s.analysis.lodPrice.toFixed(2)} €` : '--';
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
            <span class="sc-name" title="${escapeHtml(s.name)} · ${escapeHtml(s.sector)}">${escapeHtml(s.name)}</span>
          </div>
          <div class="sc-price-col">
            <div class="sc-price">${Number(s.price || 0).toFixed(2)} €</div>
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
      renderTopRadarStrip();
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
  document.getElementById('detailStockName').textContent = rec.name;
  document.getElementById('detailStockSymbol').textContent = rec.symbol;
  document.getElementById('detailStockIndex').textContent = `${rec.indexName} · ${rec.sector}`;

  const mhEl = document.getElementById('detailMarketHours');
  mhEl.textContent = rec.marketClock?.reason || 'Handelszeit';
  mhEl.className = `mkt-badge ${rec.marketClock?.isOpen ? 'open' : 'closed'}`;

  const f = rec.fundamentals || {};
  const peEl = document.getElementById('detailPeBadge');
  if (peEl) {
    peEl.textContent = f.peValue ? `KGV ${f.peValue}x` : 'Profitabel';
  }

  document.getElementById('detailFundamentalSummary').innerHTML =
    `<b>Bewertung:</b> ${escapeHtml(f.peReason || '-')} &nbsp;·&nbsp; <b>Dip-Analyse:</b> ${escapeHtml(f.dipReason || '-')} &nbsp;·&nbsp; <b>Schutzfilter:</b> ${escapeHtml(f.earningsNote || '-')}`;

  document.getElementById('detailCurrentPrice').textContent = `${Number(rec.price || 0).toFixed(2)} €`;

  const chgEl = document.getElementById('detailIntradayChange');
  const chg = Number(rec.intradayChangePct || 0);
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% heute`;
  chgEl.className = `delta-pill ${chg >= 0 ? 'pos' : 'neg'}`;

  const swingEl = document.getElementById('detailSwingDip');
  const sw = Number(rec.dipFromSwingHighPct || 0);
  swingEl.textContent = `${sw.toFixed(1)}% v. 20T-Hoch`;

  // Hero Mini-KPIs (alles in €)
  const a = rec.analysis || {};
  const s = rec.sizing || {};
  document.getElementById('heroKpiLod').textContent = a.lodPrice ? `${a.lodPrice.toFixed(2)} €` : '--';
  document.getElementById('heroKpiSl').textContent = s.stopLossStock ? `${s.stopLossStock.toFixed(2)} €` : '--';
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

  // Chart-Legende (alles in €)
  document.getElementById('legEma20').textContent = a.ema20 ? `${a.ema20.toFixed(2)} €` : '--';
  document.getElementById('legVwap').textContent = a.vwap ? `${a.vwap.toFixed(2)} €` : '--';
  document.getElementById('legLod').textContent = a.lodPrice ? `${a.lodPrice.toFixed(2)} €` : '--';
  document.getElementById('legSl').textContent = s.stopLossStock ? `${s.stopLossStock.toFixed(2)} €` : '--';
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
  const orders = state.snapshot?.demoAccount?.orderHistory || [];
  document.getElementById('activeTradesCount').textContent = trades.length;

  const tradesContainer = document.getElementById('activeTradesList');
  if (trades.length === 0) {
    tradesContainer.innerHTML = `<div style="padding:18px;text-align:center;color:#64748b;font-size:12px;">
      Aktuell keine offenen Demo-Positionen.<br/><br/>
      Sobald ein <b>Phase-4-Lead</b> erkannt wird (oder du oben rechts in der <b>Playbook-Fallstudie Kap. 08</b> auf <b>Phase 4</b> klickst), kauft der Demo-Account automatisch die berechnete Knock-Out-Position!
    </div>`;
  } else {
    tradesContainer.innerHTML = trades
      .map((t) => {
        const ev = t.latestEvaluation || {};
        const pnlEuro = Number(ev.pnlEuro || 0);
        const derivPct = Number(ev.derivGainPct || 0);
        const rMult = Number(ev.rMultiple || 0);
        const pnlColor = pnlEuro >= 0 ? '#34d399' : '#f87171';
        const srcBadge = t.isDemoAuto
          ? `<span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(16,185,129,0.18);color:#34d399;border:1px solid #10b981;">🤖 AUTO-LEAD</span>`
          : `<span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.18);color:#38bdf8;">👤 MANUELL</span>`;

        return `<div class="trade-item">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:6px;">
              ${srcBadge}
              <strong>${escapeHtml(t.name)} (${escapeHtml(t.symbol)}) · ${t.leverage}x Long</strong>
            </div>
            <strong style="font-family:var(--font-mono);color:${pnlColor}">${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(2)} € (${derivPct >= 0 ? '+' : ''}${derivPct.toFixed(1)}% | ${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R)</strong>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;font-family:var(--font-mono);">
            Einsatz: <b>${Number(t.positionSizeEuro || 0).toFixed(0)} €</b> · Entry: ${Number(t.entryPrice).toFixed(2)} € · Aktuell: ${(ev.currentPrice || t.entryPrice).toFixed(2)} € · SL: <b style="color:#fbbf24">${(ev.recommendedStopStock || t.stopLossStock).toFixed(2)} €</b>
          </div>
          <div style="margin-top:6px;padding:6px 8px;background:#070b14;border-radius:6px;font-size:11px;">
            <b>${escapeHtml(ev.stageName || 'Stufe 1: Initial Risk')}:</b> ${escapeHtml(ev.recommendation || 'Stop unter LoD belassen.')}
          </div>
          <div style="margin-top:8px;display:flex;justify-content:flex-end;">
            <button class="btn btn-xs btn-secondary btn-close-trade" data-id="${escapeHtml(t.id)}">
              🏁 Jetzt im Demo-Konto verkaufen &amp; Gewinn/Verlust buchen
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
          body: JSON.stringify({ exitReason: 'Manueller Verkauf im Demo-Depot' })
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      });
    });
  }

  const journalContainer = document.getElementById('journalList');
  if (journal.length === 0 && orders.length === 0) {
    journalContainer.innerHTML = `<div style="padding:18px;text-align:center;color:#64748b;font-size:12px;">Noch keine abgeschlossenen Demo-Trades oder Orders im Journal.</div>`;
  } else {
    const journalHtml = journal
      .slice(0, 15)
      .map((j) => {
        const win = j.pnlEuro >= 0;
        const timeStr = j.closedAt ? new Date(j.closedAt).toLocaleTimeString('de-DE') : '';
        return `<div class="journal-item" style="border-left:3px solid ${win ? '#10b981' : '#ef4444'}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${win ? '🟢 WIN' : '🔴 LOSS'} · ${escapeHtml(j.name)} (${escapeHtml(j.symbol)}) · ${j.leverage}x</strong>
            <strong style="font-family:var(--font-mono);color:${win ? '#34d399' : '#f87171'}">${win ? '+' : ''}${Number(j.pnlEuro).toFixed(2)} € (${win ? '+' : ''}${Number(j.rMultiple).toFixed(2)}R)</strong>
          </div>
          <div style="font-size:11px;color:#cbd5e1;margin-top:4px;font-family:var(--font-mono);">
            Entry ${Number(j.entryPrice).toFixed(2)} € → Exit ${Number(j.exitPrice).toFixed(2)} € (${j.stockGainPct >= 0 ? '+' : ''}${j.stockGainPct}% Aktie | ${j.derivGainPct >= 0 ? '+' : ''}${j.derivGainPct}% Derivat)
          </div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:3px;display:flex;justify-content:space-between;">
            <span>Grund: ${escapeHtml(j.exitReason || 'Exit')}</span>
            <span>${timeStr ? `${timeStr} Uhr · ` : ''}Konto danach: <b>${Number(j.demoEquityAfterEuro || 10000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</b></span>
          </div>
        </div>`;
      })
      .join('');

    const ordersHtml = orders
      .slice(0, 15)
      .map((o) => {
        const isBuy = o.action === 'BUY';
        const tStr = o.timestamp ? new Date(o.timestamp).toLocaleTimeString('de-DE') : '';
        return `<div class="journal-item" style="opacity:0.9;">
          <div style="display:flex;justify-content:space-between;font-size:11px;">
            <strong style="color:${isBuy ? '#38bdf8' : '#34d399'}">${isBuy ? '🛒 DEMO-KAUF (ENTRY)' : '🏁 DEMO-VERKAUF (CLOSE)'} · ${escapeHtml(o.symbol)} (${o.leverage}x)</strong>
            <span style="font-family:var(--font-mono);color:#94a3b8">${tStr}</span>
          </div>
          <div style="font-size:11px;color:#cbd5e1;margin-top:2px;font-family:var(--font-mono);">
            ${
              isBuy
                ? `Kurs: ${Number(o.priceEuro).toFixed(2)} € · Einsatz: <b>${Number(o.positionSizeEuro).toFixed(2)} €</b> (${o.quantityPieces} Stk.) · SL: ${Number(o.stopLossEuro).toFixed(2)} €`
                : `Entry ${Number(o.entryPriceEuro).toFixed(2)} € → Exit ${Number(o.exitPriceEuro).toFixed(2)} € · Auszahlung: <b>${Number(o.payoutEuro).toFixed(2)} €</b> (${o.pnlEuro >= 0 ? '+' : ''}${Number(o.pnlEuro).toFixed(2)} €)`
            }
          </div>
        </div>`;
      })
      .join('');

    journalContainer.innerHTML =
      (journalHtml ? `<div style="font-size:10.5px;font-weight:700;color:#94a3b8;margin-bottom:4px;">ABGESCHLOSSENE DEMO-TRADES (${journal.length})</div>${journalHtml}` : '') +
      (ordersHtml ? `<div style="font-size:10.5px;font-weight:700;color:#94a3b8;margin:8px 0 4px;">CHRONOLOGISCHES ORDERBUCH (${orders.length})</div>${ordersHtml}` : '');
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
    if (alert.demoAccount) {
      state.snapshot.demoAccount = alert.demoAccount;
      renderDemoAccount();
    }
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
                SL: ${a.sizing.stopLossStock.toFixed(2)} € · Hebel ${a.sizing.activeLeverage}x · Kauf: <b>${a.sizing.positionSizeEuro.toFixed(0)} €</b> (Risiko: -${a.sizing.rMaxEuro.toFixed(0)} €)
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
      if (data.snapshot) applySnapshot(data.snapshot);
      state.selectedSymbol = 'SY1.DE';
      await loadChartForSymbol('SY1.DE', false);
      if (stage === 'phase4_entry') {
        document.querySelector('.wb-tab[data-wbtab="trades"]')?.click();
      } else if (stage === 'stagnation_exit') {
        document.querySelector('.wb-tab[data-wbtab="journal"]')?.click();
      }
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
