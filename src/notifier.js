/**
 * Gleichzeitiger Echtzeit-Benachrichtigungs-Dispatcher (Web-Dashboard WebSocket + Telegram Bot API).
 * Sendet bei jedem Signal im selben Moment (Promise.allSettled) sowohl den Live-Push an das Web-Dashboard
 * als auch eine formatierte Telegram-Nachricht inkl. aller Playbook-Kennzahlen (Phase, LoD, Konfluenz,
 * Stop-Loss mit Puffer, empfohlener Hebel 5x–10x & 5%-Risiko-Positionsgröße).
 */

export class NotificationManager {
  constructor(getSettings, saveSettings, getScannerSnapshot) {
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.getScannerSnapshot = getScannerSnapshot;
    this.wsClients = new Set();
    this.alertHistory = [];
    this.sentDedupeMap = new Map(); // key: `${symbol}:${phase}:${sessionDate}` -> timestamp
    this.lastUpdateId = 0;
    this.botPollTimer = null;
  }

  registerWsClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    ws.on('error', () => this.wsClients.delete(ws));
  }

  broadcastWs(payload) {
    const msg = JSON.stringify(payload);
    let delivered = 0;
    for (const client of this.wsClients) {
      if (client.readyState === 1) {
        try {
          client.send(msg);
          delivered++;
        } catch {
          this.wsClients.delete(client);
        }
      }
    }
    return delivered;
  }

  /**
   * Prüft, ob für dieses Setup bereits in derselben Phase am selben Tag alarmiert wurde.
   */
  shouldTriggerPhaseAlert(symbol, phase, sessionDate = 'today') {
    const settings = this.getSettings();
    const minAlertPhase = settings.minAlertPhase ?? 2; // Standard: Ab Phase 2 (Watchlist-Alarm) & Phase 3/4
    if (phase < minAlertPhase) return false;

    const key = `${symbol}:phase_${phase}:${sessionDate}`;
    const lastSent = this.sentDedupeMap.get(key);
    // Kein doppelter Spam innerhalb von 45 Minuten für exakt dieselbe Phase derselben Aktie
    if (lastSent && Date.now() - lastSent < 45 * 60 * 1000) {
      return false;
    }
    this.sentDedupeMap.set(key, Date.now());
    return true;
  }

  /**
   * Feuert im exakt selben Moment (parallel via Promise.allSettled):
   * 1. Web-Dashboard Push (WebSocket + Browser/Audio-Trigger)
   * 2. Telegram Bot Nachricht (sofern Token & Chat-ID konfiguriert)
   */
  async dispatchSimultaneousAlert(alertObj, { forceTelegram = false } = {}) {
    const timestamp = new Date().toISOString();
    const fullAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      ...alertObj
    };

    this.alertHistory.unshift(fullAlert);
    if (this.alertHistory.length > 100) {
      this.alertHistory.length = 100;
    }

    const settings = this.getSettings();
    const telegramConfigured = Boolean(
      settings.telegramBotToken &&
      settings.telegramChatId &&
      (settings.telegramEnabled !== false || forceTelegram)
    );

    const telegramText = this.formatTelegramMessage(fullAlert);

    // Parallel im exakt gleichen Moment absenden!
    const [wsResult, tgResult] = await Promise.allSettled([
      Promise.resolve(
        this.broadcastWs({
          type: 'LIVE_ALERT',
          alert: fullAlert
        })
      ),
      telegramConfigured
        ? this.sendTelegramRaw(settings.telegramBotToken, settings.telegramChatId, telegramText)
        : Promise.resolve({ ok: false, skipped: true, reason: 'Telegram noch nicht konfiguriert' })
    ]);

    const telegramDelivery =
      tgResult.status === 'fulfilled'
        ? tgResult.value
        : { ok: false, error: tgResult.reason?.message || 'Telegram-Fehler' };

    fullAlert.delivery = {
      webClients: wsResult.status === 'fulfilled' ? wsResult.value : 0,
      telegram: telegramDelivery
    };

    // Sende Delivery-Status-Update an Dashboard
    this.broadcastWs({
      type: 'ALERT_DELIVERY_UPDATE',
      alertId: fullAlert.id,
      delivery: fullAlert.delivery
    });

    return fullAlert;
  }

  /**
   * Formatiert die Playbook-konforme Telegram-Benachrichtigung (HTML).
   */
  formatTelegramMessage(alert) {
    const cur = alert.currency || '€';
    if (alert.kind === 'TRADE_EXIT' || alert.kind === 'TRADE_MANAGEMENT') {
      const icon = alert.stage === 3 ? '🏁' : alert.stage === 0 ? '🛑' : '🛡️';
      return [
        `${icon} <b>${escapeHtml(alert.title)}</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📌 <b>Aktie:</b> ${escapeHtml(alert.name)} (<code>${escapeHtml(alert.symbol)}</code>)`,
        `💶 <b>Aktueller Kurs:</b> ${Number(alert.currentPrice).toFixed(2)} ${cur} (${alert.stockGainPct >= 0 ? '+' : ''}${Number(alert.stockGainPct).toFixed(2)}%)`,
        `📈 <b>Derivat (Hebel ${alert.leverage}x):</b> ${alert.derivGainPct >= 0 ? '+' : ''}${Number(alert.derivGainPct).toFixed(1)}% (${alert.pnlEuro >= 0 ? '+' : ''}${Number(alert.pnlEuro).toFixed(0)} € | ${Number(alert.rMultiple).toFixed(2)}R)`,
        `🎯 <b>Empfohlener Stop-Loss:</b> ${Number(alert.recommendedStopStock).toFixed(2)} ${cur}`,
        ``,
        `💡 <b>Handlungsanweisung (Kap. 06):</b>`,
        `${escapeHtml(alert.message)}`,
        `⏱ <i>${new Date(alert.timestamp).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr MEZ</i>`
      ].join('\n');
    }

    const phaseIcons = {
      4: '🚨🟢',
      3: '⚡🟡',
      2: '👁️🔵',
      1: '⛔🔴'
    };
    const icon = phaseIcons[alert.phase] || '🔔';
    const sizing = alert.sizing;
    const confluences = (alert.confluenceSignals || [])
      .filter((c) => c.active)
      .map((c) => `  ✅ ${escapeHtml(c.name)}`)
      .join('\n');

    const lines = [
      `${icon} <b>${escapeHtml(alert.title)}</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🏢 <b>${escapeHtml(alert.name)}</b> (<code>${escapeHtml(alert.symbol)}</code> · ${escapeHtml(alert.index || '')})`,
      `💰 <b>Kurs aktuell:</b> <b>${Number(alert.price).toFixed(2)} ${cur}</b> (${alert.intradayChangePct >= 0 ? '+' : ''}${Number(alert.intradayChangePct).toFixed(2)}% heute | Dip: ${Number(alert.dipFromSwingHighPct || alert.intradayChangePct).toFixed(1)}%)`,
      `📉 <b>Tagestief (LoD):</b> <b>${Number(alert.lodPrice).toFixed(2)} ${cur}</b> (Abstand: +${Number(alert.distanceFromLodPct).toFixed(2)}% | ${alert.barsSinceFirstLow || 0} M10-Kerzen)`,
      `📊 <b>M10-Indikatoren:</b> RSI(14): ${Number(alert.rsi14).toFixed(1)} | EMA20: ${Number(alert.ema20).toFixed(2)} | VWAP: ${Number(alert.vwap).toFixed(2)}`,
      `🏛 <b>Fundamental / KGV:</b> ${escapeHtml(alert.peReason || 'Qualitätsaktie')}`,
      ``
    ];

    if (confluences) {
      lines.push(`🔍 <b>Konfluenz-Signale (${alert.confluenceCount}/4):</b>`, confluences, ``);
    }

    if (sizing) {
      lines.push(
        `🧮 <b>5%-Risiko & Derivate-Plan (Kap. 04 & 05):</b>`,
        `  • <b>Stop-Loss Aktie:</b> <code>${sizing.stopLossStock.toFixed(2)} ${cur}</code> (LoD - ${sizing.noiseBufferPct}% Puffer = -${sizing.stopDistanceStockPct.toFixed(2)}%)`,
        `  • <b>Optimaler Hebel:</b> <b>${sizing.activeLeverage}x</b> Turbo Long (Max. K.O. &lt; ${sizing.maxAllowedKoBarrier.toFixed(2)} ${cur})`,
        `  • <b>Risiko im Derivat:</b> -${sizing.dDerivatPct.toFixed(1)}% (Max. Verlust: -${sizing.rMaxEuro.toFixed(0)} € = ${sizing.maxRiskPct}% Konto)`,
        `  • <b>Kaufbetrag Derivat:</b> <b>${sizing.positionSizeEuro.toFixed(0)} €</b> (${sizing.accountAllocationPct.toFixed(1)}% vom ${sizing.accountCapital.toFixed(0)} € Konto)`,
        `  • <b>Modell-Zertifikat:</b> ${sizing.quantityPieces} Stk. à ${sizing.modelCertEntryPrice.toFixed(2)} € → <b>Stop-Order bei ${sizing.modelCertStopPrice.toFixed(2)} €</b>`,
        ``
      );
    }

    lines.push(
      `📋 <b>Anweisung:</b> ${escapeHtml(alert.message)}`,
      `⏱ <i>${new Date(alert.timestamp).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr MEZ · Gleichzeitig an Web-Dashboard & Telegram gesendet</i>`
    );

    return lines.join('\n');
  }

  /**
   * Sendet eine Nachricht direkt über die offizielle Telegram Bot HTTP API.
   */
  async sendTelegramRaw(botToken, chatId, htmlText) {
    const cleanToken = String(botToken || '').trim();
    const cleanChatId = String(chatId || '').trim();
    if (!cleanToken || !cleanChatId) {
      return { ok: false, error: 'Bot-Token oder Chat-ID fehlt' };
    }

    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.description || `Telegram HTTP ${response.status}`);
    }
    return {
      ok: true,
      messageId: data.result?.message_id,
      chatId: cleanChatId
    };
  }

  /**
   * Erkennt automatisch die Chat-ID, nachdem der Nutzer seinem Bot z.B. "/start" geschickt hat.
   */
  async detectTelegramChatId(botToken) {
    const cleanToken = String(botToken || '').trim();
    if (!cleanToken) {
      throw new Error('Bitte zuerst den Telegram Bot-Token eingeben.');
    }

    const url = `https://api.telegram.org/bot${cleanToken}/getUpdates?limit=20`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.description || 'Konnte Telegram getUpdates nicht abrufen. Ist der Bot-Token korrekt?');
    }

    const updates = data.result || [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chat =
        u.message?.chat ||
        u.edited_message?.chat ||
        u.channel_post?.chat ||
        u.my_chat_member?.chat;
      if (chat && chat.id) {
        return {
          found: true,
          chatId: String(chat.id),
          chatTitle: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Telegram Chat',
          username: chat.username || null
        };
      }
    }

    return {
      found: false,
      message: 'Noch keine Nachricht gefunden. Bitte öffne deinen Bot in Telegram, klicke auf "Starten" (oder sende /start) und versuche es erneut.'
    };
  }

  /**
   * Optionaler Hintergrund-Poller für eingehende Telegram-Befehle (/start, /status, /top),
   * damit der Bot auch direkt in Telegram antwortet und die Chat-ID automatisch verknüpft.
   */
  startTelegramCommandListener() {
    if (this.botPollTimer) clearInterval(this.botPollTimer);
    this.botPollTimer = setInterval(async () => {
      const settings = this.getSettings();
      if (!settings.telegramBotToken) return;
      try {
        const offsetParam = this.lastUpdateId ? `?offset=${this.lastUpdateId + 1}&timeout=1` : '?limit=5';
        const url = `https://api.telegram.org/bot${settings.telegramBotToken.trim()}/getUpdates${offsetParam}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok || !Array.isArray(data.result)) return;

        for (const u of data.result) {
          this.lastUpdateId = Math.max(this.lastUpdateId, u.update_id);
          const msg = u.message || u.channel_post;
          if (!msg || !msg.chat || !msg.text) continue;

          const incomingChatId = String(msg.chat.id);
          const text = msg.text.trim().toLowerCase();

          // Falls noch keine Chat-ID gespeichert war, automatisch speichern!
          if (!settings.telegramChatId) {
            this.saveSettings({ telegramChatId: incomingChatId, telegramEnabled: true });
            this.broadcastWs({
              type: 'SETTINGS_UPDATED',
              settings: this.getSettings()
            });
          }

          if (text.startsWith('/start') || text === '/help') {
            await this.sendTelegramRaw(
              settings.telegramBotToken,
              incomingChatId,
              [
                `✅ <b>@PureSiteTrading_bot erfolgreich verbunden!</b>`,
                `Deine Chat-ID (<code>${incomingChatId}</code>) ist jetzt fest im Server hinterlegt.`,
                ``,
                `Du erhältst ab sofort <b>im exakt selben Moment wie im Web-Dashboard</b> automatische Echtzeit-Alarme bei:`,
                `• 🔵 <b>Phase 2:</b> Tagestief (LoD) &amp; Absorption erkannt`,
                `• 🟡 <b>Phase 3:</b> Sekundärer Test &amp; Boden-Kompression (3–6 M10-Kerzen)`,
                `• 🟢 <b>Phase 4:</b> Impuls-Trigger (Kaufsignal + 5%-Risiko- &amp; Hebel-5x-10x-Berechnung)`,
                `• 🏁 <b>Exit-Alarme:</b> Stufe 2 Break-Even &amp; Stufe 3 Stagnations-Exit`,
                ``,
                `Befehle direkt im Chat: /status · /top`
              ].join('\n')
            );
          } else if (text === '/status' || text === '/top') {
            const snap = this.getScannerSnapshot ? this.getScannerSnapshot() : null;
            const actionable = (snap?.stocks || []).filter((s) => s.analysis?.phase >= 2).slice(0, 5);
            const statusLines = [
              `📡 <b>Scanner-Status (${new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr)</b>`,
              `Überwachte Qualitätsaktien: ${snap?.stocks?.length || 0}`,
              `Aktive Bodenbildungs-Setups (Phase 2–4): ${actionable.length}`,
              ``
            ];
            if (actionable.length === 0) {
              statusLines.push(`Aktuell befindet sich keine Aktie in Phase 2–4.`);
            } else {
              for (const s of actionable) {
                statusLines.push(
                  `• <b>${escapeHtml(s.name)}</b> (<code>${s.symbol}</code>): <b>Phase ${s.analysis.phase}</b> | Kurs: ${s.price.toFixed(2)} ${s.currency} | LoD: ${s.analysis.lodPrice.toFixed(2)} | Konfluenz: ${s.analysis.confluenceCount}/4`
                );
              }
            }
            await this.sendTelegramRaw(settings.telegramBotToken, incomingChatId, statusLines.join('\n'));
          }
        }
      } catch {
        // Ignoriere Netzwerk-Timeouts beim Hintergrund-Polling
      }
    }, 3000);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
