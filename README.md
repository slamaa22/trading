# Antizyklischer Mean-Reversion Scanner & Alert-System (Long-Only · M10)

Vollautomatisches Scanner-, Chart-, Risiko- und Echtzeit-Benachrichtigungs-Tool für das **Systematische Trading-Playbook: Antizyklische Mean-Reversion-Strategie (Long-Only)**.

## Features (1:1 nach Playbook)

1. **Gleichzeitige Echtzeit-Benachrichtigungen (Web-Dashboard + Telegram Bot)**:
   - Sobald eine überwachte Qualitätsaktie in **Phase 2 (Watchlist-Alarm: Tagestief / LoD-Absorption)**, **Phase 3 (Sekundärer Test & Kompression)** oder **Phase 4 (Impuls-Trigger / Kaufsignal)** eintritt, sendet das System **im selben Moment (`Promise.allSettled`)** sowohl einen Live-Push an das Web-Dashboard (inkl. Sound-Signal & Browser-Push) als auch eine formatierte HTML-Nachricht über deinen **Telegram-Bot**.
   - Enthält direkt in der Telegram- und Web-Nachricht den exakten **Stop-Loss unter dem Tagestief (inkl. Puffer)**, den **optimalen Hebel (5x–10x)** sowie den **exakten Kaufbetrag in Euro (für max. 5 % Kontorisiko)**.

2. **Anlageuniversum & Fundamental-/Schutzfilter (Kapitel 02)**:
   - Liquide Qualitätsaktien (Large & Mid Caps) aus **DAX, MDAX, ATX, EuroStoxx 50, SMI, S&P 500 und Nasdaq 100** (beliebig erweiterbar).
   - Automatischer **KGV- & Profitabilitäts-Check** (Ausschluss unprofitabler Werte oder KGV > 50).
   - **Dip-Größenfilter** (-4 % bis -15 % vom Swing-Hoch bzw. starker Intraday-Dip; Ausschluss bei Crash < -30 %).
   - **Schutzfilter 1 (Earnings-Sperre)** & **Schutzfilter 2 (Gesamtmarkt-Regime / Index-Synchronisation)**.

3. **10-Minuten-Chart (M10) & 4-Phasen-Erkennung (Kapitel 03)**:
   - Aggregiert Live-Intraday-Daten auf echte **10-Minuten-Kerzen (M10)** inkl. **M10 EMA 20**, **Intraday-VWAP**, **RSI(14)**, **ATR(14)** und **Tageschart-Unterstützungszonen (SMA 200 / Swing-Lows)**.
   - Erkennt automatisch:
     - **Phase 1**: Kapitulation (Selling Climax) → *Striktes Kaufverbot*
     - **Phase 2**: Absorption & Erstes Tagestief (LoD) → *Watchlist-Alarm*
     - **Phase 3**: Sekundärer Test & Kompression (3–6 M10-Kerzen über LoD) → *Derivat & Positionsgröße vorbereiten*
     - **Phase 4**: Impuls-Trigger (Grüne M10-Ausbruchskerze) → *Kaufausführung (Entry)*
   - Prüft alle **4 objektiven Konfluenz-Signale** (Bullische RSI-Divergenz, Volumen-Divergenz, EMA20/VWAP-Rückeroberung, Liquidity Sweep / Hammer am LoD) sowie Disqualifikationen (Schleichendes Abbröckeln & FOMO-Verbot > +3,5 % über LoD).

4. **5-%-Risiko & Knock-Out-Derivate-Rechner (Hebel 5x–10x, Kapitel 04 & 05)**:
   - Berechnet $R_{\text{max}}$, $d_{\text{Aktie}}$ (inkl. 0,15 %–0,30 % Noise-Buffer und Schutz vor glatten psychologischen Marken), $d_{\text{Derivat}}$, $P_{\text{Kauf}}$ sowie die komplette **Positionsgrößen-Matrix** für Hebel 5x bis 10x.

5. **3-Stufen Trade-Management & Dynamischer Stagnations-Exit (Kapitel 06)**:
   - Überwacht laufende Trades live im M10-Chart und schickt Alarme bei **Stufe 2 (Break-Even ab 1,5R)** und **Stufe 3 (Dynamischer Stagnations-Exit)** sowie **Overnight-Warnungen** kurz vor Börsenschluss (17:30 Uhr EU / 22:00 Uhr US).

## Starten

```bash
npm start
```

Das Web-Dashboard ist anschließend unter **http://localhost:3400** erreichbar.
