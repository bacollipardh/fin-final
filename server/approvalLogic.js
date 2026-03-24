import { q } from "./db.js";

let _cache = null, _cacheTime = 0;

export async function getThresholds() {
  const now = Date.now();
  if (_cache && now - _cacheTime < 60_000) return _cache;
  try {
    const r = await q("SELECT key,value FROM approval_thresholds");
    const map = {};
    r.rows.forEach(row => { map[row.key] = Number(row.value); });
    _cache = { team_lead_max: map.team_lead_max??99, division_manager_max: map.division_manager_max??199 };
    _cacheTime = now;
    return _cache;
  } catch { return { team_lead_max:99, division_manager_max:199 }; }
}
export function invalidateThresholdCache() { _cache=null; _cacheTime=0; }

export async function requiredRoleForAmountAsync(amount) {
  const t = await getThresholds();
  if (amount <= t.team_lead_max)        return "team_lead";
  if (amount <= t.division_manager_max) return "division_manager";
  return "sales_director";
}
// Gjithmonë use async version - sync është vetëm fallback i fundit
export function requiredRoleForAmount(amount) {
  if (!_cache) console.warn("[approvalLogic] WARNING: threshold cache empty, using hardcoded defaults!");
  const t = _cache||{team_lead_max:99,division_manager_max:199};
  if (amount <= t.team_lead_max)        return "team_lead";
  if (amount <= t.division_manager_max) return "division_manager";
  return "sales_director";
}
