/**
 * Frontend-Applikation für das Antizyklische Mean-Reversion-Strategie Playbook Tool
 * - Echtzeit-WebSocket-Empfang (parallel zu Telegram)
 * - Akustischer WebAudio-Signalton & Browser-Benachrichtigungen
 * - Interaktiver 10-Minuten-Kerzenchart (M10) mit EMA 20, VWAP, Tagestief (LoD), Stop-Loss & RSI(14)
 * - 4-Phasen-Stepper, 4 Konfluenz-Signale & 9-Punkte Pre-Trade-Checkliste
 * - 5%-Risiko- & Knock-Out-Derivate-Rechner (Hebel 5x–10x) + Stagnations-Exit-Überwachung
 */

const state = {
  snapshot: null,
  selectedSymbol: 'SY1.DE',
  activeFilter: 'all',
  searchQuery: '',
  chartBars: [],
  chartRecord: null,
  hoverBarIndex: null,
  ws: null
};

// --- INITIALISIERUNG ---
document.addEventListener('DOMContentLoaded', () => {
  bindUIEvents();
  connectWebSocket();
  fetchInitialSnapshot();
  window.addEventListener('resize', () => renderM10CanvasChart());
});

function bindUIEvents() {
  // Jetzt scannen
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
      btn.textContent = '↻ Jetzt Scannen';
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

  // Phasen-Filter Tabs
  document.querySelectorAll('#phaseFilterTabs .filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#phaseFilterTabs .filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeFilter = tab.getAttribute('data-filter');
      renderStockList();
    });
  });

  // Suche
  document.getElementById('inputSearchStock').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderStockList();
  });

  // Aktie zur Watchlist hinzufügen
  document.getElementById('btnAddSymbol').addEventListener('click', addStockFromInput);
  document.getElementById('inputAddSymbol').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addStockFromInput();
  });

  // Chart aktualisieren
  document.getElementById('btnRefreshChart').addEventListener('click', () => {
    if (state.selectedSymbol) loadChartForSymbol(state.selectedSymbol, true);
  });

  // Rechte Spalte Tabs
  document.querySelectorAll('.right-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-rtab');
      document.querySelectorAll('.right-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.rtab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`rtab-${target}`).classList.add('active');
    });
  });

  // 5%-Risiko-Rechner Inputs
  ['calcCapital', 'calcRiskPct', 'calcEntryPrice', 'calcLodPrice', 'calcNoiseBuffer', 'calcLeverage', 'calcCertPrice', 'calcCertRatio'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalculateSizingFromInputs);
    document.getElementById(id).addEventListener('change', recalculateSizingFromInputs);
  });

  // Trade aus Rechner aktivieren
  document.getElementById('btnOpenTradeFromCalc').addEventListener('click', openActiveTradeFromCalculator);

  // Live Alert Banner Buttons
  document.getElementById('btnBannerClose').addEventListener('click', () => {
    document.getElementById('liveAlertBanner').classList.add('hidden');
  });

  // Test-Alarm Button
  document.getElementById('btnTriggerTestAlert').addEventListener('click', triggerTestAlert);
  document.getElementById('btnModalTestAlert').addEventListener('click', triggerTestAlert);

  // Settings Modal
  document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnCancelSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettingsFromModal);
  document.getElementById('btnDetectChatId').addEventListener('click', detectTelegramChatId);

  // Canvas Hover für M10-Kerzen-Details
  const canvas = document.getElementById('m10ChartCanvas');
  canvas.addEventListener('mousemove', handleCanvasMouseMove);
  canvas.addEventListener('mouseleave', () => {
    state.hoverBarIndex = null;
    document.getElementById('chartTooltip').classList.add('hidden');
    renderM10CanvasChart();
  });
}

// --- WEBSOCKET & SNAPSHOT ---

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => {
    document.getElementById('wsStatusDot').classList.remove('scanning');
    document.getElementById('scanStatusText').textContent = 'Live verbunden';
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
          document.getElementById('scanStatusText').textContent = 'Scanne M10-Charts...';
        }
      } else if (data.type === 'LIVE_ALERT') {
        handleIncomingLiveAlert(data.alert);
      } else if (data.type === 'ALERT_DELIVERY_UPDATE') {
        updateAlertDeliveryInHistory(data.alertId, data.delivery);
      } else if (data.type === 'SETTINGS_UPDATED') {
        if (state.snapshot) {
          state.snapshot.settings = data.settings;
          updateTelegramBadge();
        }
      }
    } catch (err) {
      console.error('WS Nachricht Fehler:', err);
    }
  };

  ws.onclose = () => {
    document.getElementById('scanStatusText').textContent = 'Verbindung getrennt – Verbinde neu...';
    setTimeout(connectWebSocket, 3000);
  };
}

async function fetchInitialSnapshot() {
  try {
    const res = await fetch('/api/snapshot');
    const snap = await res.json();
    applySnapshot(snap);
  } catch (err) {
    console.error('Fehler beim Laden des Snapshots:', err);
  }
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;

  const dot = document.getElementById('wsStatusDot');
  if (snapshot.isScanning) {
    dot.classList.add('scanning');
    document.getElementById('scanStatusText').textContent = 'Scanne M10-Charts...';
  } else {
    dot.classList.remove('scanning');
    const t = snapshot.lastScanAt
      ? new Date(snapshot.lastScanAt).toLocaleTimeString('de-DE')
      : 'Bereit';
    document.getElementById('scanStatusText').textContent = `Live · Letzter Scan: ${t}`;
  }

  updateTelegramBadge();
  renderIndexRegimes();
  renderStockList();
  renderActiveTradesAndJournal();
  renderAlertsHistory();

  // Falls noch keine Aktie ausgewählt ist, wähle die erste (höchste Phase)
  if (!state.selectedSymbol && snapshot.stocks && snapshot.stocks.length > 0) {
    state.selectedSymbol = snapshot.stocks[0].symbol;
  }
  if (state.selectedSymbol) {
    const rec = (snapshot.stocks || []).find((s) => s.symbol === state.selectedSymbol);
    if (rec) {
      renderSelectedStockDetails(rec);
    }
    if (state.chartBars.length === 0) {
      loadChartForSymbol(state.selectedSymbol, false);
    }
  }
}

function updateTelegramBadge() {
  const s = state.snapshot?.settings || {};
  const el = document.getElementById('tgStatusIndicator');
  if (s.telegramBotToken && s.telegramChatId && s.telegramEnabled !== false) {
    el.textContent = `📲 Telegram Verbunden (${s.telegramChatId}) · ⚙️ Setup`;
  } else {
    el.textContent = `⚙️ Telegram & Risiko-Setup`;
  }
}

// --- GESAMTMARKT-REGIME BAR (KAPITEL 2.3) ---

function renderIndexRegimes() {
  const container = document.getElementById('indexRegimeItems');
  const regimes = state.snapshot?.indexRegimes || {};
  const entries = Object.values(regimes);

  if (entries.length === 0) {
    container.innerHTML = `<span class="muted">Leitindizes werden geprüft...</span>`;
    return;
  }

  container.innerHTML = entries
    .map((r) => {
      const sign = r.changePct >= 0 ? '+' : '';
      const cls = r.isFallingHard ? 'warn' : 'ok';
      const icon = r.isFallingHard ? '⚠️' : '🟢';
      return `<div class="regime-chip ${cls}" title="${escapeHtml(r.summary)}">
        <span>${icon} <b>${escapeHtml(r.name)}</b></span>
        <span>${sign}${Number(r.changePct || 0).toFixed(2)}%</span>
      </div>`;
    })
    .join('');
}

// --- LINKE SPALTE: AKTIEN-LISTE ---

function renderStockList() {
  const container = document.getElementById('stockListContainer');
  const stocks = state.snapshot?.stocks || [];
  document.getElementById('universeCountLabel').textContent = `${stocks.length} Qualitätsaktien überwacht`;

  const filtered = stocks.filter((s) => {
    const phase = s.analysis?.phase ?? 0;
    if (state.activeFilter === 'phase4' && phase !== 4) return false;
    if (state.activeFilter === 'phase3' && phase !== 3) return false;
    if (state.activeFilter === 'phase2' && phase !== 2) return false;
    if (state.activeFilter === 'dips' && (s.intradayChangePct > -2.0 && s.dipFromSwingHighPct > -3.5)) return false;

    if (state.searchQuery) {
      const hay = `${s.symbol} ${s.name} ${s.indexName} ${s.sector}`.toLowerCase();
      if (!hay.includes(state.searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="muted" style="padding:14px;text-align:center;">
      Keine Aktien für diesen Filter gefunden.<br/>
      Tipp: Klicke oben rechts auf <b>„⚡ Fallstudie (Kap. 08) & Alarm testen“</b>, um ein komplettes Phase-4-Setup live zu sehen!
    </div>`;
    return;
  }

  container.innerHTML = filtered
    .map((s) => {
      const p = s.analysis?.phase ?? 0;
      const isSelected = s.symbol === state.selectedSymbol;
      const pillClass = p === 4 ? 'p4' : p === 3 ? 'p3' : p === 2 ? 'p2' : p === 1 ? 'p1' : 'p0';
      const itemPhaseClass = p >= 2 ? `phase-${p}` : '';
      const chg = Number(s.intradayChangePct || 0);
      const chgColor = chg >= 0 ? '#34d399' : '#f87171';
      const confCount = s.analysis?.confluenceCount || 0;
      const lodText = s.analysis?.lodPrice ? `LoD: ${s.analysis.lodPrice.toFixed(2)}` : '';

      return `<div class="stock-item ${itemPhaseClass} ${isSelected ? 'selected' : ''}" data-symbol="${escapeHtml(s.symbol)}">
        <div class="stock-row-top">
          <div class="stock-name-wrap">
            <span class="stock-sym">${escapeHtml(s.symbol)}</span>
            <span class="stock-nm" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
          </div>
          <div class="stock-price-wrap">
            <span>${Number(s.price || 0).toFixed(2)} ${escapeHtml(s.currency)}</span>
            <span style="color:${chgColor};margin-left:5px;font-size:11px;">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
          </div>
        </div>
        <div class="stock-row-bottom">
          <span class="phase-pill ${pillClass}">${escapeHtml(s.analysis?.phaseBadge || 'NEUTRAL')}</span>
          <span class="muted">${lodText} · Konfluenz: <b>${confCount}/4</b></span>
        </div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.stock-item').forEach((el) => {
    el.addEventListener('click', () => {
      const sym = el.getAttribute('data-symbol');
      state.selectedSymbol = sym;
      renderStockList();
      loadChartForSymbol(sym, false);
    });
  });
}

// --- MITTLERE SPALTE: AUSGEWÄHLTE AKTIE, M10-CHART, 4 PHASEN, KONFLUENZ & CHECKLISTE ---

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
      renderM10CanvasChart();
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
  mhEl.className = `market-hours-chip ${rec.marketClock?.isOpen ? 'open' : 'closed'}`;

  const f = rec.fundamentals || {};
  document.getElementById('detailFundamentalSummary').innerHTML =
    `<b>Bewertung:</b> ${escapeHtml(f.peReason || '-')} &nbsp;|&nbsp; <b>Katalysator/Dip:</b> ${escapeHtml(f.dipReason || '-')} &nbsp;|&nbsp; <b>Earnings-Filter:</b> ${escapeHtml(f.earningsNote || '-')}`;

  document.getElementById('detailCurrentPrice').textContent = `${Number(rec.price || 0).toFixed(2)} ${cur}`;

  const chgEl = document.getElementById('detailIntradayChange');
  const chg = Number(rec.intradayChangePct || 0);
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% heute`;
  chgEl.className = `change-pill ${chg >= 0 ? 'pos' : 'neg'}`;

  const swingEl = document.getElementById('detailSwingDip');
  const sw = Number(rec.dipFromSwingHighPct || 0);
  swingEl.textContent = `${sw.toFixed(1)}% v. Swing-Hoch`;

  // 4-Phasen-Stepper aktualisieren
  const phase = rec.analysis?.phase ?? 0;
  document.querySelectorAll('#phaseStepper .phase-step').forEach((stepEl) => {
    const sNum = Number(stepEl.getAttribute('data-step'));
    stepEl.className = 'phase-step';
    if (phase > sNum) {
      stepEl.classList.add('passed');
    } else if (phase === sNum) {
      stepEl.classList.add(`current-${sNum}`);
    }
  });

  const actionBox = document.getElementById('phaseActionBox');
  actionBox.innerHTML = `<strong>${escapeHtml(rec.analysis?.phaseName || '')}:</strong> ${escapeHtml(rec.analysis?.actionText || '')}`;
  actionBox.style.borderLeftColor =
    phase === 4 ? '#10b981' : phase === 3 ? '#f59e0b' : phase === 2 ? '#38bdf8' : phase === 1 ? '#ef4444' : '#64748b';

  // Chart-Legende aktualisieren
  const a = rec.analysis || {};
  document.getElementById('legEma20').textContent = a.ema20 ? `${a.ema20.toFixed(2)}` : '-';
  document.getElementById('legVwap').textContent = a.vwap ? `${a.vwap.toFixed(2)}` : '-';
  document.getElementById('legLod').textContent = a.lodPrice ? `${a.lodPrice.toFixed(2)} ${cur}` : '-';
  document.getElementById('legSl').textContent = rec.sizing?.stopLossStock
    ? `${rec.sizing.stopLossStock.toFixed(2)} ${cur}`
    : '-';
  document.getElementById('legRsi').textContent = a.rsi14 ? `${a.rsi14.toFixed(1)}` : '-';

  // 4 Objektive Konfluenz-Signale rendern
  const confSignals = a.confluenceSignals || [];
  const confCount = a.confluenceCount || 0;
  const confBadge = document.getElementById('confluenceScoreBadge');
  confBadge.textContent = `${confCount} / 4 aktiv`;
  confBadge.style.color = confCount >= 2 ? '#34d399' : '#94a3b8';

  document.getElementById('confluenceList').innerHTML = confSignals
    .map((c) => {
      return `<div class="conf-item ${c.active ? 'active' : ''}">
        <span class="conf-icon">${c.active ? '✅' : '⚪'}</span>
        <div class="conf-body">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.detail || '')}</span>
        </div>
      </div>`;
    })
    .join('');

  // 9-Punkte Pre-Trade-Checkliste rendern (Kapitel 09)
  const checklist = rec.checklist || [];
  const passedCount = checklist.filter((c) => c.passed).length;
  const chkBadge = document.getElementById('checklistScoreBadge');
  chkBadge.textContent = `${passedCount} / ${checklist.length || 9} erfüllt`;
  chkBadge.style.color = passedCount >= 8 ? '#34d399' : '#fbbf24';

  document.getElementById('preTradeChecklist').innerHTML = checklist
    .map((item) => {
      return `<div class="chk-item ${item.passed ? 'passed' : ''}">
        <span class="conf-icon">${item.passed ? '☑️' : '⬜'}</span>
        <div class="chk-body">
          <strong>${escapeHtml(item.nr)}. ${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail || item.requirement)}</span>
        </div>
      </div>`;
    })
    .join('');
}

// --- INTERAKTIVER HTML5 CANVAS 10-MINUTEN-CHART (M10 + EMA20 + VWAP + LOD + SL + RSI14) ---

function renderM10CanvasChart() {
  const canvas = document.getElementById('m10ChartCanvas');
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;

  ctx.fillStyle = '#0b101d';
  ctx.fillRect(0, 0, width, height);

  const bars = state.chartBars.slice(-55);
  if (!bars || bars.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Lade 10-Minuten-Kerzen (M10)...', width / 2, height / 2);
    return;
  }

  const padLeft = 12;
  const padRight = 64;
  const padTop = 14;
  const priceAreaH = Math.floor(height * 0.70);
  const rsiTop = padTop + priceAreaH + 14;
  const rsiAreaH = height - rsiTop - 22;
  const plotW = width - padLeft - padRight;

  const rec = state.chartRecord;
  const lodPrice = rec?.analysis?.lodPrice ?? null;
  const slPrice = rec?.sizing?.stopLossStock ?? null;

  let minP = Math.min(...bars.map((b) => b.low));
  let maxP = Math.max(...bars.map((b) => b.high));
  if (lodPrice && lodPrice < minP) minP = lodPrice;
  if (slPrice && slPrice < minP && (minP - slPrice) / minP < 0.04) minP = slPrice;

  const pSpan = Math.max(0.01, maxP - minP);
  minP -= pSpan * 0.06;
  maxP += pSpan * 0.06;

  const priceToY = (p) => padTop + priceAreaH - ((p - minP) / (maxP - minP)) * priceAreaH;
  const rsiToY = (r) => rsiTop + rsiAreaH - (Math.min(100, Math.max(0, r)) / 100) * rsiAreaH;

  // Preis-Gitternetz
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10.5px sans-serif';
  ctx.textAlign = 'left';

  for (let i = 0; i <= 4; i++) {
    const pVal = minP + ((maxP - minP) * i) / 4;
    const y = priceToY(pVal);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.fillText(pVal.toFixed(2), padLeft + plotW + 6, y + 3);
  }

  const stepX = plotW / bars.length;
  const candleW = Math.max(3, Math.min(14, stepX * 0.68));
  const maxVol = Math.max(...bars.map((b) => b.volume || 1), 1);

  // Volumen-Balken im unteren Teil des Preis-Charts
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const x = padLeft + i * stepX + stepX / 2;
    const volH = ((b.volume || 0) / maxVol) * (priceAreaH * 0.22);
    ctx.fillStyle = b.close >= b.open ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)';
    ctx.fillRect(x - candleW / 2, padTop + priceAreaH - volH, candleW, volH);
  }

  // Tagestief (LoD) Referenzlinie (Gelb gestrichelt)
  if (lodPrice && lodPrice >= minP && lodPrice <= maxP) {
    const yLod = priceToY(lodPrice);
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, yLod);
    ctx.lineTo(padLeft + plotW, yLod);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`LoD ${lodPrice.toFixed(2)}`, padLeft + 6, yLod - 4);
    ctx.restore();
  }

  // Struktureller Stop-Loss (inkl. Puffer) Referenzlinie (Rot gepunktet)
  if (slPrice && slPrice >= minP && slPrice <= maxP) {
    const ySl = priceToY(slPrice);
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, ySl);
    ctx.lineTo(padLeft + plotW, ySl);
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`SL ${slPrice.toFixed(2)}`, padLeft + 85, ySl - 4);
    ctx.restore();
  }

  // Intraday-VWAP Linie (Lila)
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  bars.forEach((b, i) => {
    const x = padLeft + i * stepX + stepX / 2;
    const y = priceToY(b.vwap || b.close);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // M10 EMA 20 Linie (Hellblau)
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  bars.forEach((b, i) => {
    const x = padLeft + i * stepX + stepX / 2;
    const y = priceToY(b.ema20 || b.close);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // M10 Kerzen (Candlesticks)
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const x = padLeft + i * stepX + stepX / 2;
    const isGreen = b.close >= b.open;
    const color = isGreen ? '#10b981' : '#ef4444';

    const yHigh = priceToY(b.high);
    const yLow = priceToY(b.low);
    const yOpen = priceToY(b.open);
    const yClose = priceToY(b.close);

    // Docht
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();

    // Körper
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(2, Math.abs(yClose - yOpen));
    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  }

  // --- RSI(14) SUB-CHART UNTEN ---
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.beginPath();
  ctx.moveTo(padLeft, rsiTop);
  ctx.lineTo(padLeft + plotW, rsiTop);
  ctx.stroke();

  // RSI 30 & 70 Hilfslinien
  [30, 70].forEach((lvl) => {
    const y = rsiToY(lvl);
    ctx.save();
    ctx.strokeStyle = lvl === 30 ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.25)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.5px sans-serif';
    ctx.fillText(`RSI ${lvl}`, padLeft + plotW + 6, y + 3);
    ctx.restore();
  });

  // RSI(14) Kurve
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  bars.forEach((b, i) => {
    const x = padLeft + i * stepX + stepX / 2;
    const y = rsiToY(b.rsi14 ?? 50);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Zeitachse unten
  ctx.fillStyle = '#64748b';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.floor(bars.length / 6));
  for (let i = 0; i < bars.length; i += labelStep) {
    const b = bars[i];
    const x = padLeft + i * stepX + stepX / 2;
    const tStr = new Date(b.time * 1000).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
    ctx.fillText(tStr, x, height - 5);
  }

  // Fadenkreuz bei Hover
  if (state.hoverBarIndex !== null && bars[state.hoverBarIndex]) {
    const hx = padLeft + state.hoverBarIndex * stepX + stepX / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, height - 18);
    ctx.stroke();
    ctx.restore();
  }
}

function handleCanvasMouseMove(e) {
  const canvas = document.getElementById('m10ChartCanvas');
  const bars = state.chartBars.slice(-55);
  if (!bars.length) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const padLeft = 12;
  const padRight = 64;
  const plotW = rect.width - padLeft - padRight;
  if (mx < padLeft || mx > padLeft + plotW) return;

  const idx = Math.min(bars.length - 1, Math.max(0, Math.floor(((mx - padLeft) / plotW) * bars.length)));
  state.hoverBarIndex = idx;
  const b = bars[idx];

  const tooltip = document.getElementById('chartTooltip');
  const timeStr = new Date(b.time * 1000).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
  tooltip.innerHTML = `<b>${timeStr} Uhr (M10)</b> · O: ${b.open.toFixed(2)} · H: ${b.high.toFixed(2)} · L: ${b.low.toFixed(2)} · <b>C: ${b.close.toFixed(2)}</b> · EMA20: ${(b.ema20 || 0).toFixed(2)} · VWAP: ${(b.vwap || 0).toFixed(2)} · RSI(14): ${(b.rsi14 || 0).toFixed(1)} · Vol: ${b.volume}`;
  tooltip.classList.remove('hidden');
  renderM10CanvasChart();
}

// --- RECHTE SPALTE: 5%-RISIKO & KNOCK-OUT DERIVATE-RECHNER (KAP. 04 & 05) ---

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
      renderM10CanvasChart();
    }
  } catch (err) {
    console.error('Rechenfehler:', err);
  }
}

function renderSizingOutput(sizing, cur = '€') {
  if (!sizing) return;
  const box = document.getElementById('calcResultsBox');
  box.innerHTML = `
    <div class="calc-step-row">
      <span>1. Max. erlaubter Verlust (R_max = ${sizing.maxRiskPct}%):</span>
      <strong style="color:#f87171">-${sizing.rMaxEuro.toFixed(2)} €</strong>
    </div>
    <div class="calc-step-row">
      <span>2. Stop-Loss Aktie (LoD - ${sizing.noiseBufferPct}% Puffer):</span>
      <strong>${sizing.stopLossStock.toFixed(2)} ${cur} (-${sizing.stopDistanceStockPct.toFixed(2)}%)</strong>
    </div>
    <div class="calc-step-row">
      <span>3. Empfohlener / Aktiver Hebel (Kap. 4.2):</span>
      <strong style="color:#38bdf8">Hebel ${sizing.activeLeverage}x Turbo Long</strong>
    </div>
    <div class="calc-step-row">
      <span>4. Stop-Loss-Abstand im Derivat (d_Derivat):</span>
      <strong style="color:#fbbf24">-${sizing.dDerivatPct.toFixed(2)}%</strong>
    </div>
    <div class="calc-step-row">
      <span>5. Max. erlaubte K.O.-Barriere (Kap. 4.3):</span>
      <span>&lt; ${sizing.maxAllowedKoBarrier.toFixed(2)} ${cur} (Strike ~${sizing.impliedStrike.toFixed(2)})</span>
    </div>
    <div class="calc-highlight">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>📌 <b>Kaufbetrag Derivat (P_Kauf):</b></span>
        <strong style="font-size:15px;color:#34d399">${sizing.positionSizeEuro.toFixed(0)} € (${sizing.accountAllocationPct.toFixed(1)}% Konto)</strong>
      </div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">
        Modell-Order: <b>${sizing.quantityPieces} Stück</b> à ${sizing.modelCertEntryPrice.toFixed(2)} € kaufen →
        <b>Stop-Loss im Derivat direkt bei ${sizing.modelCertStopPrice.toFixed(2)} €</b> setzen (Max. Risiko: -${sizing.actualRiskEuro.toFixed(0)} €)
      </div>
    </div>
  `;

  // Matrix (Kapitel 5.3)
  const tbody = document.getElementById('calcMatrixBody');
  tbody.innerHTML = (sizing.matrix || [])
    .map((row) => {
      return `<tr class="${row.isRecommended ? 'rec-row' : ''}">
        <td>${row.leverage}x ${row.isRecommended ? '★' : ''}</td>
        <td>-${row.stopDerivatPct.toFixed(1)}%</td>
        <td>${row.accountSharePct.toFixed(1)}%</td>
        <td><b>${row.buyAmountEuro.toFixed(0)} €</b></td>
        <td>${row.stopAmountEuro.toFixed(0)} € (-${row.maxLossEuro.toFixed(0)} €)</td>
      </tr>`;
    })
    .join('');
}

// --- AKTIVE TRADES (STUFE 1-3 & STAGNATIONS-EXIT) & POST-TRADE JOURNAL ---

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
    document.querySelector('.right-tab[data-rtab="trades"]').click();
  }
}

function renderActiveTradesAndJournal() {
  const trades = state.snapshot?.activeTrades || [];
  const journal = state.snapshot?.journal || [];
  document.getElementById('activeTradesCount').textContent = trades.length;

  const tradesContainer = document.getElementById('activeTradesList');
  if (trades.length === 0) {
    tradesContainer.innerHTML = `<div class="muted">Keine offenen Positionen in der Live-Überwachung.</div>`;
  } else {
    tradesContainer.innerHTML = trades
      .map((t) => {
        const ev = t.latestEvaluation || {};
        const stage = ev.stage ?? 1;
        const stageClass = stage === 3 ? 'stage-3' : stage === 2 ? 'stage-2' : '';
        const pnlEuro = Number(ev.pnlEuro || 0);
        const derivPct = Number(ev.derivGainPct || 0);
        const rMult = Number(ev.rMultiple || 0);
        const pnlColor = pnlEuro >= 0 ? '#34d399' : '#f87171';

        return `<div class="trade-card ${stageClass}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${escapeHtml(t.name)} (${escapeHtml(t.symbol)}) · Hebel ${t.leverage}x</strong>
            <span style="color:${pnlColor};font-weight:800;">${pnlEuro >= 0 ? '+' : ''}${pnlEuro.toFixed(0)} € (${derivPct >= 0 ? '+' : ''}${derivPct.toFixed(1)}% | ${rMult.toFixed(2)}R)</span>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:3px;">
            Entry: ${t.entryPrice.toFixed(2)} · Aktuell: ${(ev.currentPrice || t.entryPrice).toFixed(2)} · Nachgezogener SL: <b>${(ev.recommendedStopStock || t.stopLossStock).toFixed(2)}</b>
          </div>
          <div style="margin-top:6px;padding:5px 7px;background:#0d1424;border-radius:4px;font-size:11px;">
            <b>${escapeHtml(ev.stageName || 'Stufe 1: Initial Risk')}:</b><br/>
            ${escapeHtml(ev.recommendation || 'Stop unter LoD belassen.')}
          </div>
          <div style="margin-top:7px;display:flex;justify-content:flex-end;">
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
    journalContainer.innerHTML = `<div class="muted">Noch keine abgeschlossenen Trades im Journal.</div>`;
  } else {
    journalContainer.innerHTML = journal
      .slice(0, 15)
      .map((j) => {
        const win = j.pnlEuro >= 0;
        return `<div class="journal-card">
          <div style="display:flex;justify-content:space-between;">
            <strong>${escapeHtml(j.name)} (${escapeHtml(j.symbol)}) · ${j.leverage}x</strong>
            <strong style="color:${win ? '#34d399' : '#f87171'}">${win ? '+' : ''}${j.pnlEuro.toFixed(0)} € (${win ? '+' : ''}${j.rMultiple.toFixed(2)}R)</strong>
          </div>
          <div class="muted" style="margin-top:3px;">
            Entry: ${j.entryPrice} → Exit: ${j.exitPrice} (${j.stockGainPct >= 0 ? '+' : ''}${j.stockGainPct}% Aktie | ${j.derivGainPct >= 0 ? '+' : ''}${j.derivGainPct}% Derivat) · LoD: ${j.lodPrice} (SL -${j.stopDistancePct}%)
          </div>
        </div>`;
      })
      .join('');
  }
}

// --- ECHTZEIT-BENACHRICHTIGUNGEN (GLEICHZEITIG WEB + TELEGRAM) ---

function handleIncomingLiveAlert(alert) {
  if (!alert) return;

  if (state.snapshot) {
    state.snapshot.alerts = [
      alert,
      ...(state.snapshot.alerts || []).filter((a) => a.id !== alert.id)
    ];
    renderAlertsHistory();
  }

  // 1. Live Banner oben im Dashboard einblenden
  const banner = document.getElementById('liveAlertBanner');
  document.getElementById('bannerBadge').textContent = alert.phaseBadge || `PHASE ${alert.phase || 4}`;
  document.getElementById('bannerTitle').textContent = alert.title;
  document.getElementById('bannerSub').textContent = alert.message;
  document.getElementById('bannerDelivery').textContent = alert.delivery?.telegram?.ok
    ? '✅ Web-Dashboard + Telegram gleichzeitig zugestellt'
    : '🔔 Web-Dashboard Live-Alarm';

  const viewBtn = document.getElementById('btnBannerView');
  viewBtn.onclick = () => {
    if (alert.symbol) {
      state.selectedSymbol = alert.symbol;
      loadChartForSymbol(alert.symbol, false);
    }
  };
  banner.classList.remove('hidden');

  // 2. Akustischer Sound-Alarm via WebAudio API
  const settings = state.snapshot?.settings || {};
  if (settings.soundAlertsEnabled !== false) {
    playAlertChime(alert.phase || 4);
  }

  // 3. Browser Desktop-Notification
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
  const bannerDelivery = document.getElementById('bannerDelivery');
  if (delivery?.telegram?.ok) {
    bannerDelivery.textContent = '✅ Web-Dashboard + Telegram gleichzeitig zugestellt!';
  }
}

function renderAlertsHistory() {
  const list = state.snapshot?.alerts || [];
  document.getElementById('alertsCount').textContent = list.length;
  const container = document.getElementById('alertsHistoryList');

  if (list.length === 0) {
    container.innerHTML = `<div class="muted">Noch keine Alarme in dieser Sitzung ausgelöst. Klicke oben auf <b>„⚡ Fallstudie (Kap. 08) & Alarm testen“</b>!</div>`;
    return;
  }

  container.innerHTML = list
    .map((a) => {
      const timeStr = new Date(a.timestamp).toLocaleTimeString('de-DE');
      const tgOk = a.delivery?.telegram?.ok;
      const tgSkipped = a.delivery?.telegram?.skipped;
      const tgStatus = tgOk
        ? `<span style="color:#38bdf8">📲 Telegram ✓</span>`
        : tgSkipped
          ? `<span class="muted">Telegram nicht eingerichtet</span>`
          : `<span style="color:#fbbf24">Telegram: ${escapeHtml(a.delivery?.telegram?.error || 'Sende...')}</span>`;

      return `<div class="alert-card" style="cursor:pointer" data-symbol="${escapeHtml(a.symbol || '')}">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
          <span class="phase-pill p${a.phase || 4}">${escapeHtml(a.phaseBadge || 'SIGNAL')}</span>
          <span class="muted">${timeStr} Uhr · 🖥️ Web ✓ · ${tgStatus}</span>
        </div>
        <strong style="display:block;font-size:12px;margin-bottom:3px;">${escapeHtml(a.title)}</strong>
        <p style="font-size:11px;color:#cbd5e1;">${escapeHtml(a.message)}</p>
        ${
          a.sizing
            ? `<div style="margin-top:5px;padding:4px 6px;background:#0d1424;border-radius:4px;font-size:10.5px;color:#34d399;">
                SL Aktie: ${a.sizing.stopLossStock.toFixed(2)} · Hebel ${a.sizing.activeLeverage}x · Kaufbetrag: <b>${a.sizing.positionSizeEuro.toFixed(0)} €</b> (Max. Risiko: -${a.sizing.rMaxEuro.toFixed(0)} €)
              </div>`
            : ''
        }
      </div>`;
    })
    .join('');

  container.querySelectorAll('.alert-card').forEach((card) => {
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
    // Audio blockiert falls noch keine User-Interaktion stattfand
  }
}

// --- SIMULATION & WATCHLIST HELFER ---

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

// --- TELEGRAM & SETTINGS MODAL ---

function openSettingsModal() {
  const s = state.snapshot?.settings || {};
  document.getElementById('setTelegramToken').value = s.telegramBotToken || '';
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
    updateTelegramBadge();
    closeSettingsModal();
    recalculateSizingFromInputs();
  }
}

async function detectTelegramChatId() {
  const token = document.getElementById('setTelegramToken').value.trim();
  const fb = document.getElementById('telegramDetectFeedback');
  fb.classList.remove('hidden');
  fb.textContent = '🔍 Suche nach deiner Telegram Chat-ID...';

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
      fb.innerHTML = `✅ <b>Chat-ID gefunden:</b> <code>${escapeHtml(data.chatId)}</code> (${escapeHtml(data.chatTitle)}) und automatisch gespeichert!`;
      if (state.snapshot?.settings) {
        state.snapshot.settings.telegramBotToken = token;
        state.snapshot.settings.telegramChatId = data.chatId;
        updateTelegramBadge();
      }
    } else {
      fb.style.borderColor = '#f59e0b';
      fb.textContent = `⚠️ ${data.message || data.error || 'Keine Nachricht gefunden.'}`;
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
      fb.innerHTML = `✅ <b>Gleichzeitiger Test-Alarm erfolgreich an Web-Dashboard UND Telegram (${escapeHtml(tg.chatId)}) gesendet!</b>`;
    } else {
      fb.style.borderColor = '#f59e0b';
      fb.innerHTML = `🔔 <b>Web-Dashboard-Alarm ausgelöst!</b> (Telegram-Hinweis: ${escapeHtml(tg?.reason || tg?.error || 'Bitte Bot-Token & Chat-ID eintragen')})`;
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
