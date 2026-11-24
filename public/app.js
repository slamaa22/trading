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
  slPriceLine: null,
  lastDemoTickAt: 0,
  newsFilter: 'all',
  searchTimer: null,
  activeAccountMode: 'reverse',
  selectedDailyDate: null,
  selectedDailySide: 'all'
};

document.addEventListener('DOMContentLoaded', () => {
  initTradingViewCharts();
  bindUIEvents();
  connectWebSocket();
  fetchInitialSnapshot();
  startDemoLiveFallbackLoop();
});

// --- TRADINGVIEW LIGHTWEIGHT CHARTS INITIALISIERUNG ---

function initTradingViewCharts() {
  const mainEl = document.getElementById('tvMainChart');
  const rsiEl = document.getElementById('tvRsiChart');
  if (!mainEl || !rsiEl || !window.LightweightCharts) return;

  const LWC = window.LightweightCharts;

  state.tvMain = LWC.createChart(mainEl, {
    width: mainEl.clientWidth || 800,
    height: 310,
    layout: {
      background: { type: 'solid', color: '#070709' },
      textColor: '#a1a1aa',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.04)' }
    },
    crosshair: {
      mode: LWC.CrosshairMode.Normal
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      scaleMargins: { top: 0.08, bottom: 0.22 }
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      timeVisible: true,
      secondsVisible: false
    }
  });

  state.candleSeries = state.tvMain.addCandlestickSeries({
    upColor: '#00d09c',
    downColor: '#ff4d4f',
    borderUpColor: '#00d09c',
    borderDownColor: '#ff4d4f',
    wickUpColor: '#00d09c',
    wickDownColor: '#ff4d4f'
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
    height: 90,
    layout: {
      background: { type: 'solid', color: '#070709' },
      textColor: '#71717a',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10.5
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.04)' }
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      scaleMargins: { top: 0.12, bottom: 0.12 }
    },
    timeScale: {
      visible: false
    }
  });

  state.rsiSeries = state.tvRsi.addLineSeries({
    color: '#00d09c',
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
    const svg = btn.querySelector('svg');
    btn.disabled = true;
    svg?.classList.add('tr-ico-spin');
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const snap = await res.json();
      applySnapshot(snap);
    } finally {
      btn.disabled = false;
      svg?.classList.remove('tr-ico-spin');
    }
  });

  // Fallstudie (Kapitel 08) Buttons
  const simDropdown = document.querySelector('.sim-dropdown');
  const btnSim = document.getElementById('btnSimCaseStudy');
  if (btnSim && simDropdown) {
    btnSim.addEventListener('click', (e) => {
      e.stopPropagation();
      simDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => simDropdown.classList.remove('open'));
  }

  document.querySelectorAll('#simMenu button[data-sim]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      simDropdown?.classList.remove('open');
      closeSettingsModal();
      const stage = btn.getAttribute('data-sim');
      await runCaseStudySimulation(stage);
    });
  });

  // Phasen-Filter Pills
  document.querySelectorAll('#phaseFilterTabs [data-filter]').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#phaseFilterTabs [data-filter]').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeFilter = pill.getAttribute('data-filter');
      renderStockList();
    });
  });

  // Index-Filter Chips (alle 7 Leitindizes)
  document.querySelectorAll('#regionFilterTabs [data-region]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#regionFilterTabs [data-region]').forEach((c) => c.classList.remove('active'));
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

  // Aktie hinzufügen (Modal + Direkt-Leiste in der Überwachung)
  document.getElementById('btnAddSymbol')?.addEventListener('click', addStockFromInput);
  document.getElementById('inputAddSymbol')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addStockFromInput();
  });

  const quickInput = document.getElementById('inputWatchlistQuickAdd');
  const quickBtn = document.getElementById('btnWatchlistQuickAdd');
  if (quickBtn) {
    quickBtn.addEventListener('click', () => addStockToWatchlist(quickInput?.value));
  }
  if (quickInput) {
    quickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addStockToWatchlist(quickInput.value);
      }
    });
    quickInput.addEventListener('input', (e) => {
      handleWatchlistAutocompleteInput(e.target.value);
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tr-watch-add-wrap')) {
      document.getElementById('watchlistSearchSuggestions')?.classList.add('hidden');
    }
  });

  document.getElementById('btnRemoveSelectedStock')?.addEventListener('click', () => {
    if (state.selectedSymbol) removeStockFromWatchlist(state.selectedSymbol);
  });

  document.getElementById('btnRestoreWatchlist')?.addEventListener('click', restoreDefaultWatchlist);

  // News-Tracker Filter & Refresh
  document.querySelectorAll('#newsFilterBar [data-newsfilter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#newsFilterBar [data-newsfilter]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.newsFilter = chip.getAttribute('data-newsfilter') || 'all';
      renderNewsFeed();
      if (state.newsFilter === 'selected' && state.selectedSymbol) {
        fetchNewsFromServer({ symbol: state.selectedSymbol, forceRefresh: false });
      }
    });
  });

  document.getElementById('btnRefreshNews')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnRefreshNews');
    const svg = btn?.querySelector('svg');
    svg?.classList.add('tr-ico-spin');
    try {
      await fetchNewsFromServer({
        symbol: state.newsFilter === 'selected' ? state.selectedSymbol : null,
        forceRefresh: true
      });
    } finally {
      svg?.classList.remove('tr-ico-spin');
    }
  });

  // Chart Aktionen
  document.getElementById('btnRefreshChart').addEventListener('click', () => {
    if (state.selectedSymbol) loadChartForSymbol(state.selectedSymbol, true);
  });
  document.getElementById('btnFitChart').addEventListener('click', () => {
    state.tvMain?.timeScale().fitContent();
    state.tvRsi?.timeScale().fitContent();
  });

  // Tabs (Investments / Historie & Orders / Tages-Historie / Signale / News)
  document.querySelectorAll('[data-wbtab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-wbtab');
      document.querySelectorAll('[data-wbtab]').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tr-pane, .wb-pane').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`wbtab-${target}`)?.classList.add('active');
      if (target === 'dailyhistory') {
        renderDailyAccountsHistory();
      } else if (target === 'news' && (!state.snapshot?.news || state.snapshot.news.length === 0)) {
        fetchNewsFromServer({ symbol: state.selectedSymbol, forceRefresh: false });
      }
    });
  });

  // Mobile Bottom Navigation
  document.querySelectorAll('#mobileBottomNav [data-mobnav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mobileBottomNav [data-mobnav]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-mobnav');
      if (target === 'portfolio') {
        document.getElementById('demoAccountStrip')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (target === 'chart') {
        document.getElementById('stockDetailCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (target === 'watchlist') {
        document.getElementById('sidebarWatchlistCol')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (target === 'news') {
        document.querySelector('[data-wbtab="news"]')?.click();
        document.getElementById('wbCardTradesAndAlerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
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

  // Account Switcher (4 Konten: #1 Gesamt Long, #2 Gesamt Short, Tages-Long, Tages-Short)
  document.querySelectorAll('#accountModeSwitcher [data-accmode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-accmode') || 'main';
      state.activeAccountMode = mode;
      renderDemoAccount();
      renderActiveTradesAndJournal();
      if (state.chartRecord?.sizing) {
        renderSizingOutput(state.chartRecord.sizing, state.chartRecord.currency || '€');
      }
    });
  });

  // Demo-Account Steuerung (Auto-Trade Schalter, Orderbuch anzeigen, Reset, Resync)
  const chkAuto = document.getElementById('chkDemoAutoTrade');
  if (chkAuto) {
    chkAuto.addEventListener('change', async (e) => {
      try {
        const res = await fetch('/api/demo/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: state.activeAccountMode,
            autoTradeEnabled: e.target.checked
          })
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
      const ctx = getActiveAccountContext();
      const openCnt = ctx.activeTrades?.length || 0;
      const tabKey = openCnt > 0 ? 'trades' : 'journal';
      const tabBtn = document.querySelector(`.wb-tab[data-wbtab="${tabKey}"], .tr-tab[data-wbtab="${tabKey}"]`);
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
          body: JSON.stringify({
            account: state.activeAccountMode,
            initialBalanceEuro: 10000,
            resyncFromMain: false
          })
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      } catch (err) {
        console.error('Demo-Reset Fehler:', err);
      }
    });
  }

  const btnResyncReverse = document.getElementById('btnResyncReverseAccount');
  if (btnResyncReverse) {
    btnResyncReverse.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/demo/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: 'reverse',
            initialBalanceEuro: 10000,
            resyncFromMain: true
          })
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      } catch (err) {
        console.error('Reverse-Resync Fehler:', err);
      }
    });
  }

  // Telegram Quick-Connect Buttons in Topbar & Modal
  document.getElementById('btnQuickDetectChat')?.addEventListener('click', quickDetectChatFromHeader);
  document.getElementById('btnQuickTestAlert')?.addEventListener('click', triggerTestAlert);
  document.getElementById('btnTriggerTestAlert')?.addEventListener('click', triggerTestAlert);
  document.getElementById('btnModalTestAlert')?.addEventListener('click', triggerTestAlert);

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
    if (state.selectedSymbol) {
      ws.send(JSON.stringify({ type: 'WATCH_SYMBOL', symbol: state.selectedSymbol }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'INITIAL_SNAPSHOT' || data.type === 'SCAN_COMPLETED') {
        applySnapshot(data.snapshot);
      } else if (data.type === 'DEMO_LIVE_TICK') {
        handleDemoLiveTick(data);
      } else if (data.type === 'DEMO_ACCOUNT_UPDATED') {
        if (state.snapshot) {
          if (data.demoAccount) state.snapshot.demoAccount = data.demoAccount;
          if (data.reverseDemoAccount) state.snapshot.reverseDemoAccount = data.reverseDemoAccount;
          if (data.dailySession) state.snapshot.dailySession = data.dailySession;
          if (Array.isArray(data.dailyAccountsHistory)) state.snapshot.dailyAccountsHistory = data.dailyAccountsHistory;
          renderDemoAccount();
          if (document.getElementById('wbtab-dailyhistory')?.classList.contains('active')) {
            renderDailyAccountsHistory();
          }
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
      } else if (data.type === 'NEWS_UPDATED') {
        if (state.snapshot && Array.isArray(data.news)) {
          state.snapshot.news = data.news;
          renderNewsFeed();
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

function startDemoLiveFallbackLoop() {
  setInterval(async () => {
    const msSinceLastTick = Date.now() - (state.lastDemoTickAt || 0);
    if (state.ws?.readyState === 1 && msSinceLastTick < 1800) {
      return;
    }
    try {
      const res = await fetch('/api/demo/live');
      if (res.ok) {
        const data = await res.json();
        handleDemoLiveTick(data);
      }
    } catch {
      // Ignoriere kurzzeitige Netzwerkfehler beim 1s-Fallback
    }
  }, 1000);
}

function handleDemoLiveTick(data) {
  if (!data) return;
  state.lastDemoTickAt = Date.now();

  // 1-Sekunden-Takt Uhr & Puls im Demo-Header aktualisieren
  const clockEl = document.getElementById('demoTickClock');
  if (clockEl) {
    const tStr = (data.serverTime ? new Date(data.serverTime) : new Date()).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    clockEl.innerHTML = `<i class="tick-dot"></i> LIVE 1s · ${tStr}`;
    clockEl.classList.add('pulse');
    setTimeout(() => clockEl.classList.remove('pulse'), 180);
  }

  if (!state.snapshot) return;

  if (data.demoAccount) {
    state.snapshot.demoAccount = data.demoAccount;
  }
  if (data.reverseDemoAccount) {
    state.snapshot.reverseDemoAccount = data.reverseDemoAccount;
  }
  if (data.dailySession) {
    state.snapshot.dailySession = data.dailySession;
  }
  if (Array.isArray(data.dailyAccountsHistory)) {
    state.snapshot.dailyAccountsHistory = data.dailyAccountsHistory;
  }
  if (data.demoAccount || data.reverseDemoAccount || data.dailySession) {
    renderDemoAccount();
  }

  if (Array.isArray(data.activeTrades)) {
    state.snapshot.activeTrades = data.activeTrades;
  }
  if (Array.isArray(data.journal) && data.journal.length !== (state.snapshot.journal?.length || 0)) {
    state.snapshot.journal = data.journal;
  }
  if (Array.isArray(data.reverseActiveTrades)) {
    state.snapshot.reverseActiveTrades = data.reverseActiveTrades;
  }
  if (Array.isArray(data.reverseJournal) && data.reverseJournal.length !== (state.snapshot.reverseJournal?.length || 0)) {
    state.snapshot.reverseJournal = data.reverseJournal;
  }

  // Aktive Trades & Orderbuch ohne Scroll-Sprung jede Sekunde aktualisieren
  const tradesList = document.getElementById('activeTradesList');
  const prevScroll = tradesList ? tradesList.scrollTop : 0;
  renderActiveTradesAndJournal();
  if (tradesList) tradesList.scrollTop = prevScroll;

  if (document.getElementById('wbtab-dailyhistory')?.classList.contains('active')) {
    renderDailyAccountsHistory({ preserveScroll: true });
  }

  // Live-Preise für beobachtete & offene Aktien im UI & M10-Chart aktualisieren
  if (data.livePrices && typeof data.livePrices === 'object') {
    for (const [sym, info] of Object.entries(data.livePrices)) {
      const rec = (state.snapshot.stocks || []).find((s) => s.symbol === sym);
      if (rec && info.price > 0) {
        rec.price = info.price;
        rec.intradayChangePct = info.intradayChangePct;
      }

      if (sym === state.selectedSymbol && info.price > 0) {
        const priceEl = document.getElementById('detailCurrentPrice');
        if (priceEl) priceEl.textContent = `${Number(info.price).toFixed(2)} €`;

        const chgEl = document.getElementById('detailIntradayChange');
        if (chgEl && Number.isFinite(info.intradayChangePct)) {
          const chg = Number(info.intradayChangePct);
          chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% heute`;
          chgEl.className = `tr-delta ${chg >= 0 ? 'pos' : 'neg'}`;
        }

        if (info.lastBar && state.candleSeries && state.chartBars?.length > 0) {
          const lastChartBar = state.chartBars[state.chartBars.length - 1];
          if (lastChartBar && info.lastBar.time >= lastChartBar.time) {
            state.candleSeries.update({
              time: info.lastBar.time,
              open: Number(info.lastBar.open),
              high: Number(info.lastBar.high),
              low: Number(info.lastBar.low),
              close: Number(info.lastBar.close)
            });
          }
        }
      }
    }
  }
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

  const restoreBtn = document.getElementById('btnRestoreWatchlist');
  if (restoreBtn) {
    if ((snapshot.hiddenSymbolsCount || 0) > 0) {
      restoreBtn.classList.remove('hidden');
      restoreBtn.textContent = `Standard wiederherstellen (${snapshot.hiddenSymbolsCount} ausgeblendet)`;
    } else {
      restoreBtn.classList.add('hidden');
    }
  }

  updateTelegramStatusUI();
  renderDemoAccount();
  renderIndexRegimes();
  renderTopRadarStrip();
  renderStockList();
  renderActiveTradesAndJournal();
  renderDailyAccountsHistory();
  renderAlertsHistory();
  renderNewsFeed();

  if (!state.selectedSymbol && stocks.length > 0) {
    state.selectedSymbol = stocks[0].symbol;
  }

  if (state.selectedSymbol) {
    const rec = stocks.find((s) => s.symbol === state.selectedSymbol);
    if (rec) {
      state.chartRecord = rec;
      renderSelectedStockDetails(rec);
    } else if (stocks.length > 0) {
      state.selectedSymbol = stocks[0].symbol;
      state.chartRecord = stocks[0];
      renderSelectedStockDetails(stocks[0]);
      loadChartForSymbol(stocks[0].symbol, false);
    }
    if (state.chartBars.length === 0 && state.selectedSymbol) {
      loadChartForSymbol(state.selectedSymbol, false);
    }
  }
}

function getActiveAccountContext() {
  const snap = state.snapshot || {};
  const mode = state.activeAccountMode || 'reverse';
  const ds = snap.dailySession || null;
  const dateLabel = ds?.date ? formatGermanDateShort(ds.date) : 'Heute';

  if (mode === 'reverse' && snap.reverseDemoAccount) {
    return {
      mode: 'reverse',
      isShort: true,
      isDaily: false,
      account: snap.reverseDemoAccount,
      activeTrades: snap.reverseActiveTrades || [],
      journal: snap.reverseJournal || [],
      eyebrow: 'Portfoliowert · Account #2 (Gesamt Short · Invertiert)',
      resetLabel: 'Reset Account #2 (10.000 €)',
      botLabel: 'Reverse-Bot',
      returnSuffix: 'gesamt',
      emptyActiveMsg: 'Keine offenen Positionen in Account #2 (Gesamt Short). Der Reverse-Bot eröffnet beim nächsten Phase-4-Lead automatisch eine Gegenposition (Turbo-Short).',
      emptyJournalMsg: 'Noch keine abgeschlossenen Trades in Account #2.',
      buyBtnLabel: 'Jetzt in Account #2 shorten (Reverse)',
      closeLabel: 'Cover',
      manualExitReason: 'Manuelles Short-Cover (Account #2)'
    };
  }

  if (mode === 'daily_long' && ds?.longAccount) {
    return {
      mode: 'daily_long',
      isShort: false,
      isDaily: true,
      account: ds.longAccount,
      activeTrades: ds.longActiveTrades || [],
      journal: ds.longJournal || [],
      eyebrow: `Tages-Account Long v2 (${dateLabel}) · 10.000 € Tagesstart`,
      resetLabel: `Reset Tages-Long (10.000 €)`,
      botLabel: 'Tages-Long',
      returnSuffix: `heute (${dateLabel})`,
      emptyActiveMsg: `Keine offenen Positionen im heutigen Tages-Long (${dateLabel}). Käufe folgen der Buy-Strategie v2 (Konfluenz + Index-Filter).`,
      emptyJournalMsg: `Heute (${dateLabel}) noch keine abgeschlossenen Tages-Long Trades.`,
      buyBtnLabel: 'Jetzt im Tages-Long kaufen',
      closeLabel: 'Verkaufen',
      manualExitReason: `Manueller Verkauf (Tages-Long ${ds.date})`
    };
  }

  if (mode === 'daily_short' && ds?.shortAccount) {
    return {
      mode: 'daily_short',
      isShort: true,
      isDaily: true,
      account: ds.shortAccount,
      activeTrades: ds.shortActiveTrades || [],
      journal: ds.shortJournal || [],
      eyebrow: `Tages-Account Short (${dateLabel}) · 10.000 € Tagesstart`,
      resetLabel: `Reset Tages-Short (10.000 €)`,
      botLabel: 'Tages-Short',
      returnSuffix: `heute (${dateLabel})`,
      emptyActiveMsg: `Keine offenen Positionen im heutigen Tages-Short (${dateLabel}). Startkapital heute: 10.000,00 €.`,
      emptyJournalMsg: `Heute (${dateLabel}) noch keine abgeschlossenen Tages-Short Trades.`,
      buyBtnLabel: 'Jetzt im Tages-Short shorten',
      closeLabel: 'Cover',
      manualExitReason: `Manuelles Short-Cover (Tages-Short ${ds.date})`
    };
  }

  return {
    mode: 'main',
    isShort: false,
    isDaily: false,
    account: snap.demoAccount,
    activeTrades: snap.activeTrades || [],
    journal: snap.journal || [],
    eyebrow: 'Portfoliowert · Account #1 (Buy-Strategie v2 · Long)',
    resetLabel: 'Reset Account #1 (10.000 €)',
    botLabel: 'Auto-Trader',
    returnSuffix: 'gesamt',
    emptyActiveMsg: 'Keine offenen Positionen in Account #1 (Buy-Strategie v2). Käufe starten erst bei Phase-4-Ausbruch mit ≥ 2/4 Konfluenz und stabilem Leitindex.',
    emptyJournalMsg: 'Noch keine abgeschlossenen Trades in Account #1.',
    buyBtnLabel: 'Jetzt in Account #1 kaufen (Long)',
    closeLabel: 'Verkaufen',
    manualExitReason: 'Manueller Verkauf im Demo-Depot'
  };
}

function formatGermanDateShort(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function updateSwitcherCard(eqId, retId, metaId, acc) {
  if (!acc) return;
  const fmtEuro = (val) =>
    `${Number(val || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const eqEl = document.getElementById(eqId);
  const retEl = document.getElementById(retId);
  const metaEl = document.getElementById(metaId);
  const rEuro = Number(acc.totalReturnEuro || 0);
  const rPct = Number(acc.totalReturnPct || 0);
  const sign = rEuro >= 0 ? '+' : '';
  if (eqEl) eqEl.textContent = fmtEuro(acc.totalEquityEuro);
  if (retEl) {
    retEl.textContent = `${sign}${fmtEuro(rEuro)} (${sign}${rPct.toFixed(2)} %)`;
    retEl.style.color = rEuro > 0 ? '#00d09c' : rEuro < 0 ? '#ff4d4f' : '#a1a1aa';
  }
  if (metaEl) {
    metaEl.textContent = `${acc.wins || 0}W · ${acc.losses || 0}L (${Number(acc.winRatePct || 0).toFixed(0)}%)`;
  }
}

function renderDemoAccount() {
  const mainDemo = state.snapshot?.demoAccount;
  const revDemo = state.snapshot?.reverseDemoAccount;
  const ds = state.snapshot?.dailySession;
  if (!mainDemo && !revDemo && !ds) return;

  const ctx = getActiveAccountContext();
  const demo = ctx.account;
  if (!demo) return;

  const fmtEuro = (val) =>
    `${Number(val || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  // Update Switcher Comparison Cards (4 Accounts)
  document.querySelectorAll('#accountModeSwitcher [data-accmode]').forEach((card) => {
    const m = card.getAttribute('data-accmode');
    card.classList.toggle('active', m === ctx.mode);
  });

  if (mainDemo) updateSwitcherCard('accMainEquity', 'accMainReturn', 'accMainMeta', mainDemo);
  if (revDemo) updateSwitcherCard('accReverseEquity', 'accReverseReturn', 'accReverseMeta', revDemo);
  if (ds?.longAccount) {
    updateSwitcherCard('accDailyLongEquity', 'accDailyLongReturn', 'accDailyLongMeta', ds.longAccount);
    const lbl = document.getElementById('accDailyLongLabel');
    if (lbl && ds.date) lbl.textContent = `Tag Long · ${ds.date.slice(8, 10)}.${ds.date.slice(5, 7)}.`;
  }
  if (ds?.shortAccount) {
    updateSwitcherCard('accDailyShortEquity', 'accDailyShortReturn', 'accDailyShortMeta', ds.shortAccount);
    const lbl = document.getElementById('accDailyShortLabel');
    if (lbl && ds.date) lbl.textContent = `Tag Short · ${ds.date.slice(8, 10)}.${ds.date.slice(5, 7)}.`;
  }

  const dailyBadge = document.getElementById('dailyHistoryCountBadge');
  if (dailyBadge) {
    const histCount = (state.snapshot?.dailyAccountsHistory || []).length + (ds ? 1 : 0);
    dailyBadge.textContent = histCount;
  }

  const eyebrowEl = document.getElementById('demoPortfolioEyebrow');
  if (eyebrowEl) {
    eyebrowEl.textContent = ctx.eyebrow;
  }

  const resyncBtn = document.getElementById('btnResyncReverseAccount');
  if (resyncBtn) {
    resyncBtn.classList.toggle('hidden', ctx.mode !== 'reverse');
  }

  const resetLabel = document.getElementById('btnResetDemoLabel');
  if (resetLabel) {
    resetLabel.textContent = ctx.resetLabel;
  }

  const badge = document.getElementById('demoStatusBadge');
  const chk = document.getElementById('chkDemoAutoTrade');
  if (chk) chk.checked = demo.autoTradeEnabled !== false;
  if (badge) {
    if (demo.autoTradeEnabled !== false) {
      badge.textContent = `${ctx.botLabel} aktiv`;
      badge.classList.remove('paused');
    } else {
      badge.textContent = `${ctx.botLabel} pausiert`;
      badge.classList.add('paused');
    }
  }

  const openBadge = document.getElementById('demoOpenCountBadge');
  if (openBadge) openBadge.textContent = demo.openPositionsCount || 0;

  const closedBadge = document.getElementById('closedTradesBadge');
  if (closedBadge) closedBadge.textContent = demo.closedTradesCount || 0;

  const eqEl = document.getElementById('demoTotalEquity');
  if (eqEl) eqEl.textContent = fmtEuro(demo.totalEquityEuro);

  const retEl = document.getElementById('demoTotalReturn');
  if (retEl) {
    const rEuro = Number(demo.totalReturnEuro || 0);
    const rPct = Number(demo.totalReturnPct || 0);
    const sign = rEuro >= 0 ? '+' : '';
    retEl.textContent = `${sign}${fmtEuro(rEuro)} (${sign}${rPct.toFixed(2)} %) ${ctx.returnSuffix}`;
    retEl.style.color = rEuro > 0 ? '#00d09c' : rEuro < 0 ? '#ff4d4f' : '#a1a1aa';
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
    unrEl.style.color = u > 0 ? '#00d09c' : u < 0 ? '#ff4d4f' : '#ffffff';
  }

  const realEl = document.getElementById('demoRealizedPnl');
  if (realEl) {
    const r = Number(demo.realizedPnlEuro || 0);
    realEl.textContent = `${r >= 0 ? '+' : ''}${fmtEuro(r)}`;
  }

  // Berechne aktuelles RR (Avg Win R / Avg Loss R) & Ø R aus dem aktiven Journal
  const journal = ctx.journal || [];
  const winEntries = journal.filter((j) => Number(j.pnlEuro) >= 0);
  const lossEntries = journal.filter((j) => Number(j.pnlEuro) < 0);
  const avgWinR = winEntries.length
    ? winEntries.reduce((s, j) => s + Number(j.rMultiple || 0), 0) / winEntries.length
    : 0;
  const avgLossR = lossEntries.length
    ? Math.abs(lossEntries.reduce((s, j) => s + Number(j.rMultiple || 0), 0) / lossEntries.length)
    : 0;
  const rrRatio = avgLossR > 0 ? `${(avgWinR / avgLossR).toFixed(2)}:1 RR` : journal.length > 0 ? `+${avgWinR.toFixed(2)}R Ø` : '';

  const wrEl = document.getElementById('demoWinRate');
  if (wrEl) {
    wrEl.textContent = demo.closedTradesCount > 0 ? `${Number(demo.winRatePct || 0).toFixed(0)} %` : '-- %';
    wrEl.style.color = demo.winRatePct >= 50 ? '#00d09c' : '#ffffff';
  }

  const wlSub = document.getElementById('demoWinLossSub');
  if (wlSub) {
    wlSub.textContent = `${demo.wins || 0}W · ${demo.losses || 0}L${rrRatio ? ` · ${rrRatio}` : ''}`;
  }
}

function updateTelegramStatusUI() {
  const s = state.snapshot?.settings || {};
  const bar = document.getElementById('tgConnectBar');
  const dot = document.getElementById('tgStatusDot');
  const title = document.getElementById('tgBotTitle');
  const sub = document.getElementById('tgBotSub');

  if (s.telegramBotToken && s.telegramChatId) {
    bar?.classList.add('connected');
    dot?.classList.add('connected');
    if (title) title.textContent = 'Telegram aktiv';
    if (sub) sub.textContent = `Verbunden (${s.telegramChatId}) · Nur Lead-Entry & Close Alarme`;
  } else {
    bar?.classList.remove('connected');
    dot?.classList.remove('connected');
    if (title) title.textContent = 'Telegram koppeln';
    if (sub) sub.textContent = 'Klicke auf „Bot öffnen“ & danach auf „Erkennen“';
  }
}

async function quickDetectChatFromHeader() {
  const btn = document.getElementById('btnQuickDetectChat');
  if (!btn) return;
  try {
    const res = await fetch('/api/telegram/detect-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.found && state.snapshot?.settings) {
      state.snapshot.settings.telegramChatId = data.chatId;
      updateTelegramStatusUI();
    }
  } catch {
    // ignore
  }
}

// --- LEITINDIZES REGIME RIBBON ---

function renderIndexRegimes() {
  const container = document.getElementById('indexRegimeItems');
  if (!container) return;
  const regimes = state.snapshot?.indexRegimes || {};
  const entries = Object.values(regimes);
  if (entries.length === 0) return;

  container.innerHTML = entries
    .map((r) => {
      const chg = Number(r.changePct || 0);
      const sign = chg >= 0 ? '+' : '';
      return `<span>${escapeHtml(r.name)} ${sign}${chg.toFixed(2)}%</span>`;
    })
    .join(' · ');
}

// --- TOP SIGNALE & DIPS (TOP 6 KANDIDATEN AUS 196 AKTIEN) ---

function renderTopRadarStrip() {
  const grid = document.getElementById('topRadarGrid');
  if (!grid) return;
  const stocks = state.snapshot?.stocks || [];
  if (stocks.length === 0) return;

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
      const chgColor = chg >= 0 ? '#00d09c' : '#ff4d4f';
      const isSel = s.symbol === state.selectedSymbol;
      const tagClass = p === 4 ? 'p4' : p === 3 ? 'p3' : p === 2 ? 'p2' : p === 1 ? 'p1' : 'p0';
      const shortBadge = p === 4
        ? `${iconSvg('dot-p4')} LEAD`
        : p === 3
          ? `${iconSvg('bolt')} BODEN`
          : p === 2
            ? `${iconSvg('eye')} LOD`
            : p === 1
              ? 'FALL'
              : '';

      return `<div class="radar-card ${isSel ? 'active' : ''} ${p === 4 ? 'lead-p4' : ''}" data-radar-sym="${escapeHtml(s.symbol)}">
        <div class="rc-row1">
          <span class="rc-sym">${escapeHtml(s.symbol)}</span>
          <span class="rc-price">${Number(s.price).toFixed(2)} €</span>
        </div>
        <div class="rc-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
        <div class="rc-row3">
          ${shortBadge ? `<span class="phase-tag ${tagClass}">${shortBadge}</span>` : `<span></span>`}
          <span style="color:${chgColor};font-weight:700;font-size:11.5px">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %</span>
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
  if (!container) return;
  const stocks = state.snapshot?.stocks || [];
  const withPrice = stocks.filter((s) => s.price > 0).length;

  const countLabel = document.getElementById('universeCountLabel');
  if (countLabel) countLabel.textContent = `${withPrice}/${stocks.length} aktiv (€)`;

  const p4Cnt = stocks.filter((s) => s.analysis?.phase === 4).length;
  const p3Cnt = stocks.filter((s) => s.analysis?.phase === 3).length;
  const p2Cnt = stocks.filter((s) => s.analysis?.phase === 2).length;
  const dipCnt = stocks.filter((s) => s.intradayChangePct <= -2.0 || s.dipFromSwingHighPct <= -3.8).length;
  const customCnt = stocks.filter((s) => s.isCustom).length;

  document.getElementById('cntAll').textContent = `(${stocks.length})`;
  document.getElementById('cntP4').textContent = p4Cnt ? `(${p4Cnt})` : '';
  document.getElementById('cntP3').textContent = p3Cnt ? `(${p3Cnt})` : '';
  document.getElementById('cntP2').textContent = p2Cnt ? `(${p2Cnt})` : '';
  document.getElementById('cntDips').textContent = dipCnt ? `(${dipCnt})` : '';
  const cntCustomEl = document.getElementById('cntCustom');
  if (cntCustomEl) cntCustomEl.textContent = customCnt ? `(${customCnt})` : '';

  const filtered = stocks.filter((s) => {
    const phase = s.analysis?.phase ?? 0;
    if (state.activeFilter === 'phase4' && phase !== 4) return false;
    if (state.activeFilter === 'phase3' && phase !== 3) return false;
    if (state.activeFilter === 'phase2' && phase !== 2) return false;
    if (state.activeFilter === 'dips' && s.intradayChangePct > -2.0 && s.dipFromSwingHighPct > -3.8) return false;
    if (state.activeFilter === 'custom' && !s.isCustom) return false;

    if (state.activeRegion && state.activeRegion !== 'ALL') {
      if (s.index !== state.activeRegion) return false;
    }

    if (state.searchQuery) {
      const hay = `${s.symbol} ${s.name} ${s.indexName} ${s.sector}`.toLowerCase();
      if (!hay.includes(state.searchQuery)) return false;
    }
    return true;
  });

  const sortMode = state.sortBy || 'phase';
  filtered.sort((a, b) => {
    if (sortMode === 'intraday') return (a.intradayChangePct || 0) - (b.intradayChangePct || 0);
    if (sortMode === 'swing') return (a.dipFromSwingHighPct || 0) - (b.dipFromSwingHighPct || 0);
    if (sortMode === 'name') return String(a.name).localeCompare(String(b.name), 'de');

    const pa = a.analysis?.phase ?? -9;
    const pb = b.analysis?.phase ?? -9;
    if (pb !== pa) return pb - pa;
    const ca = a.analysis?.confluenceCount ?? 0;
    const cb = b.analysis?.confluenceCount ?? 0;
    if (cb !== ca) return cb - ca;
    return (a.intradayChangePct || 0) - (b.intradayChangePct || 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:24px 12px;text-align:center;color:#71717a;font-size:12.5px;">Keine Aktie in diesem Filter gefunden.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((s) => {
      const p = s.analysis?.phase ?? 0;
      const isSelected = s.symbol === state.selectedSymbol;
      const tagClass = p === 4 ? 'p4' : p === 3 ? 'p3' : p === 2 ? 'p2' : p === 1 ? 'p1' : 'p0';
      const badgeLabel = p === 4
        ? `${iconSvg('dot-p4')} LEAD`
        : p === 3
          ? `${iconSvg('bolt')} BODEN`
          : p === 2
            ? `${iconSvg('eye')} LOD`
            : p === 1
              ? 'FALL'
              : '';
      const cardPhase = p >= 2 ? `phase-${p}` : '';
      const chg = Number(s.intradayChangePct || 0);
      const chgCls = chg >= 0 ? 'pos' : 'neg';

      return `<div class="stock-card ${cardPhase} ${isSelected ? 'selected' : ''}" data-symbol="${escapeHtml(s.symbol)}">
        <div class="sc-left">
          <div class="sc-title-line">
            <span class="sc-sym">${escapeHtml(s.symbol)}</span>
            ${s.isCustom ? `<span class="tr-custom-tag">EIGENE</span>` : ''}
            ${badgeLabel ? `<span class="phase-tag ${tagClass}">${badgeLabel}</span>` : ''}
          </div>
          <span class="sc-name">${escapeHtml(s.name)}</span>
        </div>
        <div class="sc-right-wrap">
          <div class="sc-right">
            <div class="sc-price">${Number(s.price || 0).toFixed(2)} €</div>
            <div class="sc-chg ${chgCls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %</div>
          </div>
          <button class="btn-remove-stock" data-remove-sym="${escapeHtml(s.symbol)}" title="${escapeHtml(s.name)} aus der Überwachung entfernen">
            ${iconSvg('x')}
          </button>
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.stock-card').forEach((el) => {
    el.addEventListener('click', (e) => {
      const rmBtn = e.target.closest('.btn-remove-stock');
      if (rmBtn) {
        e.stopPropagation();
        const rmSym = rmBtn.getAttribute('data-remove-sym');
        if (rmSym) removeStockFromWatchlist(rmSym);
        return;
      }
      const sym = el.getAttribute('data-symbol');
      state.selectedSymbol = sym;
      renderTopRadarStrip();
      renderStockList();
      loadChartForSymbol(sym, false);
      if (window.innerWidth <= 768) {
        document.getElementById('stockDetailCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// --- MAIN STAGE: HERO DETAILS, 4-PHASEN-BAR & M10 CHART ---

async function loadChartForSymbol(symbol, forceRefresh = false) {
  if (state.ws?.readyState === 1 && symbol) {
    state.ws.send(JSON.stringify({ type: 'WATCH_SYMBOL', symbol }));
  }
  const newsSymEl = document.getElementById('newsFilterSym');
  if (newsSymEl && symbol) newsSymEl.textContent = symbol;
  if (state.newsFilter === 'selected') {
    renderNewsFeed();
  }
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
  if (mhEl) {
    mhEl.textContent = rec.marketClock?.isOpen ? 'Geöffnet' : 'Geschlossen';
    mhEl.className = `tr-meta-pill ${rec.marketClock?.isOpen ? 'open' : 'closed'}`;
  }

  const f = rec.fundamentals || {};
  const peEl = document.getElementById('detailPeBadge');
  if (peEl) {
    peEl.textContent = f.peValue ? `KGV ${f.peValue}x` : 'Qualität';
  }

  const a = rec.analysis || {};
  const s = rec.sizing || {};
  const phase = a.phase ?? 0;

  const phaseBadgeEl = document.getElementById('detailPhaseBadge');
  if (phaseBadgeEl) {
    phaseBadgeEl.textContent = stripEmojis(a.phaseBadge || 'NEUTRAL');
    phaseBadgeEl.className = `tr-phase-pill p${phase >= 1 ? phase : 0}`;
  }

  document.getElementById('detailCurrentPrice').textContent = `${Number(rec.price || 0).toFixed(2)} €`;

  const chgEl = document.getElementById('detailIntradayChange');
  const chg = Number(rec.intradayChangePct || 0);
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)} % heute`;
  chgEl.className = `tr-delta ${chg >= 0 ? 'pos' : 'neg'}`;

  const swingEl = document.getElementById('detailSwingDip');
  const sw = Number(rec.dipFromSwingHighPct || 0);
  swingEl.textContent = `${sw.toFixed(1)} % v. 20T-Hoch`;

  document.getElementById('heroKpiLod').textContent = a.lodPrice ? `${a.lodPrice.toFixed(2)} €` : '--';
  document.getElementById('heroKpiSl').textContent = s.stopLossStock ? `${s.stopLossStock.toFixed(2)} €` : '--';
  const qtSl = document.getElementById('qtStopLoss');
  if (qtSl) qtSl.textContent = s.stopLossStock ? `${s.stopLossStock.toFixed(2)} €` : '--';
  document.getElementById('heroKpiLev').textContent = `${s.activeLeverage || 8}x Long`;
  document.getElementById('heroKpiBuy').textContent = s.positionSizeEuro ? `${Math.min(2500, s.positionSizeEuro).toFixed(0)} €` : '--';

  // 4-Phasen-Bar
  document.querySelectorAll('#phaseStepper [data-step]').forEach((stepEl) => {
    const sNum = Number(stepEl.getAttribute('data-step'));
    stepEl.className = 'tr-phase-step';
    if (phase > sNum) {
      stepEl.classList.add('passed');
    } else if (phase === sNum) {
      stepEl.classList.add(`current-${sNum}`);
    }
  });

  const actionBox = document.getElementById('phaseActionBox');
  actionBox.innerHTML = `<strong>${escapeHtml(a.phaseName || '')}:</strong> ${escapeHtml(a.actionText || '')}`;
  actionBox.style.borderLeftColor =
    phase === 4 ? '#00d09c' : phase === 3 ? '#f59e0b' : phase === 2 ? '#38bdf8' : phase === 1 ? '#ff4d4f' : '#3f3f46';

  document.getElementById('legEma20').textContent = a.ema20 ? `${a.ema20.toFixed(2)} €` : '--';
  document.getElementById('legRsi').textContent = a.rsi14 ? a.rsi14.toFixed(1) : '--';

  const confCount = a.confluenceCount || 0;
  const confBadge = document.getElementById('confluenceScoreBadge');
  if (confBadge) {
    confBadge.textContent = `${confCount}/4 Signale`;
    confBadge.style.color = confCount >= 2 ? '#00d09c' : '#a1a1aa';
  }
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
  const ctx = getActiveAccountContext();
  const isShort = ctx.isShort;
  const entryPrice = Number(sizing.entryPrice || state.chartRecord?.price || 0);
  const riskDist = Math.max(entryPrice * 0.012, Math.abs(entryPrice - Number(sizing.stopLossStock || 0)));
  const effectiveSl = isShort ? entryPrice + riskDist : Number(sizing.stopLossStock || 0);

  document.getElementById('heroKpiSl').textContent = `${effectiveSl.toFixed(2)} ${cur}`;
  const qtSl = document.getElementById('qtStopLoss');
  if (qtSl) qtSl.textContent = `${effectiveSl.toFixed(2)} ${cur}`;
  document.getElementById('heroKpiLev').textContent = `${sizing.activeLeverage}x ${isShort ? 'Short' : 'Long'}`;
  document.getElementById('heroKpiBuy').textContent = `${Math.min(2500, sizing.positionSizeEuro).toFixed(0)} €`;

  const buyBtnSpan = document.querySelector('#btnOpenTradeFromCalc span');
  if (buyBtnSpan) {
    buyBtnSpan.textContent = ctx.buyBtnLabel;
  }
}

// --- AKTIVE INVESTMENTS & HISTORIE (TRADE REPUBLIC STIL) ---

async function openActiveTradeFromCalculator() {
  const symbol = state.selectedSymbol || 'SY1.DE';
  const entryPrice = Number(document.getElementById('calcEntryPrice').value);
  const lodPrice = Number(document.getElementById('calcLodPrice').value);
  const s = state.chartRecord?.sizing;

  const res = await fetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account: state.activeAccountMode,
      symbol,
      name: state.chartRecord?.name || symbol,
      currency: state.chartRecord?.currency || 'EUR',
      entryPrice,
      lodPrice,
      stopLossStock: s?.stopLossStock || lodPrice * 0.998,
      leverage: s?.activeLeverage || 8,
      positionSizeEuro: Math.min(2500, s?.positionSizeEuro || 2500)
    })
  });
  const data = await res.json();
  if (data.snapshot) {
    applySnapshot(data.snapshot);
    document.querySelector('[data-wbtab="trades"]')?.click();
  }
}

function renderActiveTradesAndJournal() {
  const ctx = getActiveAccountContext();
  const isShort = ctx.isShort;
  const trades = ctx.activeTrades || [];
  const journal = ctx.journal || [];
  document.getElementById('activeTradesCount').textContent = trades.length;
  const closedBadge = document.getElementById('closedTradesBadge');
  if (closedBadge) closedBadge.textContent = journal.length;

  const tradesContainer = document.getElementById('activeTradesList');
  if (trades.length === 0) {
    tradesContainer.innerHTML = `<div style="padding:20px;text-align:center;color:#71717a;font-size:13px;">
      ${escapeHtml(ctx.emptyActiveMsg)}
    </div>`;
  } else {
    tradesContainer.innerHTML = trades
      .map((t) => {
        const ev = t.latestEvaluation || {};
        const pnlEuro = Number(ev.pnlEuro || 0);
        const derivPct = Number(ev.derivGainPct || 0);
        const rMult = Number(ev.rMultiple || 0);
        const pnlColor = pnlEuro >= 0 ? '#00d09c' : '#ff4d4f';
        const curPrice = Number(ev.currentPrice || t.entryPrice);
        const slPrice = Number(ev.recommendedStopStock || t.stopLossStock);
        const dirBadge = t.direction === 'SHORT' || isShort ? 'SHORT' : 'LONG';

        return `<div class="tr-pos-row" data-pos-sym="${escapeHtml(t.symbol)}">
          <div class="tr-pos-left">
            <div class="tr-pos-title">
              <span>${escapeHtml(t.name)}</span>
              <span class="tr-meta-pill">${escapeHtml(t.symbol)} · ${t.leverage}x ${dirBadge}</span>
            </div>
            <div class="tr-pos-sub">
              Einsatz ${Number(t.positionSizeEuro || 0).toFixed(0)} € · Kurs ${curPrice.toFixed(2)} € (Entry ${Number(t.entryPrice).toFixed(2)} € · SL ${slPrice.toFixed(2)} €)
            </div>
          </div>
          <div class="tr-pos-right">
            <div>
              <div class="tr-pos-pnl" style="color:${pnlColor}">${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(2)} €</div>
              <div class="tr-pos-r">${derivPct >= 0 ? '+' : ''}${derivPct.toFixed(1)} % · ${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R</div>
            </div>
            <button class="tr-chip-btn btn-close-trade" data-id="${escapeHtml(t.id)}" title="Position sofort glattstellen">
              ${escapeHtml(ctx.closeLabel)}
            </button>
          </div>
        </div>`;
      })
      .join('');

    tradesContainer.querySelectorAll('.tr-pos-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-close-trade')) return;
        const sym = row.getAttribute('data-pos-sym');
        if (sym) {
          state.selectedSymbol = sym;
          renderTopRadarStrip();
          renderStockList();
          loadChartForSymbol(sym, false);
        }
      });
    });

    tradesContainer.querySelectorAll('.btn-close-trade').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const res = await fetch(`/api/trades/${encodeURIComponent(id)}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: state.activeAccountMode,
            exitReason: ctx.manualExitReason
          })
        });
        const data = await res.json();
        if (data.snapshot) applySnapshot(data.snapshot);
      });
    });
  }

  const journalContainer = document.getElementById('journalList');
  if (journal.length === 0) {
    journalContainer.innerHTML = `<div style="padding:20px;text-align:center;color:#71717a;font-size:13px;">${escapeHtml(ctx.emptyJournalMsg)}</div>`;
  } else {
    journalContainer.innerHTML = journal
      .slice(0, 35)
      .map((j) => {
        const win = j.pnlEuro >= 0;
        const pnlColor = win ? '#00d09c' : '#ff4d4f';
        const timeStr = j.closedAt ? new Date(j.closedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
        const dirBadge = j.direction === 'SHORT' || isShort ? 'SHORT' : 'LONG';
        return `<div class="tr-pos-row">
          <div class="tr-pos-left">
            <div class="tr-pos-title">
              <span>${escapeHtml(j.name)} (${escapeHtml(j.symbol)})</span>
              <span class="tr-meta-pill">${j.leverage}x ${dirBadge}</span>
            </div>
            <div class="tr-pos-sub">
              ${Number(j.entryPrice).toFixed(2)} € → ${Number(j.exitPrice).toFixed(2)} € · ${escapeHtml(j.exitReason || 'Exit')} ${timeStr ? `(${timeStr})` : ''}
            </div>
          </div>
          <div class="tr-pos-right">
            <div>
              <div class="tr-pos-pnl" style="color:${pnlColor}">${win ? '+' : ''}${Number(j.pnlEuro).toFixed(2)} €</div>
              <div class="tr-pos-r">${win ? '+' : ''}${Number(j.rMultiple).toFixed(2)}R · ${j.derivGainPct >= 0 ? '+' : ''}${j.derivGainPct} %</div>
            </div>
          </div>
        </div>`;
      })
      .join('');
  }
}

function renderDailyAccountsHistory({ preserveScroll = false } = {}) {
  const listEl = document.getElementById('dailyAccountsHistoryList');
  const detailEl = document.getElementById('dailySelectedDayTradesBox');
  if (!listEl || !detailEl) return;

  const ds = state.snapshot?.dailySession;
  const archived = state.snapshot?.dailyAccountsHistory || [];
  const days = [];

  if (ds && ds.date) {
    const la = ds.longAccount || {};
    const sa = ds.shortAccount || {};
    days.push({
      date: ds.date,
      isToday: true,
      longSummary: {
        initialBalanceEuro: la.initialBalanceEuro || 10000,
        endEquityEuro: la.totalEquityEuro ?? 10000,
        dailyPnlEuro: la.totalReturnEuro ?? 0,
        dailyReturnPct: la.totalReturnPct ?? 0,
        totalTrades: (la.closedTradesCount || 0) + (ds.longActiveTrades?.length || 0),
        wins: la.wins || 0,
        losses: la.losses || 0,
        winRatePct: la.winRatePct || 0
      },
      shortSummary: {
        initialBalanceEuro: sa.initialBalanceEuro || 10000,
        endEquityEuro: sa.totalEquityEuro ?? 10000,
        dailyPnlEuro: sa.totalReturnEuro ?? 0,
        dailyReturnPct: sa.totalReturnPct ?? 0,
        totalTrades: (sa.closedTradesCount || 0) + (ds.shortActiveTrades?.length || 0),
        wins: sa.wins || 0,
        losses: sa.losses || 0,
        winRatePct: sa.winRatePct || 0
      },
      longTrades: [
        ...(ds.longActiveTrades || []).map((t) => ({ ...t, _isOpen: true, _side: 'long' })),
        ...(ds.longJournal || []).map((t) => ({ ...t, _isOpen: false, _side: 'long' }))
      ],
      shortTrades: [
        ...(ds.shortActiveTrades || []).map((t) => ({ ...t, _isOpen: true, _side: 'short' })),
        ...(ds.shortJournal || []).map((t) => ({ ...t, _isOpen: false, _side: 'short' }))
      ]
    });
  }

  for (const h of archived) {
    if (!h?.date || (ds && h.date === ds.date)) continue;
    days.push({
      date: h.date,
      isToday: false,
      longSummary: h.longSummary || {},
      shortSummary: h.shortSummary || {},
      longTrades: (h.longTrades || []).map((t) => ({ ...t, _isOpen: false, _side: 'long' })),
      shortTrades: (h.shortTrades || []).map((t) => ({ ...t, _isOpen: false, _side: 'short' }))
    });
  }

  const dailyBadge = document.getElementById('dailyHistoryCountBadge');
  if (dailyBadge) dailyBadge.textContent = days.length;

  if (days.length === 0) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#71717a;font-size:13px;">Noch keine Tages-Historie vorhanden.</div>`;
    detailEl.classList.add('hidden');
    return;
  }

  if (!state.selectedDailyDate || !days.some((d) => d.date === state.selectedDailyDate)) {
    state.selectedDailyDate = days[0].date;
  }

  const fmtEuro = (val) =>
    `${Number(val || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  const prevListScroll = preserveScroll ? listEl.scrollTop : 0;
  listEl.innerHTML = days
    .map((d) => {
      const lPnl = Number(d.longSummary.dailyPnlEuro || 0);
      const lPct = Number(d.longSummary.dailyReturnPct || 0);
      const lCol = lPnl > 0 ? '#00d09c' : lPnl < 0 ? '#ff4d4f' : '#a1a1aa';

      const sPnl = Number(d.shortSummary.dailyPnlEuro || 0);
      const sPct = Number(d.shortSummary.dailyReturnPct || 0);
      const sCol = sPnl > 0 ? '#00d09c' : sPnl < 0 ? '#ff4d4f' : '#a1a1aa';

      const activeCls = d.date === state.selectedDailyDate ? 'active' : '';
      return `<div class="tr-daily-day-row ${activeCls}" data-daily-date="${escapeHtml(d.date)}">
        <div class="tr-daily-date-col">
          <span class="tr-daily-date-main">${escapeHtml(formatGermanDateShort(d.date))}</span>
          <span class="tr-daily-date-badge">${d.isToday ? 'Heute · Live' : 'Abgeschlossen'}</span>
        </div>
        <div class="tr-daily-side-col">
          <span class="tr-daily-side-label">
            <span class="tr-acc-badge daily-long">Tages-Long</span>
            <span>${d.longSummary.wins || 0}W · ${d.longSummary.losses || 0}L</span>
          </span>
          <span class="tr-daily-side-val" style="color:${lCol}">
            ${fmtEuro(d.longSummary.endEquityEuro)} (${lPnl >= 0 ? '+' : ''}${fmtEuro(lPnl)} · ${lPct >= 0 ? '+' : ''}${lPct.toFixed(1)}%)
          </span>
        </div>
        <div class="tr-daily-side-col">
          <span class="tr-daily-side-label">
            <span class="tr-acc-badge daily-short">Tages-Short</span>
            <span>${d.shortSummary.wins || 0}W · ${d.shortSummary.losses || 0}L</span>
          </span>
          <span class="tr-daily-side-val" style="color:${sCol}">
            ${fmtEuro(d.shortSummary.endEquityEuro)} (${sPnl >= 0 ? '+' : ''}${fmtEuro(sPnl)} · ${sPct >= 0 ? '+' : ''}${sPct.toFixed(1)}%)
          </span>
        </div>
      </div>`;
    })
    .join('');

  if (preserveScroll) listEl.scrollTop = prevListScroll;

  listEl.querySelectorAll('.tr-daily-day-row').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedDailyDate = row.getAttribute('data-daily-date');
      renderDailyAccountsHistory();
    });
  });

  // Render Individual Trades for Selected Day
  const selectedDay = days.find((d) => d.date === state.selectedDailyDate) || days[0];
  detailEl.classList.remove('hidden');

  const combinedTrades = [
    ...(selectedDay.longTrades || []),
    ...(selectedDay.shortTrades || [])
  ].sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0));

  const visibleTrades = combinedTrades.filter((t) => {
    if (state.selectedDailySide === 'long') return t._side === 'long';
    if (state.selectedDailySide === 'short') return t._side === 'short';
    return true;
  });

  const prevDetailScroll = preserveScroll
    ? detailEl.querySelector('.tr-daily-trade-list')?.scrollTop || 0
    : 0;

  detailEl.innerHTML = `
    <div class="tr-daily-detail-head">
      <div class="tr-daily-detail-title">
        <span>Einzel-Trades vom ${escapeHtml(formatGermanDateShort(selectedDay.date))}</span>
        <span class="tr-meta-pill">${combinedTrades.length} Trades gesamt</span>
      </div>
      <div class="tr-daily-detail-pills">
        <button type="button" class="tr-filter-chip ${state.selectedDailySide === 'all' ? 'active' : ''}" data-dailyside="all">Alle (${combinedTrades.length})</button>
        <button type="button" class="tr-filter-chip ${state.selectedDailySide === 'long' ? 'active' : ''}" data-dailyside="long">Long (${selectedDay.longTrades.length})</button>
        <button type="button" class="tr-filter-chip ${state.selectedDailySide === 'short' ? 'active' : ''}" data-dailyside="short">Short (${selectedDay.shortTrades.length})</button>
      </div>
    </div>
    <div class="tr-list tr-daily-trade-list">
      ${visibleTrades.length === 0
        ? `<div style="padding:16px;text-align:center;color:#71717a;font-size:12.5px;">Keine Trades für diesen Filter am ${escapeHtml(formatGermanDateShort(selectedDay.date))}.</div>`
        : visibleTrades.map((t) => {
            const isOpen = Boolean(t._isOpen);
            const ev = t.latestEvaluation || {};
            const pnl = isOpen ? Number(ev.pnlEuro || 0) : Number(t.pnlEuro || 0);
            const rMult = isOpen ? Number(ev.rMultiple || 0) : Number(t.rMultiple || 0);
            const derivPct = isOpen ? Number(ev.derivGainPct || 0) : Number(t.derivGainPct || 0);
            const curOrExit = isOpen ? Number(ev.currentPrice || t.entryPrice) : Number(t.exitPrice || t.entryPrice);
            const pnlColor = pnl >= 0 ? '#00d09c' : '#ff4d4f';
            const dirLabel = t._side === 'short' ? 'SHORT' : 'LONG';
            const badgeCls = t._side === 'short' ? 'daily-short' : 'daily-long';
            const timeStr = (t.closedAt || t.openedAt)
              ? new Date(t.closedAt || t.openedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
              : '';
            const statusDesc = isOpen ? 'OFFEN (Live)' : escapeHtml(t.exitReason || 'Geschlossen');

            return `<div class="tr-pos-row">
              <div class="tr-pos-left">
                <div class="tr-pos-title">
                  <span class="tr-acc-badge ${badgeCls}">${t.leverage || 8}x ${dirLabel}</span>
                  <span>${escapeHtml(t.name || t.symbol)} (${escapeHtml(t.symbol)})</span>
                </div>
                <div class="tr-pos-sub">
                  Einsatz ${Number(t.positionSizeEuro || 0).toFixed(0)} € · ${Number(t.entryPrice || 0).toFixed(2)} € → ${curOrExit.toFixed(2)} € · ${statusDesc} ${timeStr ? `(${timeStr})` : ''}
                </div>
              </div>
              <div class="tr-pos-right">
                <div>
                  <div class="tr-pos-pnl" style="color:${pnlColor}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} €</div>
                  <div class="tr-pos-r">${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R · ${derivPct >= 0 ? '+' : ''}${Number(derivPct).toFixed(1)} %</div>
                </div>
              </div>
            </div>`;
          }).join('')}
    </div>
  `;

  if (preserveScroll) {
    const tl = detailEl.querySelector('.tr-daily-trade-list');
    if (tl) tl.scrollTop = prevDetailScroll;
  }

  detailEl.querySelectorAll('[data-dailyside]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDailySide = btn.getAttribute('data-dailyside') || 'all';
      renderDailyAccountsHistory();
    });
  });
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
  document.getElementById('bannerBadge').textContent = stripEmojis(alert.phaseBadge || `PHASE ${alert.phase || 4}`);
  document.getElementById('bannerTitle').textContent = stripEmojis(alert.title);
  document.getElementById('bannerSub').textContent = stripEmojis(alert.message);
  document.getElementById('bannerDelivery').innerHTML = alert.delivery?.telegram?.ok
    ? `${iconSvg('check')} Web + @PureSiteTrading_bot`
    : `${iconSvg('bell')} Web Live-Alarm`;

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
      new Notification(stripEmojis(alert.title), { body: stripEmojis(alert.message) });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(stripEmojis(alert.title), { body: stripEmojis(alert.message) });
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
    document.getElementById('bannerDelivery').innerHTML =
      `${iconSvg('check')} Web + @PureSiteTrading_bot`;
  }
}

function renderAlertsHistory() {
  const list = state.snapshot?.alerts || [];
  document.getElementById('alertsCount').textContent = list.length;
  const container = document.getElementById('alertsHistoryList');

  if (list.length === 0) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:#71717a;font-size:13px;">
      Noch keine Signale ausgelöst.
    </div>`;
    return;
  }

  container.innerHTML = list
    .slice(0, 20)
    .map((a) => {
      const timeStr = new Date(a.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const tgOk = a.delivery?.telegram?.ok;
      const badgeText = stripEmojis(a.phaseBadge || 'SIGNAL');

      return `<div class="tr-pos-row alert-item" data-symbol="${escapeHtml(a.symbol || '')}">
        <div class="tr-pos-left">
          <div class="tr-pos-title">
            <span class="phase-tag p${a.phase || 4}">${iconSvg(a.phase === 4 ? 'dot-p4' : 'bell')} ${escapeHtml(badgeText)}</span>
            <span>${escapeHtml(stripEmojis(a.title))}</span>
          </div>
          <div class="tr-pos-sub">${escapeHtml(stripEmojis(a.message))}</div>
        </div>
        <div class="tr-pos-right">
          <div class="tr-pos-r" style="display:inline-flex;align-items:center;gap:4px;">${timeStr} · ${tgOk ? `${iconSvg('check')} Telegram` : 'Web'}</div>
        </div>
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
        document.querySelector('[data-wbtab="trades"]')?.click();
      } else if (stage === 'stagnation_exit') {
        document.querySelector('[data-wbtab="journal"]')?.click();
      }
    }
  } catch (err) {
    console.error('Simulations-Fehler:', err);
  }
}

async function addStockFromInput() {
  const input = document.getElementById('inputAddSymbol');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  input.value = '';
  closeSettingsModal();
  await addStockToWatchlist(val);
}

async function addStockToWatchlist(symbolOrPayload) {
  if (!symbolOrPayload) return;
  const quickInput = document.getElementById('inputWatchlistQuickAdd');
  const sugBox = document.getElementById('watchlistSearchSuggestions');
  sugBox?.classList.add('hidden');

  const body = typeof symbolOrPayload === 'string'
    ? { symbol: symbolOrPayload.trim() }
    : symbolOrPayload;

  if (!body.symbol) return;
  if (quickInput) quickInput.value = '';

  const btn = document.getElementById('btnWatchlistQuickAdd');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.snapshot) {
      const addedSym = data.stock?.symbol || String(body.symbol).toUpperCase();
      state.selectedSymbol = addedSym;
      applySnapshot(data.snapshot);
      loadChartForSymbol(addedSym, false);
    }
  } catch (err) {
    console.error('Fehler beim Hinzufügen zur Überwachung:', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removeStockFromWatchlist(symbol) {
  const clean = String(symbol || '').trim().toUpperCase();
  if (!clean) return;
  try {
    const res = await fetch(`/api/watchlist/${encodeURIComponent(clean)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.snapshot) {
      if (state.selectedSymbol === clean) {
        const nextStock = (data.snapshot.stocks || [])[0];
        state.selectedSymbol = nextStock ? nextStock.symbol : '';
        state.chartBars = [];
      }
      applySnapshot(data.snapshot);
      if (state.selectedSymbol) {
        loadChartForSymbol(state.selectedSymbol, false);
      }
    }
  } catch (err) {
    console.error('Fehler beim Entfernen aus der Überwachung:', err);
  }
}

async function restoreDefaultWatchlist() {
  try {
    const res = await fetch('/api/watchlist/restore', { method: 'POST' });
    const data = await res.json();
    if (data.snapshot) {
      applySnapshot(data.snapshot);
    }
  } catch (err) {
    console.error('Restore-Fehler:', err);
  }
}

function handleWatchlistAutocompleteInput(rawVal) {
  const q = String(rawVal || '').trim();
  const sugBox = document.getElementById('watchlistSearchSuggestions');
  if (!sugBox) return;

  if (state.searchTimer) clearTimeout(state.searchTimer);
  if (q.length < 2) {
    sugBox.classList.add('hidden');
    sugBox.innerHTML = '';
    return;
  }

  state.searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) {
        sugBox.classList.add('hidden');
        return;
      }

      const watchedSet = new Set((state.snapshot?.stocks || []).map((s) => s.symbol));
      sugBox.innerHTML = results
        .map((item) => {
          const alreadyWatched = watchedSet.has(item.symbol);
          return `<div class="tr-sug-item" data-sug-sym="${escapeHtml(item.symbol)}" data-sug-name="${escapeHtml(item.name)}" data-sug-index="${escapeHtml(item.index)}" data-sug-sector="${escapeHtml(item.sector)}" data-sug-cur="${escapeHtml(item.currency)}">
            <div class="tr-sug-left">
              <span class="tr-sug-sym">${escapeHtml(item.symbol)} · <span style="color:#a1a1aa;font-weight:500">${escapeHtml(item.exchange || item.index)}</span></span>
              <span class="tr-sug-name">${escapeHtml(item.name)}</span>
            </div>
            <span class="tr-sug-meta">${alreadyWatched ? 'Überwacht' : '+ Überwachen'}</span>
          </div>`;
        })
        .join('');
      sugBox.classList.remove('hidden');

      sugBox.querySelectorAll('.tr-sug-item').forEach((row) => {
        row.addEventListener('click', () => {
          addStockToWatchlist({
            symbol: row.getAttribute('data-sug-sym'),
            name: row.getAttribute('data-sug-name'),
            index: row.getAttribute('data-sug-index'),
            sector: row.getAttribute('data-sug-sector'),
            currency: row.getAttribute('data-sug-cur')
          });
        });
      });
    } catch {
      sugBox.classList.add('hidden');
    }
  }, 240);
}

// --- AUTOMATISCHER NEWS TRACKER ---

async function fetchNewsFromServer({ symbol = null, forceRefresh = false } = {}) {
  try {
    const params = new URLSearchParams();
    if (symbol) params.set('symbol', symbol);
    if (forceRefresh) params.set('refresh', '1');
    const res = await fetch(`/api/news?${params.toString()}`);
    const data = await res.json();
    if (Array.isArray(data.news) && state.snapshot) {
      state.snapshot.news = data.news;
      renderNewsFeed();
    }
  } catch (err) {
    console.error('News-Ladefehler:', err);
  }
}

function formatRelativeTimeDe(isoOrTs) {
  const ts = typeof isoOrTs === 'number' ? isoOrTs * 1000 : new Date(isoOrTs).getTime();
  if (!Number.isFinite(ts)) return '';
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  const diffDays = Math.round(diffHours / 24);
  return `vor ${diffDays} T.`;
}

function renderNewsFeed() {
  const container = document.getElementById('newsFeedList');
  const countBadge = document.getElementById('newsCountBadge');
  if (!container) return;

  const allNews = state.snapshot?.news || [];
  if (countBadge) countBadge.textContent = allNews.length;

  const symEl = document.getElementById('newsFilterSym');
  if (symEl && state.selectedSymbol) symEl.textContent = state.selectedSymbol;

  const openTradeSymbols = new Set((state.snapshot?.activeTrades || []).map((t) => t.symbol));
  const filtered = allNews.filter((item) => {
    if (state.newsFilter === 'selected' && state.selectedSymbol) {
      const matchPrimary = item.symbol === state.selectedSymbol || item.querySymbol === state.selectedSymbol;
      const matchRel = Array.isArray(item.relatedTickers) && item.relatedTickers.includes(state.selectedSymbol);
      return matchPrimary || matchRel;
    }
    if (state.newsFilter === 'leads') {
      return (item.phase && item.phase >= 2) || openTradeSymbols.has(item.symbol);
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:24px 14px;text-align:center;color:#71717a;font-size:13px;">
      Keine aktuellen News für diesen Filter gefunden. Klicke oben rechts auf „Aktualisieren“.
    </div>`;
    return;
  }

  container.innerHTML = filtered
    .slice(0, 30)
    .map((n) => {
      const relTime = formatRelativeTimeDe(n.publishTs || n.publishedAt);
      const chg = Number(n.intradayChangePct);
      const hasChg = Number.isFinite(chg);
      const chgColor = chg >= 0 ? '#00d09c' : '#ff4d4f';
      const p = n.phase || 0;
      const phaseBadge = p === 4
        ? `<span class="phase-tag p4">${iconSvg('dot-p4')} LEAD</span>`
        : p === 3
          ? `<span class="phase-tag p3">${iconSvg('bolt')} BODEN</span>`
          : p === 2
            ? `<span class="phase-tag p2">${iconSvg('eye')} LOD</span>`
            : '';

      return `<a href="${escapeHtml(n.link)}" target="_blank" rel="noopener" class="tr-news-row">
        <div class="tr-news-main">
          <div class="tr-news-meta">
            <button type="button" class="tr-news-sym-btn" data-news-sym="${escapeHtml(n.symbol || '')}" title="Aktie im Chart öffnen">
              ${escapeHtml(n.symbol || 'MARKT')}
            </button>
            ${phaseBadge}
            ${hasChg ? `<span style="color:${chgColor};font-weight:700;">${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %</span>` : ''}
            <span>·</span>
            <span>${escapeHtml(n.publisher || 'Finanz-News')}</span>
            <span>·</span>
            <span>${escapeHtml(relTime)}</span>
          </div>
          <div class="tr-news-title">${escapeHtml(stripEmojis(n.title))}</div>
        </div>
        <span class="tr-news-ext">
          <svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
        </span>
      </a>`;
    })
    .join('');

  container.querySelectorAll('.tr-news-sym-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sym = btn.getAttribute('data-news-sym');
      if (sym) {
        state.selectedSymbol = sym;
        renderTopRadarStrip();
        renderStockList();
        loadChartForSymbol(sym, false);
      }
    });
  });
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
  fb.innerHTML = `${iconSvg('search')} Suche nach deiner Nachricht an @PureSiteTrading_bot...`;

  try {
    const res = await fetch('/api/telegram/detect-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramBotToken: token })
    });
    const data = await res.json();
    if (data.found) {
      document.getElementById('setTelegramChatId').value = data.chatId;
      fb.style.borderColor = '#00d09c';
      fb.innerHTML = `${iconSvg('check')} <b>Chat-ID erkannt:</b> <code>${escapeHtml(data.chatId)}</code> (${escapeHtml(data.chatTitle)}) – ab sofort gekoppelt.`;
      if (state.snapshot?.settings) {
        state.snapshot.settings.telegramBotToken = token;
        state.snapshot.settings.telegramChatId = data.chatId;
        updateTelegramStatusUI();
      }
    } else {
      fb.style.borderColor = '#f59e0b';
      fb.innerHTML = `${iconSvg('alert')} Noch keine Nachricht gefunden. Bitte klicke auf <a href="https://t.me/PureSiteTrading_bot?start=connect" target="_blank" style="color:#38bdf8;font-weight:700">@PureSiteTrading_bot öffnen</a> und drücke dort auf <b>Starten</b>.`;
    }
  } catch (err) {
    fb.style.borderColor = '#ff4d4f';
    fb.innerHTML = `${iconSvg('x')} Fehler: ${escapeHtml(err.message)}`;
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
      fb.style.borderColor = '#00d09c';
      fb.innerHTML = `${iconSvg('check')} <b>Test-Alarm gleichzeitig an Web-Dashboard UND @PureSiteTrading_bot (Chat ${escapeHtml(tg.chatId)}) gesendet.</b>`;
    } else {
      fb.style.borderColor = '#f59e0b';
      fb.innerHTML = `${iconSvg('bell')} <b>Web-Dashboard-Alarm ausgelöst.</b> Für Telegram: Klicke erst auf <a href="https://t.me/PureSiteTrading_bot?start=connect" target="_blank" style="color:#38bdf8;font-weight:700">@PureSiteTrading_bot öffnen</a> und sende <code>/start</code>.`;
    }
  }
}

function iconSvg(name) {
  switch (name) {
    case 'dot-p4':
      return `<span class="tr-dot-ind p4"></span>`;
    case 'bolt':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
    case 'eye':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
    case 'check':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'bell':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
    case 'search':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    case 'alert':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
    case 'x':
      return `<svg class="tr-ico tr-ico-xs" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    default:
      return '';
  }
}

function stripEmojis(str) {
  return String(str ?? '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
