/**
 * Anlageuniversum & Referenzmarkt-Definitionen gemäß Playbook Kapitel 02 & 04.
 * Liquide Large & Mid Caps aus DAX, MDAX, ATX, EuroStoxx 50, SMI, S&P 500, Nasdaq 100.
 */

export const BENCHMARK_INDICES = {
  DAX: { symbol: '^GDAXI', name: 'DAX 40', region: 'EU', tradingHoursText: '09:00–17:30 MEZ (Xetra)' },
  MDAX: { symbol: '^MDAXI', name: 'MDAX', region: 'EU', tradingHoursText: '09:00–17:30 MEZ (Xetra)' },
  ATX: { symbol: '^ATX', name: 'ATX Wien', region: 'EU', tradingHoursText: '09:00–17:30 MEZ (Wien)' },
  EUROSTOXX: { symbol: '^STOXX50E', name: 'EuroStoxx 50', region: 'EU', tradingHoursText: '09:00–17:30 MEZ (EU)' },
  SMI: { symbol: '^SSMI', name: 'SMI Zürich', region: 'EU', tradingHoursText: '09:00–17:30 MEZ (SIX)' },
  SP500: { symbol: '^GSPC', name: 'S&P 500', region: 'US', tradingHoursText: '15:30–22:00 MEZ (NYSE)' },
  NASDAQ100: { symbol: '^NDX', name: 'Nasdaq 100', region: 'US', tradingHoursText: '15:30–22:00 MEZ (Nasdaq)' }
};

export const DEFAULT_UNIVERSE = [
  // DAX
  { symbol: 'SY1.DE', name: 'Symrise AG', index: 'DAX', sector: 'Chemie / Duftstoffe', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SAP.DE', name: 'SAP SE', index: 'DAX', sector: 'Software', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SIE.DE', name: 'Siemens AG', index: 'DAX', sector: 'Industrie / Technologie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ALV.DE', name: 'Allianz SE', index: 'DAX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'MUV2.DE', name: 'Münchener Rück', index: 'DAX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DTE.DE', name: 'Deutsche Telekom AG', index: 'DAX', sector: 'Telekommunikation', profile: 'conservative', currency: 'EUR' },
  { symbol: 'IFX.DE', name: 'Infineon Technologies', index: 'DAX', sector: 'Halbleiter', profile: 'volatile', currency: 'EUR' },
  { symbol: 'ADS.DE', name: 'adidas AG', index: 'DAX', sector: 'Konsumgüter', profile: 'volatile', currency: 'EUR' },
  { symbol: 'DHL.DE', name: 'DHL Group', index: 'DAX', sector: 'Logistik', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DB1.DE', name: 'Deutsche Börse AG', index: 'DAX', sector: 'Finanzen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BEI.DE', name: 'Beiersdorf AG', index: 'DAX', sector: 'Basiskonsum', profile: 'conservative', currency: 'EUR' },
  { symbol: 'MRK.DE', name: 'Merck KGaA', index: 'DAX', sector: 'Pharma / Spezialchemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'MTX.DE', name: 'MTU Aero Engines', index: 'DAX', sector: 'Luftfahrt / Industrie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BAS.DE', name: 'BASF SE', index: 'DAX', sector: 'Chemie', profile: 'conservative', currency: 'EUR' },

  // MDAX
  { symbol: 'HNR1.DE', name: 'Hannover Rück SE', index: 'MDAX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'FPE3.DE', name: 'Fuchs SE', index: 'MDAX', sector: 'Spezialchemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'NEM.DE', name: 'Nemetschek SE', index: 'MDAX', sector: 'Bausoftware', profile: 'volatile', currency: 'EUR' },
  { symbol: 'KRN.DE', name: 'Krones AG', index: 'MDAX', sector: 'Maschinenbau', profile: 'conservative', currency: 'EUR' },
  { symbol: 'G1A.DE', name: 'GEA Group AG', index: 'MDAX', sector: 'Industrie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BOSS.DE', name: 'Hugo Boss AG', index: 'MDAX', sector: 'Mode / Konsum', profile: 'volatile', currency: 'EUR' },

  // ATX (Österreich)
  { symbol: 'EBS.VI', name: 'Erste Group Bank AG', index: 'ATX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'OMV.VI', name: 'OMV AG', index: 'ATX', sector: 'Energie / Chemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'VER.VI', name: 'Verbund AG', index: 'ATX', sector: 'Versorger', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ANDR.VI', name: 'Andritz AG', index: 'ATX', sector: 'Anlagenbau', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BG.VI', name: 'BAWAG Group AG', index: 'ATX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },

  // EuroStoxx 50
  { symbol: 'ASML.AS', name: 'ASML Holding NV', index: 'EUROSTOXX', sector: 'Halbleiter', profile: 'volatile', currency: 'EUR' },
  { symbol: 'MC.PA', name: 'LVMH Moët Hennessy', index: 'EUROSTOXX', sector: 'Luxusgüter', profile: 'conservative', currency: 'EUR' },
  { symbol: 'OR.PA', name: "L'Oréal S.A.", index: 'EUROSTOXX', sector: 'Basiskonsum', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SU.PA', name: 'Schneider Electric', index: 'EUROSTOXX', sector: 'Industrie / Elektrifizierung', profile: 'conservative', currency: 'EUR' },
  { symbol: 'AIR.PA', name: 'Airbus SE', index: 'EUROSTOXX', sector: 'Luftfahrt', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SAN.PA', name: 'Sanofi S.A.', index: 'EUROSTOXX', sector: 'Pharma', profile: 'conservative', currency: 'EUR' },

  // SMI (Schweiz)
  { symbol: 'NESN.SW', name: 'Nestlé S.A.', index: 'SMI', sector: 'Basiskonsum', profile: 'conservative', currency: 'CHF' },
  { symbol: 'NOVN.SW', name: 'Novartis AG', index: 'SMI', sector: 'Pharma', profile: 'conservative', currency: 'CHF' },
  { symbol: 'SIKA.SW', name: 'Sika AG', index: 'SMI', sector: 'Bauchemie / Industrie', profile: 'conservative', currency: 'CHF' },
  { symbol: 'ZURN.SW', name: 'Zurich Insurance Group', index: 'SMI', sector: 'Versicherungen', profile: 'conservative', currency: 'CHF' },
  { symbol: 'ABBN.SW', name: 'ABB Ltd', index: 'SMI', sector: 'Industrie', profile: 'conservative', currency: 'CHF' },
  { symbol: 'GIVN.SW', name: 'Givaudan SA', index: 'SMI', sector: 'Chemie / Aromen', profile: 'conservative', currency: 'CHF' },

  // US Large Caps (S&P 500 & Nasdaq 100)
  { symbol: 'MSFT', name: 'Microsoft Corp.', index: 'NASDAQ100', sector: 'US-Tech / Cloud', profile: 'conservative', currency: 'USD' },
  { symbol: 'AAPL', name: 'Apple Inc.', index: 'NASDAQ100', sector: 'US-Tech', profile: 'conservative', currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', index: 'NASDAQ100', sector: 'US-Tech / Search', profile: 'volatile', currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', index: 'NASDAQ100', sector: 'US-Tech / E-Commerce', profile: 'volatile', currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', index: 'NASDAQ100', sector: 'Halbleiter / AI', profile: 'volatile', currency: 'USD' },
  { symbol: 'META', name: 'Meta Platforms Inc.', index: 'NASDAQ100', sector: 'US-Tech', profile: 'volatile', currency: 'USD' },
  { symbol: 'TTWO', name: 'Take-Two Interactive', index: 'NASDAQ100', sector: 'Gaming', profile: 'volatile', currency: 'USD' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', index: 'NASDAQ100', sector: 'Halbleiter', profile: 'volatile', currency: 'USD' },
  { symbol: 'CRM', name: 'Salesforce Inc.', index: 'SP500', sector: 'Software', profile: 'volatile', currency: 'USD' },
  { symbol: 'ADBE', name: 'Adobe Inc.', index: 'NASDAQ100', sector: 'Software', profile: 'volatile', currency: 'USD' },
  { symbol: 'V', name: 'Visa Inc.', index: 'SP500', sector: 'Zahlungsdienstleister', profile: 'conservative', currency: 'USD' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', index: 'SP500', sector: 'Banken', profile: 'conservative', currency: 'USD' },
  { symbol: 'UNH', name: 'UnitedHealth Group', index: 'SP500', sector: 'Gesundheit', profile: 'conservative', currency: 'USD' },
  { symbol: 'PG', name: 'Procter & Gamble', index: 'SP500', sector: 'Basiskonsum', profile: 'conservative', currency: 'USD' }
];

/**
 * Prüft anhand der aktuellen Uhrzeit (Europe/Berlin), ob die Heimatbörse geöffnet ist.
 * Xetra/EU: Mo-Fr 09:00 - 17:30 Uhr MEZ/MESZ
 * NYSE/Nasdaq: Mo-Fr 15:30 - 22:00 Uhr MEZ/MESZ
 */
export function checkReferenceMarketOpen(region, dateObj = new Date()) {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(dateObj);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const weekday = map.weekday || '';
  const isWeekend = weekday.startsWith('Sa') || weekday.startsWith('So');
  const hour = parseInt(map.hour || '0', 10);
  const minute = parseInt(map.minute || '0', 10);
  const minutesOfDay = hour * 60 + minute;

  if (isWeekend) {
    return {
      isOpen: false,
      berlinTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Uhr`,
      reason: 'Wochenende (Börse geschlossen)'
    };
  }

  if (region === 'US') {
    const openMin = 15 * 60 + 30; // 15:30
    const closeMin = 22 * 60;     // 22:00
    const isOpen = minutesOfDay >= openMin && minutesOfDay <= closeMin;
    const isNearClose = minutesOfDay >= (21 * 60 + 35) && minutesOfDay <= closeMin;
    return {
      isOpen,
      isNearClose,
      berlinTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Uhr`,
      hoursLabel: '15:30–22:00 Uhr MEZ (NYSE/Nasdaq)',
      reason: isOpen ? 'Heimatbörse US geöffnet (Enge Spreads)' : 'Außerhalb US-Kernhandelszeit (15:30–22:00 MEZ) – Achtung: Spread-Ausweitung!'
    };
  }

  // Default EU (Xetra / Wien / Zürich / Euronext)
  const openMin = 9 * 60;         // 09:00
  const closeMin = 17 * 60 + 30;  // 17:30
  const isOpen = minutesOfDay >= openMin && minutesOfDay <= closeMin;
  const isNearClose = minutesOfDay >= (17 * 60 + 5) && minutesOfDay <= closeMin;
  return {
    isOpen,
    isNearClose,
    berlinTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} Uhr`,
    hoursLabel: '09:00–17:30 Uhr MEZ (Xetra/EU)',
    reason: isOpen ? 'Heimatbörse EU geöffnet (Enge Spreads)' : 'Außerhalb EU-Kernhandelszeit (09:00–17:30 MEZ) – Achtung: Spread-Ausweitung!'
  };
}
