/**
 * Großes Institutionelles Anlageuniversum & Referenzmarkt-Definitionen gemäß Playbook Kapitel 02 & 04.
 * Über 145 liquide Large & Mid Caps (Qualitätsaktien) aus:
 * - DAX 40 (Deutschland)
 * - MDAX & TecDAX (Deutschland Mid/Tech Caps)
 * - ATX Prime (Österreich)
 * - SMI & SMIM (Schweiz)
 * - EuroStoxx 50 & Europa-Qualitätsführer (Frankreich, Niederlande, Italien, Spanien, Skandinavien, UK)
 * - S&P 500 & Nasdaq 100 (USA Blue Chips & Tech-Marktführer)
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
  // ============================================================================
  // DAX 40 (DEUTSCHLAND LARGE CAPS)
  // ============================================================================
  { symbol: 'SY1.DE', name: 'Symrise AG', index: 'DAX', sector: 'Chemie / Duftstoffe', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SAP.DE', name: 'SAP SE', index: 'DAX', sector: 'Enterprise Software', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SIE.DE', name: 'Siemens AG', index: 'DAX', sector: 'Industrie / Automation', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ALV.DE', name: 'Allianz SE', index: 'DAX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'MUV2.DE', name: 'Münchener Rück', index: 'DAX', sector: 'Rückversicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DTE.DE', name: 'Deutsche Telekom AG', index: 'DAX', sector: 'Telekommunikation', profile: 'conservative', currency: 'EUR' },
  { symbol: 'IFX.DE', name: 'Infineon Technologies', index: 'DAX', sector: 'Halbleiter', profile: 'volatile', currency: 'EUR' },
  { symbol: 'ADS.DE', name: 'adidas AG', index: 'DAX', sector: 'Sport & Konsum', profile: 'volatile', currency: 'EUR' },
  { symbol: 'DHL.DE', name: 'DHL Group', index: 'DAX', sector: 'Logistik & Fracht', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DB1.DE', name: 'Deutsche Börse AG', index: 'DAX', sector: 'Finanzinfrastruktur', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BEI.DE', name: 'Beiersdorf AG', index: 'DAX', sector: 'Basiskonsum / Kosmetik', profile: 'conservative', currency: 'EUR' },
  { symbol: 'MRK.DE', name: 'Merck KGaA', index: 'DAX', sector: 'Pharma & Spezialchemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'MTX.DE', name: 'MTU Aero Engines', index: 'DAX', sector: 'Luftfahrt / Triebwerke', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BAS.DE', name: 'BASF SE', index: 'DAX', sector: 'Chemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'RHM.DE', name: 'Rheinmetall AG', index: 'DAX', sector: 'Verteidigung & Industrie', profile: 'volatile', currency: 'EUR' },
  { symbol: 'ENR.DE', name: 'Siemens Energy AG', index: 'DAX', sector: 'Energietechnik', profile: 'volatile', currency: 'EUR' },
  { symbol: 'EOAN.DE', name: 'E.ON SE', index: 'DAX', sector: 'Versorger / Netze', profile: 'conservative', currency: 'EUR' },
  { symbol: 'RWE.DE', name: 'RWE AG', index: 'DAX', sector: 'Energie & Erneuerbare', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DBK.DE', name: 'Deutsche Bank AG', index: 'DAX', sector: 'Banken', profile: 'volatile', currency: 'EUR' },
  { symbol: 'CBK.DE', name: 'Commerzbank AG', index: 'DAX', sector: 'Banken', profile: 'volatile', currency: 'EUR' },
  { symbol: 'MBG.DE', name: 'Mercedes-Benz Group', index: 'DAX', sector: 'Automobil', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BMW.DE', name: 'BMW AG', index: 'DAX', sector: 'Automobil', profile: 'conservative', currency: 'EUR' },
  { symbol: 'VOW3.DE', name: 'Volkswagen AG Vz.', index: 'DAX', sector: 'Automobil', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DTG.DE', name: 'Daimler Truck Holding', index: 'DAX', sector: 'Nutzfahrzeuge', profile: 'conservative', currency: 'EUR' },
  { symbol: 'HEN3.DE', name: 'Henkel AG & Co. KGaA', index: 'DAX', sector: 'Basiskonsum & Klebstoffe', profile: 'conservative', currency: 'EUR' },
  { symbol: 'FRE.DE', name: 'Fresenius SE & Co. KGaA', index: 'DAX', sector: 'Gesundheit / Kliniken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SHL.DE', name: 'Siemens Healthineers', index: 'DAX', sector: 'Medizintechnik', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SRT3.DE', name: 'Sartorius AG Vz.', index: 'DAX', sector: 'Labor- & Bioprozesstechnik', profile: 'volatile', currency: 'EUR' },
  { symbol: 'HEI.DE', name: 'Heidelberg Materials', index: 'DAX', sector: 'Baustoffe', profile: 'conservative', currency: 'EUR' },
  { symbol: 'VNA.DE', name: 'Vonovia SE', index: 'DAX', sector: 'Immobilien', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BNR.DE', name: 'Brenntag SE', index: 'DAX', sector: 'Chemiedistribution', profile: 'conservative', currency: 'EUR' },
  { symbol: 'CON.DE', name: 'Continental AG', index: 'DAX', sector: 'Reifen & Autozulieferer', profile: 'volatile', currency: 'EUR' },
  { symbol: 'HNR1.DE', name: 'Hannover Rück SE', index: 'DAX', sector: 'Rückversicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'QIA.DE', name: 'QIAGEN N.V.', index: 'DAX', sector: 'Diagnostik & Biotech', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ZAL.DE', name: 'Zalando SE', index: 'DAX', sector: 'E-Commerce', profile: 'volatile', currency: 'EUR' },

  // ============================================================================
  // MDAX & TECDAX (DEUTSCHLAND MID CAPS)
  // ============================================================================
  { symbol: 'FPE3.DE', name: 'Fuchs SE Vz.', index: 'MDAX', sector: 'Schmierstoffe / Chemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'NEM.DE', name: 'Nemetschek SE', index: 'MDAX', sector: 'Bausoftware / CAD', profile: 'volatile', currency: 'EUR' },
  { symbol: 'KRN.DE', name: 'Krones AG', index: 'MDAX', sector: 'Abfüll- & Verpackungstechnik', profile: 'conservative', currency: 'EUR' },
  { symbol: 'G1A.DE', name: 'GEA Group AG', index: 'MDAX', sector: 'Prozesstechnik / Anlagenbau', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BOSS.DE', name: 'Hugo Boss AG', index: 'MDAX', sector: 'Premium-Mode', profile: 'volatile', currency: 'EUR' },
  { symbol: 'LEG.DE', name: 'LEG Immobilien SE', index: 'MDAX', sector: 'Wohnimmobilien', profile: 'conservative', currency: 'EUR' },
  { symbol: 'EVK.DE', name: 'Evonik Industries AG', index: 'MDAX', sector: 'Spezialchemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'LXS.DE', name: 'Lanxess AG', index: 'MDAX', sector: 'Spezialchemie', profile: 'volatile', currency: 'EUR' },
  { symbol: 'WCH.DE', name: 'Wacker Chemie AG', index: 'MDAX', sector: 'Polysilizium & Chemie', profile: 'volatile', currency: 'EUR' },
  { symbol: 'RAA.DE', name: 'Rational AG', index: 'MDAX', sector: 'Großküchentechnik', profile: 'conservative', currency: 'EUR' },
  { symbol: 'KGX.DE', name: 'KION Group AG', index: 'MDAX', sector: 'Gabelstapler & Lagertechnik', profile: 'volatile', currency: 'EUR' },
  { symbol: 'JUN3.DE', name: 'Jungheinrich AG Vz.', index: 'MDAX', sector: 'Intralogistik', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BC8.DE', name: 'Bechtle AG', index: 'MDAX', sector: 'IT-Systemhaus', profile: 'conservative', currency: 'EUR' },
  { symbol: 'EVD.DE', name: 'CTS Eventim AG', index: 'MDAX', sector: 'Ticketing & Live-Events', profile: 'conservative', currency: 'EUR' },
  { symbol: 'G24.DE', name: 'Scout24 SE', index: 'MDAX', sector: 'Online-Marktplätze', profile: 'conservative', currency: 'EUR' },
  { symbol: 'TLX.DE', name: 'Talanx AG', index: 'MDAX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'HAG.DE', name: 'Hensoldt AG', index: 'MDAX', sector: 'Verteidigungselektronik', profile: 'volatile', currency: 'EUR' },
  { symbol: 'AIXA.DE', name: 'AIXTRON SE', index: 'MDAX', sector: 'Halbleiterausrüstung', profile: 'volatile', currency: 'EUR' },
  { symbol: 'JEN.DE', name: 'Jenoptik AG', index: 'MDAX', sector: 'Photonik & Optik', profile: 'volatile', currency: 'EUR' },
  { symbol: 'AFX.DE', name: 'Carl Zeiss Meditec AG', index: 'MDAX', sector: 'Medizintechnik / Optik', profile: 'volatile', currency: 'EUR' },
  { symbol: 'FRA.DE', name: 'Fraport AG', index: 'MDAX', sector: 'Flughafenbetreiber', profile: 'conservative', currency: 'EUR' },
  { symbol: 'LHA.DE', name: 'Deutsche Lufthansa AG', index: 'MDAX', sector: 'Luftfahrt', profile: 'volatile', currency: 'EUR' },
  { symbol: 'PUM.DE', name: 'PUMA SE', index: 'MDAX', sector: 'Sportartikel', profile: 'volatile', currency: 'EUR' },
  { symbol: 'NDA.DE', name: 'Aurubis AG', index: 'MDAX', sector: 'Kupfer & Recycling', profile: 'conservative', currency: 'EUR' },
  { symbol: 'HOT.DE', name: 'HOCHTIEF AG', index: 'MDAX', sector: 'Infrastrukturbau', profile: 'conservative', currency: 'EUR' },

  // ============================================================================
  // ATX PRIME (ÖSTERREICH)
  // ============================================================================
  { symbol: 'EBS.VI', name: 'Erste Group Bank AG', index: 'ATX', sector: 'Banken CEE/AT', profile: 'conservative', currency: 'EUR' },
  { symbol: 'OMV.VI', name: 'OMV AG', index: 'ATX', sector: 'Energie & Petrochemie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'VER.VI', name: 'Verbund AG', index: 'ATX', sector: 'Wasserkraft & Strom', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ANDR.VI', name: 'Andritz AG', index: 'ATX', sector: 'Anlagen- & Maschinenbau', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BG.VI', name: 'BAWAG Group AG', index: 'ATX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'VOE.VI', name: 'voestalpine AG', index: 'ATX', sector: 'Spezialstahl & Technologie', profile: 'conservative', currency: 'EUR' },
  { symbol: 'RBI.VI', name: 'Raiffeisen Bank Intl.', index: 'ATX', sector: 'Banken', profile: 'volatile', currency: 'EUR' },
  { symbol: 'WIE.VI', name: 'Wienerberger AG', index: 'ATX', sector: 'Baustoffe & Infrastruktur', profile: 'conservative', currency: 'EUR' },
  { symbol: 'VIG.VI', name: 'Vienna Insurance Group', index: 'ATX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'UQA.VI', name: 'UNIQA Insurance Group', index: 'ATX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'EVN.VI', name: 'EVN AG', index: 'ATX', sector: 'Versorger', profile: 'conservative', currency: 'EUR' },
  { symbol: 'POST.VI', name: 'Österreichische Post AG', index: 'ATX', sector: 'Logistik & Paket', profile: 'conservative', currency: 'EUR' },
  { symbol: 'STR.VI', name: 'STRABAG SE', index: 'ATX', sector: 'Baukonzern', profile: 'conservative', currency: 'EUR' },
  { symbol: 'PAL.VI', name: 'Palfinger AG', index: 'ATX', sector: 'Kran- & Hebesysteme', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DOC.VI', name: 'DO & CO AG', index: 'ATX', sector: 'Gourmet-Catering', profile: 'volatile', currency: 'EUR' },

  // ============================================================================
  // EUROSTOXX 50 & EUROPA-CHAMPIONS (NL, FR, IT, ES, NORDICS, UK)
  // ============================================================================
  { symbol: 'ASML.AS', name: 'ASML Holding NV', index: 'EUROSTOXX', sector: 'Halbleiter-Lithografie', profile: 'volatile', currency: 'EUR' },
  { symbol: 'MC.PA', name: 'LVMH Moët Hennessy', index: 'EUROSTOXX', sector: 'Luxusgüter', profile: 'conservative', currency: 'EUR' },
  { symbol: 'OR.PA', name: "L'Oréal S.A.", index: 'EUROSTOXX', sector: 'Kosmetik & Konsum', profile: 'conservative', currency: 'EUR' },
  { symbol: 'RMS.PA', name: 'Hermès International', index: 'EUROSTOXX', sector: 'Ultra-Luxusgüter', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SU.PA', name: 'Schneider Electric SE', index: 'EUROSTOXX', sector: 'Elektrifizierung & Automation', profile: 'conservative', currency: 'EUR' },
  { symbol: 'AIR.PA', name: 'Airbus SE', index: 'EUROSTOXX', sector: 'Luft- & Raumfahrt', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SAN.PA', name: 'Sanofi S.A.', index: 'EUROSTOXX', sector: 'Pharma', profile: 'conservative', currency: 'EUR' },
  { symbol: 'AI.PA', name: 'Air Liquide S.A.', index: 'EUROSTOXX', sector: 'Industriegase', profile: 'conservative', currency: 'EUR' },
  { symbol: 'TTE.PA', name: 'TotalEnergies SE', index: 'EUROSTOXX', sector: 'Energie & LNG', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BNP.PA', name: 'BNP Paribas S.A.', index: 'EUROSTOXX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DG.PA', name: 'Vinci S.A.', index: 'EUROSTOXX', sector: 'Infrastruktur & Konzessionen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SAF.PA', name: 'Safran S.A.', index: 'EUROSTOXX', sector: 'Triebwerke & Luftfahrt', profile: 'conservative', currency: 'EUR' },
  { symbol: 'EL.PA', name: 'EssilorLuxottica', index: 'EUROSTOXX', sector: 'Augenoptik & MedTech', profile: 'conservative', currency: 'EUR' },
  { symbol: 'DSY.PA', name: 'Dassault Systèmes', index: 'EUROSTOXX', sector: '3D-Industriesoftware', profile: 'volatile', currency: 'EUR' },
  { symbol: 'CAP.PA', name: 'Capgemini SE', index: 'EUROSTOXX', sector: 'IT-Beratung', profile: 'conservative', currency: 'EUR' },
  { symbol: 'CS.PA', name: 'AXA S.A.', index: 'EUROSTOXX', sector: 'Versicherungen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'BN.PA', name: 'Danone S.A.', index: 'EUROSTOXX', sector: 'Nahrungsmittel', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ITX.MC', name: 'Inditex (Zara)', index: 'EUROSTOXX', sector: 'Mode & Retail', profile: 'conservative', currency: 'EUR' },
  { symbol: 'IBE.MC', name: 'Iberdrola S.A.', index: 'EUROSTOXX', sector: 'Erneuerbare Energien', profile: 'conservative', currency: 'EUR' },
  { symbol: 'SAN.MC', name: 'Banco Santander', index: 'EUROSTOXX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ENEL.MI', name: 'Enel S.p.A.', index: 'EUROSTOXX', sector: 'Versorger', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ISP.MI', name: 'Intesa Sanpaolo', index: 'EUROSTOXX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'UCG.MI', name: 'UniCredit S.p.A.', index: 'EUROSTOXX', sector: 'Banken', profile: 'volatile', currency: 'EUR' },
  { symbol: 'RACE.MI', name: 'Ferrari N.V.', index: 'EUROSTOXX', sector: 'Luxus-Sportwagen', profile: 'conservative', currency: 'EUR' },
  { symbol: 'INGA.AS', name: 'ING Groep N.V.', index: 'EUROSTOXX', sector: 'Banken', profile: 'conservative', currency: 'EUR' },
  { symbol: 'AD.AS', name: 'Ahold Delhaize', index: 'EUROSTOXX', sector: 'Lebensmitteleinzelhandel', profile: 'conservative', currency: 'EUR' },
  { symbol: 'WKL.AS', name: 'Wolters Kluwer', index: 'EUROSTOXX', sector: 'Fachinformationen & Software', profile: 'conservative', currency: 'EUR' },
  { symbol: 'ASM.AS', name: 'ASM International', index: 'EUROSTOXX', sector: 'Halbleiter-Equipment', profile: 'volatile', currency: 'EUR' },
  { symbol: 'ADYEN.AS', name: 'Adyen N.V.', index: 'EUROSTOXX', sector: 'Payment & FinTech', profile: 'volatile', currency: 'EUR' },

  // ============================================================================
  // SMI & SMIM (SCHWEIZ QUALITY LARGE CAPS)
  // ============================================================================
  { symbol: 'NESN.SW', name: 'Nestlé S.A.', index: 'SMI', sector: 'Basiskonsum / Ernährung', profile: 'conservative', currency: 'CHF' },
  { symbol: 'NOVN.SW', name: 'Novartis AG', index: 'SMI', sector: 'Pharma', profile: 'conservative', currency: 'CHF' },
  { symbol: 'SIKA.SW', name: 'Sika AG', index: 'SMI', sector: 'Bauchemie', profile: 'conservative', currency: 'CHF' },
  { symbol: 'ZURN.SW', name: 'Zurich Insurance Group', index: 'SMI', sector: 'Versicherungen', profile: 'conservative', currency: 'CHF' },
  { symbol: 'ABBN.SW', name: 'ABB Ltd', index: 'SMI', sector: 'Automation & Elektrifizierung', profile: 'conservative', currency: 'CHF' },
  { symbol: 'GIVN.SW', name: 'Givaudan SA', index: 'SMI', sector: 'Aromen & Duftstoffe', profile: 'conservative', currency: 'CHF' },
  { symbol: 'UBSG.SW', name: 'UBS Group AG', index: 'SMI', sector: 'Vermögensverwaltung / Bank', profile: 'conservative', currency: 'CHF' },
  { symbol: 'LONN.SW', name: 'Lonza Group AG', index: 'SMI', sector: 'Pharma-Auftragsfertigung', profile: 'conservative', currency: 'CHF' },
  { symbol: 'ALC.SW', name: 'Alcon Inc.', index: 'SMI', sector: 'Augenheilkunde', profile: 'conservative', currency: 'CHF' },
  { symbol: 'HOLN.SW', name: 'Holcim Ltd', index: 'SMI', sector: 'Baustoffe', profile: 'conservative', currency: 'CHF' },
  { symbol: 'SREN.SW', name: 'Swiss Re AG', index: 'SMI', sector: 'Rückversicherungen', profile: 'conservative', currency: 'CHF' },
  { symbol: 'GEBN.SW', name: 'Geberit AG', index: 'SMI', sector: 'Sanitärtechnik', profile: 'conservative', currency: 'CHF' },
  { symbol: 'PGHN.SW', name: 'Partners Group Holding', index: 'SMI', sector: 'Private Markets', profile: 'volatile', currency: 'CHF' },
  { symbol: 'SOON.SW', name: 'Sonova Holding AG', index: 'SMI', sector: 'Hörgeräte / MedTech', profile: 'conservative', currency: 'CHF' },
  { symbol: 'SLHN.SW', name: 'Swiss Life Holding', index: 'SMI', sector: 'Versicherungen & Vorsorge', profile: 'conservative', currency: 'CHF' },
  { symbol: 'SCMN.SW', name: 'Swisscom AG', index: 'SMI', sector: 'Telekommunikation', profile: 'conservative', currency: 'CHF' },
  { symbol: 'KNIN.SW', name: 'Kühne + Nagel Intl.', index: 'SMI', sector: 'See- & Luftfrachtlogistik', profile: 'conservative', currency: 'CHF' },
  { symbol: 'LOGN.SW', name: 'Logitech International', index: 'SMI', sector: 'Computer-Peripherie', profile: 'volatile', currency: 'CHF' },
  { symbol: 'VATN.SW', name: 'VAT Group AG', index: 'SMI', sector: 'Halbleiter-Vakuumventile', profile: 'volatile', currency: 'CHF' },
  { symbol: 'STMN.SW', name: 'Straumann Holding AG', index: 'SMI', sector: 'Dentalimplantate', profile: 'volatile', currency: 'CHF' },

  // ============================================================================
  // NASDAQ 100 & S&P 500 (US MEGA & LARGE CAPS)
  // ============================================================================
  { symbol: 'MSFT', name: 'Microsoft Corp.', index: 'NASDAQ100', sector: 'Cloud & Enterprise AI', profile: 'conservative', currency: 'USD' },
  { symbol: 'AAPL', name: 'Apple Inc.', index: 'NASDAQ100', sector: 'Consumer Tech', profile: 'conservative', currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', index: 'NASDAQ100', sector: 'KI-Halbleiter & GPUs', profile: 'volatile', currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', index: 'NASDAQ100', sector: 'Search, Cloud & AI', profile: 'volatile', currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', index: 'NASDAQ100', sector: 'AWS Cloud & E-Commerce', profile: 'volatile', currency: 'USD' },
  { symbol: 'META', name: 'Meta Platforms Inc.', index: 'NASDAQ100', sector: 'Social Platforms & AI', profile: 'volatile', currency: 'USD' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', index: 'NASDAQ100', sector: 'Halbleiter & Infrastruktur', profile: 'volatile', currency: 'USD' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor (ADR)', index: 'SP500', sector: 'Halbleiter-Foundry', profile: 'volatile', currency: 'USD' },
  { symbol: 'ASML', name: 'ASML Holding (US ADR)', index: 'NASDAQ100', sector: 'Halbleiter-Lithografie', profile: 'volatile', currency: 'USD' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', index: 'NASDAQ100', sector: 'CPUs & KI-Chips', profile: 'volatile', currency: 'USD' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', index: 'NASDAQ100', sector: 'Mobilfunk-Halbleiter', profile: 'volatile', currency: 'USD' },
  { symbol: 'TXN', name: 'Texas Instruments', index: 'NASDAQ100', sector: 'Analog-Halbleiter', profile: 'conservative', currency: 'USD' },
  { symbol: 'AMAT', name: 'Applied Materials Inc.', index: 'NASDAQ100', sector: 'Halbleiter-Equipment', profile: 'volatile', currency: 'USD' },
  { symbol: 'LRCX', name: 'Lam Research Corp.', index: 'NASDAQ100', sector: 'Wafer-Equipment', profile: 'volatile', currency: 'USD' },
  { symbol: 'KLAC', name: 'KLA Corp.', index: 'NASDAQ100', sector: 'Halbleiter-Inspektion', profile: 'volatile', currency: 'USD' },
  { symbol: 'MU', name: 'Micron Technology', index: 'NASDAQ100', sector: 'HBM & Speicherchips', profile: 'volatile', currency: 'USD' },
  { symbol: 'NFLX', name: 'Netflix Inc.', index: 'NASDAQ100', sector: 'Streaming & Entertainment', profile: 'volatile', currency: 'USD' },
  { symbol: 'TTWO', name: 'Take-Two Interactive', index: 'NASDAQ100', sector: 'Gaming (GTA / 2K)', profile: 'volatile', currency: 'USD' },
  { symbol: 'CSCO', name: 'Cisco Systems Inc.', index: 'NASDAQ100', sector: 'Netzwerk & Security', profile: 'conservative', currency: 'USD' },
  { symbol: 'TMUS', name: 'T-Mobile US Inc.', index: 'NASDAQ100', sector: 'Mobilfunk & 5G', profile: 'conservative', currency: 'USD' },
  { symbol: 'IBM', name: 'IBM Corp.', index: 'SP500', sector: 'Enterprise Cloud & AI', profile: 'conservative', currency: 'USD' },
  { symbol: 'ADP', name: 'Automatic Data Processing', index: 'NASDAQ100', sector: 'HR- & Payroll-Software', profile: 'conservative', currency: 'USD' },
  { symbol: 'CRM', name: 'Salesforce Inc.', index: 'SP500', sector: 'Enterprise CRM Cloud', profile: 'volatile', currency: 'USD' },
  { symbol: 'ADBE', name: 'Adobe Inc.', index: 'NASDAQ100', sector: 'Creative & Document Cloud', profile: 'volatile', currency: 'USD' },
  { symbol: 'NOW', name: 'ServiceNow Inc.', index: 'SP500', sector: 'IT-Workflow Cloud', profile: 'volatile', currency: 'USD' },
  { symbol: 'INTU', name: 'Intuit Inc.', index: 'NASDAQ100', sector: 'Finanz- & Steuersoftware', profile: 'volatile', currency: 'USD' },
  { symbol: 'ORCL', name: 'Oracle Corp.', index: 'SP500', sector: 'Datenbanken & Cloud', profile: 'conservative', currency: 'USD' },
  { symbol: 'PANW', name: 'Palo Alto Networks', index: 'NASDAQ100', sector: 'Cybersecurity', profile: 'volatile', currency: 'USD' },
  { symbol: 'SNPS', name: 'Synopsys Inc.', index: 'NASDAQ100', sector: 'Chip-Design EDA Software', profile: 'volatile', currency: 'USD' },
  { symbol: 'CDNS', name: 'Cadence Design Systems', index: 'NASDAQ100', sector: 'Chip-Design Software', profile: 'volatile', currency: 'USD' },
  { symbol: 'ISRG', name: 'Intuitive Surgical', index: 'NASDAQ100', sector: 'OP-Robotik (da Vinci)', profile: 'volatile', currency: 'USD' },
  { symbol: 'BKNG', name: 'Booking Holdings Inc.', index: 'NASDAQ100', sector: 'Online-Reiseplattform', profile: 'conservative', currency: 'USD' },
  { symbol: 'UBER', name: 'Uber Technologies', index: 'SP500', sector: 'Mobilität & Delivery', profile: 'volatile', currency: 'USD' },
  { symbol: 'SBUX', name: 'Starbucks Corp.', index: 'NASDAQ100', sector: 'Gastronomie & Konsum', profile: 'conservative', currency: 'USD' },
  { symbol: 'GILD', name: 'Gilead Sciences Inc.', index: 'NASDAQ100', sector: 'Biopharma & Virologie', profile: 'conservative', currency: 'USD' },
  { symbol: 'LMT', name: 'Lockheed Martin Corp.', index: 'SP500', sector: 'Luftfahrt & Verteidigung', profile: 'conservative', currency: 'USD' },
  { symbol: 'RTX', name: 'RTX Corp. (Raytheon)', index: 'SP500', sector: 'Triebwerke & Verteidigung', profile: 'conservative', currency: 'USD' },

  // S&P 500 Finanzen, Industrie, Gesundheit & Konsum-Giganten
  { symbol: 'BRK-B', name: 'Berkshire Hathaway B', index: 'SP500', sector: 'Beteiligungen & Versicherung', profile: 'conservative', currency: 'USD' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', index: 'SP500', sector: 'US-Großbanken', profile: 'conservative', currency: 'USD' },
  { symbol: 'V', name: 'Visa Inc.', index: 'SP500', sector: 'Zahlungsnetzwerk', profile: 'conservative', currency: 'USD' },
  { symbol: 'MA', name: 'Mastercard Inc.', index: 'SP500', sector: 'Zahlungsnetzwerk', profile: 'conservative', currency: 'USD' },
  { symbol: 'AXP', name: 'American Express Co.', index: 'SP500', sector: 'Kreditkarten & Finanzen', profile: 'conservative', currency: 'USD' },
  { symbol: 'BLK', name: 'BlackRock Inc.', index: 'SP500', sector: 'Vermögensverwaltung / ETFs', profile: 'conservative', currency: 'USD' },
  { symbol: 'SPGI', name: 'S&P Global Inc.', index: 'SP500', sector: 'Finanzdaten & Ratings', profile: 'conservative', currency: 'USD' },
  { symbol: 'UNH', name: 'UnitedHealth Group', index: 'SP500', sector: 'Krankenversicherung', profile: 'conservative', currency: 'USD' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', index: 'SP500', sector: 'Pharma (GLP-1 / Onkologie)', profile: 'volatile', currency: 'USD' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', index: 'SP500', sector: 'Pharma & MedTech', profile: 'conservative', currency: 'USD' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', index: 'SP500', sector: 'Biopharma & Immunologie', profile: 'conservative', currency: 'USD' },
  { symbol: 'MRK', name: 'Merck & Co. Inc. (US)', index: 'SP500', sector: 'Pharma / Onkologie', profile: 'conservative', currency: 'USD' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific', index: 'SP500', sector: 'Labor- & Diagnostiktechnik', profile: 'conservative', currency: 'USD' },
  { symbol: 'ABT', name: 'Abbott Laboratories', index: 'SP500', sector: 'Medizintechnik & Diagnostik', profile: 'conservative', currency: 'USD' },
  { symbol: 'SYK', name: 'Stryker Corp.', index: 'SP500', sector: 'Orthopädie & MedTech', profile: 'conservative', currency: 'USD' },
  { symbol: 'AMGN', name: 'Amgen Inc.', index: 'NASDAQ100', sector: 'Biotechnologie', profile: 'conservative', currency: 'USD' },
  { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', index: 'NASDAQ100', sector: 'Biopharma', profile: 'conservative', currency: 'USD' },
  { symbol: 'PG', name: 'Procter & Gamble Co.', index: 'SP500', sector: 'Basiskonsumgüter', profile: 'conservative', currency: 'USD' },
  { symbol: 'KO', name: 'The Coca-Cola Co.', index: 'SP500', sector: 'Getränke / Basiskonsum', profile: 'conservative', currency: 'USD' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', index: 'NASDAQ100', sector: 'Getränke & Snacks', profile: 'conservative', currency: 'USD' },
  { symbol: 'COST', name: 'Costco Wholesale Corp.', index: 'NASDAQ100', sector: 'Groß- & Einzelhandel', profile: 'conservative', currency: 'USD' },
  { symbol: 'WMT', name: 'Walmart Inc.', index: 'SP500', sector: 'Einzelhandel', profile: 'conservative', currency: 'USD' },
  { symbol: 'HD', name: 'The Home Depot Inc.', index: 'SP500', sector: 'Baumärkte & Immobilienzulieferer', profile: 'conservative', currency: 'USD' },
  { symbol: 'MCD', name: "McDonald's Corp.", index: 'SP500', sector: 'Systemgastronomie', profile: 'conservative', currency: 'USD' },
  { symbol: 'NKE', name: 'NIKE Inc.', index: 'SP500', sector: 'Sportbekleidung', profile: 'volatile', currency: 'USD' },
  { symbol: 'DIS', name: 'The Walt Disney Co.', index: 'SP500', sector: 'Entertainment & Freizeitparks', profile: 'volatile', currency: 'USD' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', index: 'SP500', sector: 'Baumaschinen & Bergbau', profile: 'conservative', currency: 'USD' },
  { symbol: 'DE', name: 'Deere & Co. (John Deere)', index: 'SP500', sector: 'Landtechnik & Agrar', profile: 'conservative', currency: 'USD' },
  { symbol: 'GE', name: 'GE Aerospace', index: 'SP500', sector: 'Flugzeugtriebwerke', profile: 'conservative', currency: 'USD' },
  { symbol: 'HON', name: 'Honeywell International', index: 'NASDAQ100', sector: 'Industrie & Luftfahrt', profile: 'conservative', currency: 'USD' },
  { symbol: 'UNP', name: 'Union Pacific Corp.', index: 'SP500', sector: 'Schienenlogistik', profile: 'conservative', currency: 'USD' },
  { symbol: 'LIN', name: 'Linde plc', index: 'NASDAQ100', sector: 'Industriegase', profile: 'conservative', currency: 'USD' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', index: 'SP500', sector: 'Energie & Öl', profile: 'conservative', currency: 'USD' },
  { symbol: 'CVX', name: 'Chevron Corp.', index: 'SP500', sector: 'Energie & Gas', profile: 'conservative', currency: 'USD' },
  { symbol: 'NEE', name: 'NextEra Energy Inc.', index: 'SP500', sector: 'Versorger & Wind/Solar', profile: 'conservative', currency: 'USD' }
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
