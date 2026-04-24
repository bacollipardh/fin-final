// server/pricingBridge.js
// Klient HTTP për PricingBridge API
// Konfiguro PRICING_BRIDGE_URL në server/.env

const PRICING_BRIDGE_URL = (process.env.PRICING_BRIDGE_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Kërkon artikull nga PricingBridge
 * GET /api/articles/search?term=NMX054&top=20&sifraOe=1
 */
export async function pbSearchArticle(term, sifraOe = 1) {
  const params = new URLSearchParams({ term: term.trim(), top: '20', sifraOe: String(sifraOe) });
  const res = await fetch(`${PRICING_BRIDGE_URL}/api/articles/search?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PricingBridge article search HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.articles ?? data.data ?? []);
}

/**
 * Merr çmimin nga PricingBridge
 * GET /api/pricing/lookup?sifraKup=...&sifraObj=...&sifraArt=...&lotBr=...
 */
export async function pbLookupPrice({ sifraKup, sifraObj, sifraArt, lotBr }) {
  const params = new URLSearchParams({ sifraKup, sifraArt });
  if (sifraObj != null) params.append('sifraObj', String(sifraObj));
  if (lotBr)            params.append('lotBr', lotBr);

  const res = await fetch(`${PRICING_BRIDGE_URL}/api/pricing/lookup?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PricingBridge pricing lookup HTTP ${res.status}`);
  const data = await res.json();
  if (data.found === false) return null;

  // PricingBridge v2 format: { found, matchLevel, data: { cmimiBaze, ... } }
  const raw = data.result ?? data.data ?? data ?? null;
  if (!raw) return null;

  // Normalize camelCase -> PascalCase për UI
  if (raw.cmimiBaze !== undefined) {
    return {
      MatchLevel:        data.matchLevel ?? raw.matchLevel,
      Bleresi:           raw.bleresi,
      ObjektiBleresit:   raw.objektiBleresit,
      LotBr:             raw.lotBr,
      Broj_Dok:          raw.brojDok,
      Datum_Dok:         raw.datumDok,
      CmimiBaze:         raw.cmimiBaze,
      RabatKombinuarPct: raw.rabatKombinuarPct,
      DDVPct:            raw.ddvPct,
      CmimiPasRabateve:  raw.cmimiPasRabateve,
      VleraPaDDV:        raw.vleraPaDDV,
      Sifra_Kup:         raw.sifraKup,
      Sifra_Obj:         raw.sifraObj,
      RokRed:            raw.rokRed ?? null,
    };
  }
  return raw;
}
