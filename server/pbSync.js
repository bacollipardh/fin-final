// server/pbSync.js
// -------------------------------------------------------
// Sinkronizon të dhënat nga PricingBridge API në databazën lokale
// Thirret nga cron çdo 12 orë dhe gjatë startit të serverit
// -------------------------------------------------------

import { q } from './db.js';

const PRICING_BRIDGE_URL = (process.env.PRICING_BRIDGE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SYNC_TIMEOUT_MS = 30_000;

// ── Helper: fetch me timeout ──────────────────────────────
async function pbFetch(path) {
  const res = await fetch(`${PRICING_BRIDGE_URL}${path}`, {
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PricingBridge ${path} HTTP ${res.status}`);
  return res.json();
}

// ── 1. Sync Artikujt ─────────────────────────────────────
// Kerko me 2-karakter prefix per te kapur te gjithe artikujt
// pa limit (1-karakter + top=2000 humbet artikuj)
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function buildPrefixes() {
  const prefixes = [];
  // 2-karakter kombinime: aa, ab, ... zz, a0, ... z9, 0a, ... 9z, 00, ... 99
  for (const c1 of CHARS) {
    for (const c2 of CHARS) {
      prefixes.push(c1 + c2);
    }
  }
  return prefixes;
}

export async function syncArticles() {
  console.log('[pbSync] Starting articles sync (2-char prefix mode)...');
  try {
    const allArticles = [];
    const seen = new Set();
    const prefixes = buildPrefixes(); // 1296 kombinime
    const batchSize = 10; // kerkesa paralele njeresh

    for (let i = 0; i < prefixes.length; i += batchSize) {
      const batch = prefixes.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(prefix =>
          pbFetch(`/api/articles/search?term=${prefix}&top=500&sifraOe=1`).catch(() => null)
        )
      );
      for (const data of results) {
        if (!data) continue;
        const arts = Array.isArray(data) ? data : (data.data ?? data.articles ?? []);
        for (const art of arts) {
          const key = art.Sifra_Art?.trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            allArticles.push(art);
          }
        }
      }
      // Log progress çdo 100 batch
      if ((i / batchSize) % 10 === 0) {
        console.log(`[pbSync] Progress: ${i+batchSize}/${prefixes.length} prefixes, ${allArticles.length} articles so far`);
      }
    }

    const articles = allArticles;

    if (!articles.length) {
      console.log('[pbSync] No articles returned from PricingBridge');
      return 0;
    }

    // Build pb_id -> local division id map nga DB
    const divMapRes = await q('SELECT id, pb_id FROM divisions WHERE pb_id IS NOT NULL');
    const pbToLocal = {};
    for (const row of divMapRes.rows) pbToLocal[row.pb_id] = row.id;

    let count = 0;
    for (const art of articles) {
      if (!art.Sifra_Art || !art.ImeArt) continue;

      // Filtro: kalon vetem artikuj me Sifra_Div te njohur, jo OTHER (8), jo NULL
      const pbDivId = art.Sifra_Div ? Number(art.Sifra_Div) : null;
      if (!pbDivId || pbDivId === 8) continue;

      // Perdor local division id (jo PB Sifra_Div)
      const localDivId = pbToLocal[pbDivId] || null;
      if (!localDivId) continue; // div pa mapping (HORECA, LEDO etj) - kalo

      const sku    = art.Sifra_Art.trim();
      const name   = (art.ImeArt || '').trim();
      const price  = Number(art.CmimiBaze || art.DogCena || 0);
      const barkod = art.BarKodGlaven || art.BarKod2 || null;

      await q(
        `INSERT INTO articles(sku, name, sell_price, barkod, division_id)
         VALUES($1, $2, $3, $4, $5)
         ON CONFLICT(sku) DO UPDATE
           SET name        = EXCLUDED.name,
               sell_price  = EXCLUDED.sell_price,
               barkod      = EXCLUDED.barkod,
               division_id = EXCLUDED.division_id`,
        [sku, name, price, barkod, localDivId]
      );
      count++;
    }

    // Divisions menaxhohen manualisht - NUK sync-ohen nga PricingBridge
    // (PB ka ID te ndryshme nga DB jone, mapping behet nepermjet pb_id kolones)
    console.log(`[pbSync] Articles synced: ${count}, Divisions: skipped (manual)`);
    return count;
  } catch (err) {
    console.error('[pbSync] Articles sync error:', err.message);
    return 0;
  }
}

// ── 2. Sync Blerësit + Objektet ──────────────────────────
// Merr listën e blerësve të unikë nga /api/buyers (nëse ekziston)
// ose nga /api/pricing/buyers
export async function syncBuyers() {
  console.log('[pbSync] Starting buyers sync...');
  try {
    // Provo endpoint-in e blerësve
    let buyers = [];
    try {
      const data = await pbFetch('/api/buyers');
      // Format: { ok, count, buyers: [{Sifra_Kup, Bleresi, objects:[{Sifra_Obj, ImeObj}]}] }
      buyers = data.buyers ?? (Array.isArray(data) ? data : (data.data ?? []));
    } catch {
      console.log('[pbSync] No buyers endpoint available, skipping buyers sync');
      return 0;
    }

    if (!buyers.length) {
      console.log('[pbSync] No buyers returned');
      return 0;
    }

    let count = 0;
    for (const b of buyers) {
      const code = (b.Sifra_Kup || b.code || '').trim();
      const name = (b.Bleresi || b.name || '').trim();
      if (!code || !name) continue;

      const res = await q(
        `INSERT INTO buyers(code, name) VALUES($1, $2)
         ON CONFLICT(code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [code, name]
      );
      const buyerId = res.rows[0].id;
      count++;

      // Sync objektet e këtij blerësi
      const objects = b.objects || [];
      for (const obj of objects) {
        const siteCode = String(obj.Sifra_Obj || obj.site_code || '').trim();
        const siteName = (obj.ImeObj || obj.ObjektiBleresit || obj.site_name || '').trim();
        if (!siteCode || !siteName) continue;

        await q(
          `INSERT INTO buyer_sites(buyer_id, site_code, site_name)
           VALUES($1, $2, $3)
           ON CONFLICT(buyer_id, site_code) DO UPDATE SET site_name = EXCLUDED.site_name`,
          [buyerId, siteCode, siteName]
        );
      }
    }

    console.log(`[pbSync] Buyers synced: ${count}`);
    return count;
  } catch (err) {
    console.error('[pbSync] Buyers sync error:', err.message);
    return 0;
  }
}

// ── 3. Sync i plotë ──────────────────────────────────────
export async function runFullSync() {
  console.log('[pbSync] === Full sync started ===');
  const t = Date.now();
  const articles = await syncArticles();
  const buyers   = await syncBuyers();
  console.log(`[pbSync] === Full sync done in ${Date.now()-t}ms | articles:${articles} buyers:${buyers} ===`);
  return { articles, buyers };
}
