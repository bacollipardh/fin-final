import { useEffect, useState, useMemo, useCallback } from "react";
import api from "../api";
import Layout from "../components/Layout";
import { useToast } from "../components/Toast";
import { Card, SkeletonRow, StatCard } from "../components/ui";

/* ─── helpers ─── */
const ROLE_OPTIONS = ["agent","team_lead","division_manager","sales_director","admin"];
const ROLE_LABEL   = { agent:"Agjent", team_lead:"Team Lead", division_manager:"Menaxher Divizioni", sales_director:"Drejtor Shitjesh", admin:"Administrator" };
const ROLE_COLOR   = { agent:"bg-slate-100 text-slate-700 border-slate-200", team_lead:"bg-blue-100 text-blue-800 border-blue-200", division_manager:"bg-purple-100 text-purple-800 border-purple-200", sales_director:"bg-indigo-100 text-indigo-800 border-indigo-200", admin:"bg-gray-100 text-gray-700 border-gray-200" };
const inputCls  = "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/60 transition-colors";
const selectCls = "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400/30 transition-colors";
const searchCls = "border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 w-full max-w-xs";

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Pager({ page, pages, total, per, onPrev, onNext }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
      <span>Gjithsej <b className="text-slate-700">{total}</b> — faqja <b className="text-slate-700">{page}</b> / <b className="text-slate-700">{pages}</b></span>
      <div className="flex gap-2">
        <button onClick={onPrev} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
        <button onClick={onNext} disabled={page >= pages} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
      </div>
    </div>
  );
}

const PER = 20;
function usePaged(list, search, searchFn) {
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q ? list.filter(r => searchFn(r, q)) : list;
  }, [list, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const safePage = Math.min(page, pages);
  const rows = filtered.slice((safePage - 1) * PER, safePage * PER);
  useEffect(() => { setPage(1); }, [search]);
  return { rows, page: safePage, pages, total: filtered.length, setPage };
}

/* ─── MAIN ─── */
export default function Admin() {
  const profile = useMemo(() => { try { return JSON.parse(localStorage.getItem("profile") || "{}"); } catch { return {}; } }, []);
  const { success, error: toastError } = useToast();

  const [tab, setTab]   = useState("users");
  const [users, setUsers]         = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [articles, setArticles]   = useState([]);
  const [buyers, setBuyers]       = useState([]);
  const [sites, setSites]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [modal, setModal]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [syncing, setSyncing]     = useState(false);

  /* Search state per tab */
  const [searchUsers,    setSearchUsers]    = useState("");
  const [searchArticles, setSearchArticles] = useState("");
  const [searchBuyers,   setSearchBuyers]   = useState("");
  const [searchSites,    setSearchSites]    = useState("");

  /* Audit log */
  const [auditRows,  setAuditRows]  = useState([]);
  const [auditPage,  setAuditPage]  = useState(1);
  const [auditPages, setAuditPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  const closeModal = () => setModal(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [u, d, a, b, s] = await Promise.all([
        api.get("/admin/users"), api.get("/admin/divisions"),
        api.get("/admin/articles"), api.get("/admin/buyers"), api.get("/admin/buyer-sites"),
      ]);
      setUsers(u.data || []); setDivisions(d.data || []); setArticles(a.data || []);
      setBuyers(b.data || []); setSites(s.data || []);
    } catch (e) {
      if (e?.response?.status === 401) { localStorage.clear(); location.href = "/login"; return; }
      toastError("Gabim gjatë ngarkimit.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const loadAudit = useCallback(async (page = 1) => {
    setAuditLoading(true);
    try {
      const { data } = await api.get(`/admin/audit-log?page=${page}&per=50`);
      setAuditRows(data.rows || []);
      setAuditTotal(data.total || 0);
      setAuditPage(data.page || page);
      setAuditPages(data.pages || 1);
    } catch { toastError("Gabim gjatë ngarkimit të audit log."); }
    finally { setAuditLoading(false); }
  }, []);

  useEffect(() => { if (tab === "audit") loadAudit(1); }, [tab, loadAudit]);

  /* Paged views */
  const pagedUsers    = usePaged(users,    searchUsers,    (r,q) => `${r.first_name} ${r.last_name} ${r.email} ${r.role}`.toLowerCase().includes(q));
  const pagedArticles = usePaged(articles, searchArticles, (r,q) => `${r.sku} ${r.name}`.toLowerCase().includes(q));
  const pagedBuyers   = usePaged(buyers,   searchBuyers,   (r,q) => `${r.code} ${r.name}`.toLowerCase().includes(q));
  const pagedSites    = usePaged(sites,    searchSites,    (r,q) => `${r.site_code} ${r.site_name} ${buyers.find(b=>b.id===r.buyer_id)?.name||""}`.toLowerCase().includes(q));

  /* Save */
  const save = async (endpoint, method, body) => {
    setSaving(true);
    try {
      if (method === "POST") await api.post(endpoint, body);
      else                   await api.put(endpoint, body);
      closeModal(); await reload(); success("U ruajt me sukses.");
    } catch (e) {
      toastError(e?.response?.data?.error || "Gabim gjatë ruajtjes.");
    } finally { setSaving(false); }
  };

  const del = async (endpoint, label = "Konfirmo fshirjen?") => {
    if (!window.confirm(label)) return;
    try { await api.delete(endpoint); await reload(); success("U fshi me sukses."); }
    catch (e) {
      const err = e?.response?.data?.error || "Gabim.";
      toastError(err === "in_use" || err.startsWith("in_use") ? "S'mund të fshihet — ka të dhëna të lidhura." : err);
    }
  };

  const pbSync = async () => {
    if (!window.confirm("Sync nga PricingBridge? Kjo do të importojë artikujt, blerësit dhe objektet.")) return;
    setSyncing(true);
    try {
      const { data } = await api.post("/admin/pb-sync");
      success(`Sync u krye! Artikuj: ${data.articles}, Blerës: ${data.buyers}`);
      await reload();
    } catch (e) {
      toastError(e?.response?.data?.error || "Gabim gjatë sync.");
    } finally { setSyncing(false); }
  };

  const TABS = [
    { key:"users",      label:`Përdoruesit (${users.length})`   },
    { key:"divisions",  label:`Divizioni (${divisions.length})`  },
    { key:"articles",   label:`Artikujt (${articles.length})`   },
    { key:"buyers",     label:`Blerësit (${buyers.length})`     },
    { key:"sites",      label:`Objektet (${sites.length})`      },
    { key:"thresholds", label:"⚖️ Pragjet"                       },
    { key:"limits",     label:"🔒 Limitet"                       },
    { key:"ip",         label:"🌐 IP Whitelist"                  },
    { key:"delegations",label:"🔄 Delegimet"                     },
    { key:"audit",      label:"📋 Audit Log"                     },
  ];

  return (
    <Layout profile={profile}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Paneli Admin</h1>
          <p className="text-sm text-slate-500 mt-0.5">Administrim i sistemit</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Përdorues"  value={users.length}     color="blue" />
          <StatCard label="Divizioni"  value={divisions.length} />
          <StatCard label="Artikuj"    value={articles.length}  />
          <StatCard label="Blerës"     value={buyers.length}    />
          <StatCard label="Objekte"    value={sites.length}     />
        </div>

        {/* PricingBridge Sync Button */}
        <div className="flex justify-end">
          <button
            onClick={pbSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {syncing ? "⏳ Duke sinkronizuar..." : "🔄 Sync nga PricingBridge"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 gap-0.5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap
                ${tab === t.key ? "border-[#1e3a5f] text-[#1e3a5f]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ USERS ═══ */}
        {tab === "users" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-700">Përdoruesit</h2>
              <div className="flex gap-2 flex-1 justify-end">
                <input value={searchUsers} onChange={e => setSearchUsers(e.target.value)} placeholder="Kërko emër, email, rol…" className={searchCls} />
                <button onClick={() => setModal({ type:"user", data:null })}
                  className="px-3 py-2 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#162d4a] transition-colors whitespace-nowrap">+ Shto</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>{["Emri","Email","Roli","Divizioni","PDA","Hyrja e fundit","Veprime"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading && Array.from({length:4}).map((_,i) => <SkeletonRow key={i} cols={7}/>)}
                  {!loading && pagedUsers.rows.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{u.first_name} {u.last_name}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLOR[u.role]||ROLE_COLOR.agent}`}>{ROLE_LABEL[u.role]||u.role}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{u.division_name||"—"}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{u.pda_number||"—"}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{u.last_login ? new Date(u.last_login).toLocaleDateString("sq-AL") : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => setModal({ type:"user", data:u })} className="text-xs text-[#1e3a5f] hover:underline">Ndrysho</button>
                          <button onClick={() => del(`/admin/users/${u.id}`, `Fshi "${u.first_name} ${u.last_name}"?`)} className="text-xs text-red-500 hover:underline">Fshi</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !pagedUsers.rows.length && <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">{searchUsers ? "Asnjë rezultat." : "S'ka përdorues."}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={pagedUsers.page} pages={pagedUsers.pages} total={pagedUsers.total} per={PER}
              onPrev={() => pagedUsers.setPage(p => p-1)} onNext={() => pagedUsers.setPage(p => p+1)} />
          </Card>
        )}

        {/* ═══ DIVISIONS ═══ */}
        {tab === "divisions" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Divizioni</h2>
              <button onClick={() => setModal({ type:"division", data:null })}
                className="px-3 py-2 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#162d4a] transition-colors">+ Shto</button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  {["ID","Emri","Team Lead Default","Veprime"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {loading && Array.from({length:3}).map((_,i) => <SkeletonRow key={i} cols={4}/>)}
                  {!loading && divisions.map(d => {
                    const tl = users.find(u => u.id === d.default_team_leader_id);
                    return (
                      <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-400 text-xs">#{d.id}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{tl ? `${tl.first_name} ${tl.last_name}` : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button onClick={() => setModal({ type:"division", data:d })} className="text-xs text-[#1e3a5f] hover:underline">Ndrysho</button>
                            <button onClick={() => del(`/admin/divisions/${d.id}`, `Fshi "${d.name}"?`)} className="text-xs text-red-500 hover:underline">Fshi</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && !divisions.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-400">S'ka divizioni.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ═══ ARTICLES ═══ */}
        {tab === "articles" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-700">Artikujt</h2>
              <div className="flex gap-2 flex-1 justify-end">
                <input value={searchArticles} onChange={e => setSearchArticles(e.target.value)} placeholder="Kërko SKU ose emër…" className={searchCls} />
                <button onClick={() => setModal({ type:"article", data:null })}
                  className="px-3 py-2 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#162d4a] transition-colors whitespace-nowrap">+ Shto</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  {["SKU","Emri","Çmimi (€)","Veprime"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {loading && Array.from({length:4}).map((_,i) => <SkeletonRow key={i} cols={4}/>)}
                  {!loading && pagedArticles.rows.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{a.sku}</td>
                      <td className="px-4 py-3 text-slate-800">{a.name}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">€{Number(a.sell_price||0).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => setModal({ type:"article", data:a })} className="text-xs text-[#1e3a5f] hover:underline">Ndrysho</button>
                          <button onClick={() => del(`/admin/articles/${a.id}`, `Fshi "${a.sku}"?`)} className="text-xs text-red-500 hover:underline">Fshi</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !pagedArticles.rows.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-400">{searchArticles ? "Asnjë rezultat." : "S'ka artikuj."}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={pagedArticles.page} pages={pagedArticles.pages} total={pagedArticles.total} per={PER}
              onPrev={() => pagedArticles.setPage(p => p-1)} onNext={() => pagedArticles.setPage(p => p+1)} />
          </Card>
        )}

        {/* ═══ BUYERS ═══ */}
        {tab === "buyers" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-700">Blerësit</h2>
              <div className="flex gap-2 flex-1 justify-end">
                <input value={searchBuyers} onChange={e => setSearchBuyers(e.target.value)} placeholder="Kërko kod ose emër…" className={searchCls} />
                <button onClick={() => setModal({ type:"buyer", data:null })}
                  className="px-3 py-2 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#162d4a] transition-colors whitespace-nowrap">+ Shto</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  {["Kodi","Emri","Veprime"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {loading && Array.from({length:4}).map((_,i) => <SkeletonRow key={i} cols={3}/>)}
                  {!loading && pagedBuyers.rows.map(b => (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{b.code}</td>
                      <td className="px-4 py-3 text-slate-800">{b.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => setModal({ type:"buyer", data:b })} className="text-xs text-[#1e3a5f] hover:underline">Ndrysho</button>
                          <button onClick={() => del(`/admin/buyers/${b.id}`, `Fshi "${b.name}"?`)} className="text-xs text-red-500 hover:underline">Fshi</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !pagedBuyers.rows.length && <tr><td colSpan={3} className="py-8 text-center text-sm text-slate-400">{searchBuyers ? "Asnjë rezultat." : "S'ka blerës."}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={pagedBuyers.page} pages={pagedBuyers.pages} total={pagedBuyers.total} per={PER}
              onPrev={() => pagedBuyers.setPage(p => p-1)} onNext={() => pagedBuyers.setPage(p => p+1)} />
          </Card>
        )}

        {/* ═══ BUYER SITES ═══ */}
        {tab === "sites" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-700">Objektet</h2>
              <div className="flex gap-2 flex-1 justify-end">
                <input value={searchSites} onChange={e => setSearchSites(e.target.value)} placeholder="Kërko kod, emër, blerës…" className={searchCls} />
                <button onClick={() => setModal({ type:"site", data:null })}
                  className="px-3 py-2 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#162d4a] transition-colors whitespace-nowrap">+ Shto</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  {["Blerësi","Kodi","Emri","Veprime"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {loading && Array.from({length:4}).map((_,i) => <SkeletonRow key={i} cols={4}/>)}
                  {!loading && pagedSites.rows.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{buyers.find(b=>b.id===s.buyer_id)?.name||`#${s.buyer_id}`}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{s.site_code}</td>
                      <td className="px-4 py-3 text-slate-800">{s.site_name}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => setModal({ type:"site", data:s })} className="text-xs text-[#1e3a5f] hover:underline">Ndrysho</button>
                          <button onClick={() => del(`/admin/buyer-sites/${s.id}`, `Fshi "${s.site_name}"?`)} className="text-xs text-red-500 hover:underline">Fshi</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !pagedSites.rows.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-400">{searchSites ? "Asnjë rezultat." : "S'ka objekte."}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pager page={pagedSites.page} pages={pagedSites.pages} total={pagedSites.total} per={PER}
              onPrev={() => pagedSites.setPage(p => p-1)} onNext={() => pagedSites.setPage(p => p+1)} />
          </Card>
        )}

        {/* ═══ THRESHOLDS ═══ */}
        {tab === "thresholds" && <ThresholdsTab />}

        {/* ═══ AGENT LIMITS ═══ */}
        {tab === "limits" && <AgentLimitsTab users={users} />}

        {/* ═══ IP WHITELIST ═══ */}
        {tab === "ip" && <IpWhitelistTab />}

        {/* ═══ DELEGATIONS ═══ */}
        {tab === "delegations" && <DelegationsTab />}

        {/* ═══ AUDIT LOG ═══ */}
        {tab === "audit" && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Audit Log</h2>
              <span className="text-xs text-slate-400">{auditTotal} veprime gjithsej</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  {["Data","Përdoruesi","Veprimi","Entiteti","ID","Detaje"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {auditLoading && Array.from({length:5}).map((_,i) => <SkeletonRow key={i} cols={6}/>)}
                  {!auditLoading && auditRows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString("sq-AL") : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                        {r.first_name ? `${r.first_name} ${r.last_name}` : r.user_email || `#${r.user_id||"?"}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                          ${r.action==="create" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : r.action==="delete" ? "bg-red-100 text-red-800 border-red-200"
                          : "bg-blue-100 text-blue-800 border-blue-200"}`}>
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{r.entity||"—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{r.entity_id||"—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={JSON.stringify(r.detail)}>
                        {r.detail ? JSON.stringify(r.detail).slice(0, 80) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!auditLoading && !auditRows.length && (
                    <tr><td colSpan={6} className="py-12 text-center">
                      <div className="text-3xl mb-2">📋</div>
                      <p className="text-sm text-slate-400">S'ka veprime të regjistruara ende.</p>
                      <p className="text-xs text-slate-300 mt-1">Veprimet admin regjistrohen automatikisht.</p>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {auditPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
                <span>Gjithsej <b className="text-slate-700">{auditTotal}</b> — faqja <b className="text-slate-700">{auditPage}</b> / <b className="text-slate-700">{auditPages}</b></span>
                <div className="flex gap-2">
                  <button onClick={() => loadAudit(auditPage-1)} disabled={auditPage<=1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
                  <button onClick={() => loadAudit(auditPage+1)} disabled={auditPage>=auditPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ═══ MODALS ═══ */}
      {modal?.type==="user"     && <UserModal     data={modal.data} divisions={divisions} users={users}  saving={saving} onClose={closeModal} onSave={b => save(modal.data?`/admin/users/${modal.data.id}`:"/admin/users",      modal.data?"PUT":"POST", b)} />}
      {modal?.type==="division" && <DivisionModal data={modal.data} users={users}                        saving={saving} onClose={closeModal} onSave={b => save(modal.data?`/admin/divisions/${modal.data.id}`:"/admin/divisions",  modal.data?"PUT":"POST", b)} />}
      {modal?.type==="article"  && <ArticleModal  data={modal.data}                                      saving={saving} onClose={closeModal} onSave={b => save(modal.data?`/admin/articles/${modal.data.id}`:"/admin/articles",    modal.data?"PUT":"POST", b)} />}
      {modal?.type==="buyer"    && <BuyerModal    data={modal.data}                                      saving={saving} onClose={closeModal} onSave={b => save(modal.data?`/admin/buyers/${modal.data.id}`:"/admin/buyers",        modal.data?"PUT":"POST", b)} />}
      {modal?.type==="site"     && <SiteModal     data={modal.data} buyers={buyers}                      saving={saving} onClose={closeModal} onSave={b => save(modal.data?`/admin/buyer-sites/${modal.data.id}`:"/admin/buyer-sites", modal.data?"PUT":"POST", b)} />}
    </Layout>
  );
}

/* ═══ FORM MODALS ═══ */
function SaveRow({ onClose, saving, label = "Ruaj" }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">Anulo</button>
      <button type="submit" disabled={saving} className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-2 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
        {saving ? "Duke ruajtur…" : label}
      </button>
    </div>
  );
}

function UserModal({ data, divisions, users, saving, onClose, onSave }) {
  // Divisionet fillestare per agjentin — nga agent_division_ids ose division_id
  const initDivIds = data?.agent_division_ids?.length
    ? data.agent_division_ids.map(Number).filter(Boolean)
    : (data?.division_id ? [Number(data.division_id)] : []);

  const [f, setF] = useState({
    first_name: data?.first_name||"",
    last_name:  data?.last_name||"",
    email:      data?.email||"",
    password:   "",
    role:       data?.role||"agent",
    division_id: data?.division_id ? String(data.division_id) : "",
    pda_number: data?.pda_number||"",
    team_leader_id: data?.team_leader_id ? String(data.team_leader_id) : "",
  });

  // Lista e ID-ve te divisioneve per agjentin (si numra)
  const [agentDivIds, setAgentDivIds] = useState(initDivIds);

  const upd = k => v => setF(p => ({...p, [k]: v}));

  // Toggle checkbox per division
  const toggleDiv = (divId) => {
    const id = Number(divId);
    setAgentDivIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id);
        // Nese ishte i pari, vendos te dytin si kryesor
        if (prev[0] === id && next.length > 0) {
          upd("division_id")(String(next[0]));
          upd("team_leader_id")("");
        }
        return next;
      } else {
        // Nese eshte i pari, vendos si division_id kryesor
        if (prev.length === 0) {
          upd("division_id")(String(id));
          upd("team_leader_id")("");
        }
        return [...prev, id];
      }
    });
  };

  // Team leads per divizionin kryesor
  const primaryDivId = agentDivIds[0] || Number(f.division_id);
  const teamLeads = f.role === "agent"
    ? users.filter(u => u.role==="team_lead" && Number(u.division_id) === primaryDivId)
    : users.filter(u => u.role==="team_lead" && Number(u.division_id) === Number(f.division_id));

  const handleSave = () => {
    const payload = { ...f, team_leader_id: f.team_leader_id ? Number(f.team_leader_id) : null };

    if (f.role === "agent") {
      const finalDivIds = agentDivIds.length > 0
        ? agentDivIds
        : (f.division_id ? [Number(f.division_id)] : []);
      payload.agent_division_ids = finalDivIds;
      payload.division_id = finalDivIds[0] || null;
    } else {
      payload.division_id = f.division_id ? Number(f.division_id) : null;
      payload.agent_division_ids = [];
    }

    onSave(payload);
  };

  // Divisionet e filtruara per agjentin (pa KOZMETIKE=1, OTHER=8)
  const agentDivisions = divisions.filter(d => d.id !== 1 && d.id !== 8);

  return (
    <Modal title={data ? "Ndrysho Përdoruesin" : "Shto Përdorues të ri"} onClose={onClose}>
      <Field label="Emri">
        <input value={f.first_name} onChange={e=>upd("first_name")(e.target.value)} className={inputCls} placeholder="Emri" />
      </Field>
      <Field label="Mbiemri">
        <input value={f.last_name} onChange={e=>upd("last_name")(e.target.value)} className={inputCls} placeholder="Mbiemri" />
      </Field>
      <Field label="Email">
        <input type="email" value={f.email} onChange={e=>upd("email")(e.target.value)} className={inputCls} placeholder="email@kompania.com" />
      </Field>
      <Field label={data ? "Fjalëkalim i ri (lër bosh nëse nuk ndryshon)" : "Fjalëkalimi *"}>
        <input type="password" value={f.password} onChange={e=>upd("password")(e.target.value)} placeholder="••••••••" className={inputCls} />
      </Field>
      <Field label="Roli">
        <select value={f.role} onChange={e=>{ upd("role")(e.target.value); upd("team_leader_id")(""); upd("division_id")(""); setAgentDivIds([]); }} className={selectCls}>
          {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>

      {f.role === "agent" ? (
        <>
          <Field label="Divizioni (zgjedh një ose më shumë)">
            <div className="flex flex-col gap-1 max-h-44 overflow-y-auto border border-slate-200 rounded-lg p-2">
              {agentDivisions.map(d => (
                <label key={d.id} className={`flex items-center gap-2 cursor-pointer text-sm px-2 py-1 rounded transition-colors ${agentDivIds.includes(d.id) ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"}`}>
                  <input
                    type="checkbox"
                    checked={agentDivIds.includes(d.id)}
                    onChange={() => toggleDiv(d.id)}
                    className="rounded accent-blue-600"
                  />
                  <span className="font-medium">{d.name}</span>
                  {agentDivIds[0] === d.id && (
                    <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">kryesor</span>
                  )}
                </label>
              ))}
            </div>
            {agentDivIds.length === 0 && (
              <p className="text-xs text-red-500 mt-1">Zgjedh të paktën 1 divizioni</p>
            )}
          </Field>

          {agentDivIds.length > 0 && teamLeads.length > 0 && (
            <Field label="Team Leader i caktuar">
              <select value={f.team_leader_id} onChange={e=>upd("team_leader_id")(e.target.value)} className={selectCls}>
                <option value="">(automatik nga divizioni)</option>
                {teamLeads.map(u => (
                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
                ))}
              </select>
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Divizioni">
            <select value={f.division_id} onChange={e=>{ upd("division_id")(e.target.value); upd("team_leader_id")(""); }} className={selectCls}>
              <option value="">(pa divizioni)</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          {f.division_id && teamLeads.length > 0 && (
            <Field label="Team Leader i parazgjedhur (vetëm p/r Team Lead)">
              <select value={f.team_leader_id} onChange={e=>upd("team_leader_id")(e.target.value)} className={selectCls}>
                <option value="">—</option>
                {teamLeads.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
              </select>
            </Field>
          )}
        </>
      )}

      <Field label="Numri PDA">
        <input value={f.pda_number} onChange={e=>upd("pda_number")(e.target.value)} className={inputCls} placeholder="opsionale" />
      </Field>

      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">
          Anulo
        </button>
        <button
          disabled={saving || (f.role === "agent" && agentDivIds.length === 0)}
          onClick={handleSave}
          className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-2 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors"
        >
          {saving ? "Duke ruajtur…" : "Ruaj"}
        </button>
      </div>
    </Modal>
  );
}

function DivisionModal({ data, users, saving, onClose, onSave }) {
  const [name, setName] = useState(data?.name||"");
  const [dtl, setDtl]   = useState(data?.default_team_leader_id||"");
  const teamLeads = users.filter(u => u.role==="team_lead");
  return (
    <Modal title={data ? "Ndrysho Divizionin" : "Shto Divizion të ri"} onClose={onClose}>
      <Field label="Emri i divizionit *"><input value={name} onChange={e=>setName(e.target.value)} className={inputCls} placeholder="p.sh. Divizioni Veri" /></Field>
      <Field label="Team Lead i parazgjedhur">
        <select value={dtl} onChange={e=>setDtl(e.target.value)} className={selectCls}>
          <option value="">(asnjë)</option>
          {teamLeads.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.division_id ? u.division_name||`div#${u.division_id}` : "pa div."}</option>)}
        </select>
      </Field>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">Anulo</button>
        <button disabled={saving} onClick={() => onSave({ name, default_team_leader_id: dtl||null })}
          className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-2 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
          {saving ? "Duke ruajtur…" : "Ruaj"}
        </button>
      </div>
    </Modal>
  );
}

function ArticleModal({ data, saving, onClose, onSave }) {
  const [f, setF] = useState({ sku: data?.sku||"", name: data?.name||"", sell_price: data?.sell_price??""});
  const upd = k => v => setF(p => ({...p, [k]: v}));
  return (
    <Modal title={data ? "Ndrysho Artikullin" : "Shto Artikull të ri"} onClose={onClose}>
      <Field label="SKU *"><input value={f.sku} onChange={e=>upd("sku")(e.target.value)} className={inputCls} placeholder="p.sh. CAT001" /></Field>
      <Field label="Emri *"><input value={f.name} onChange={e=>upd("name")(e.target.value)} className={inputCls} placeholder="Emri i plotë i artikullit" /></Field>
      <Field label="Çmimi shitës (€) *"><input type="number" step="0.01" min="0" value={f.sell_price} onChange={e=>upd("sell_price")(e.target.value)} className={inputCls} placeholder="0.00" /></Field>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">Anulo</button>
        <button disabled={saving} onClick={() => onSave({...f, sell_price: Number(f.sell_price)})}
          className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-2 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
          {saving ? "Duke ruajtur…" : "Ruaj"}
        </button>
      </div>
    </Modal>
  );
}

function BuyerModal({ data, saving, onClose, onSave }) {
  const [f, setF] = useState({ code: data?.code||"", name: data?.name||"" });
  const upd = k => v => setF(p => ({...p, [k]: v}));
  return (
    <Modal title={data ? "Ndrysho Blerësin" : "Shto Blerës të ri"} onClose={onClose}>
      <Field label="Kodi *"><input value={f.code} onChange={e=>upd("code")(e.target.value)} className={inputCls} placeholder="p.sh. 00123" /></Field>
      <Field label="Emri *"><input value={f.name} onChange={e=>upd("name")(e.target.value)} className={inputCls} placeholder="Emri i plotë i blerësit" /></Field>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">Anulo</button>
        <button disabled={saving} onClick={() => onSave(f)}
          className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-2 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
          {saving ? "Duke ruajtur…" : "Ruaj"}
        </button>
      </div>
    </Modal>
  );
}

function SiteModal({ data, buyers, saving, onClose, onSave }) {
  const [f, setF] = useState({ buyer_id: data?.buyer_id||"", site_code: data?.site_code||"", site_name: data?.site_name||"" });
  const upd = k => v => setF(p => ({...p, [k]: v}));
  return (
    <Modal title={data ? "Ndrysho Objektin" : "Shto Objekt të ri"} onClose={onClose}>
      <Field label="Blerësi *">
        <select value={f.buyer_id} onChange={e=>upd("buyer_id")(e.target.value)} className={selectCls}>
          <option value="">Zgjedh blerësin…</option>
          {buyers.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      </Field>
      <Field label="Kodi i objektit *"><input value={f.site_code} onChange={e=>upd("site_code")(e.target.value)} className={inputCls} placeholder="p.sh. OBJ001" /></Field>
      <Field label="Emri i objektit *"><input value={f.site_name} onChange={e=>upd("site_name")(e.target.value)} className={inputCls} placeholder="Emri i plotë" /></Field>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">Anulo</button>
        <button disabled={saving} onClick={() => onSave({...f, buyer_id: Number(f.buyer_id)})}
          className="flex-1 bg-[#1e3a5f] text-white rounded-xl py-2 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
          {saving ? "Duke ruajtur…" : "Ruaj"}
        </button>
      </div>
    </Modal>
  );
}

/* ═══ THRESHOLDS TAB ═══ */
function ThresholdsTab() {
  const { success, error: toastError } = useToast();
  const [tl, setTl]   = useState("");
  const [dm, setDm]   = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/thresholds").then(({ data }) => {
      setTl(data.find(t => t.key==="team_lead_max")?.value ?? 99);
      setDm(data.find(t => t.key==="division_manager_max")?.value ?? 199);
    }).catch(() => toastError("Gabim.")).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (Number(tl) >= Number(dm)) { toastError("Team Lead max duhet të jetë më i vogël se Division Manager max."); return; }
    setSaving(true);
    try {
      await api.put("/admin/thresholds", { team_lead_max: Number(tl), division_manager_max: Number(dm) });
      success("Pragjet u ruajtën. Do të aplikohen menjëherë.");
    } catch (e) { toastError(e?.response?.data?.error || "Gabim."); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="py-8 text-center text-slate-400">Duke ngarkuar…</div>;
  return (
    <Card className="p-6 max-w-md dark:bg-slate-800">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">⚖️ Pragjet e Aprovimit</h2>
      <p className="text-xs text-slate-500 mb-4">Shumat që përcaktojnë nivelin e aprovuesit. Ndryshimet aplikohen menjëherë pa restart.</p>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Maksimumi Team Lead (€)</label>
          <input type="number" min="1" step="0.01" value={tl} onChange={e => setTl(e.target.value)}
            className={inputCls} />
          <p className="text-xs text-slate-400 mt-1">Kërkesa ≤ €{tl} → Team Lead</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Maksimumi Division Manager (€)</label>
          <input type="number" min="1" step="0.01" value={dm} onChange={e => setDm(e.target.value)}
            className={inputCls} />
          <p className="text-xs text-slate-400 mt-1">€{Number(tl)+0.01}–€{dm} → Division Manager; mbi €{dm} → Sales Director</p>
        </div>
        <button disabled={saving} onClick={save}
          className="w-full bg-[#1e3a5f] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
          {saving ? "Duke ruajtur…" : "Ruaj Pragjet"}
        </button>
      </div>
    </Card>
  );
}

/* ═══ AGENT LIMITS TAB ═══ */
function AgentLimitsTab({ users }) {
  const { success, error: toastError } = useToast();
  const [limits, setLimits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ user_id:"", period:"monthly", max_amount:"" });
  const [saving, setSaving] = useState(false);

  const load = async () => { setLoading(true); try { const { data } = await api.get("/admin/agent-limits"); setLimits(data||[]); } catch {} finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.user_id || !form.max_amount) { toastError("Plotëso të gjitha fushat."); return; }
    setSaving(true);
    try { await api.post("/admin/agent-limits", { ...form, max_amount: Number(form.max_amount) }); success("Limiti u ruajt."); await load(); setForm({ user_id:"", period:"monthly", max_amount:"" }); }
    catch (e) { toastError(e?.response?.data?.error || "Gabim."); }
    finally { setSaving(false); }
  };

  const del = async (userId, period) => {
    try { await api.delete(`/admin/agent-limits/${userId}/${period}`); success("Limiti u fshi."); await load(); }
    catch { toastError("Gabim gjatë fshirjes."); }
  };

  const agents = users.filter(u => u.role === "agent");

  return (
    <div className="space-y-4">
      <Card className="p-5 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">🔒 Shto Limit të ri</h2>
        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Agjenti</label>
            <select value={form.user_id} onChange={e => setForm(p=>({...p,user_id:e.target.value}))} className={selectCls}>
              <option value="">Zgjedh…</option>
              {agents.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Periudha</label>
            <select value={form.period} onChange={e => setForm(p=>({...p,period:e.target.value}))} className={selectCls}>
              <option value="monthly">Mujore</option>
              <option value="weekly">Javore</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Max (€)</label>
            <input type="number" min="1" step="0.01" value={form.max_amount} onChange={e => setForm(p=>({...p,max_amount:e.target.value}))} placeholder="500.00" className={inputCls} />
          </div>
          <button disabled={saving} onClick={save}
            className="px-4 py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
            {saving ? "…" : "Shto"}
          </button>
        </div>
      </Card>
      <Card className="overflow-hidden dark:bg-slate-800">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Limitet aktive</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-700"><tr>
              {["Agjenti","Periudha","Max (€)","Veprime"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
              {loading && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Duke ngarkuar…</td></tr>}
              {!loading && !limits.length && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Asnjë limit i vendosur.</td></tr>}
              {!loading && limits.map(l => (
                <tr key={`${l.user_id}-${l.period}`} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{l.first_name} {l.last_name}</td>
                  <td className="px-4 py-3 text-slate-600">{l.period === "monthly" ? "Mujore" : "Javore"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">€{Number(l.max_amount).toFixed(2)}</td>
                  <td className="px-4 py-3"><button onClick={() => del(l.user_id, l.period)} className="text-xs text-red-500 hover:underline">Fshi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══ IP WHITELIST TAB ═══ */
function IpWhitelistTab() {
  const { success, error: toastError } = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cidr, setCidr]   = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => { setLoading(true); try { const { data } = await api.get("/admin/ip-whitelist"); setList(data||[]); } catch {} finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!cidr.trim()) { toastError("Shkruaj CIDR."); return; }
    setSaving(true);
    try { await api.post("/admin/ip-whitelist", { cidr: cidr.trim(), label: label.trim()||null }); success("IP u shtua."); setCidr(""); setLabel(""); await load(); }
    catch (e) { toastError(e?.response?.data?.error || "Gabim. Format: 192.168.1.0/24 ose 1.2.3.4/32"); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/admin/ip-whitelist/${id}`); success("IP u fshi."); await load(); }
    catch { toastError("Gabim."); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">🌐 IP Whitelist</h2>
        <p className="text-xs text-slate-500 mb-3">Kur lista është bosh, të gjitha IP-të janë të lejuara. Kur shtohet 1 IP, vetëm ajo është e lejuar në admin.</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CIDR (p.sh. 192.168.1.0/24)</label>
            <input value={cidr} onChange={e => setCidr(e.target.value)} placeholder="192.168.1.1/32" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Etiketa (opsionale)</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Zyra Prishtinë" className={inputCls} />
          </div>
          <button disabled={saving} onClick={add}
            className="px-4 py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#162d4a] disabled:opacity-60 transition-colors">
            {saving ? "…" : "+ Shto IP"}
          </button>
        </div>
      </Card>
      <Card className="overflow-hidden dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-700"><tr>
              {["CIDR","Etiketa","Shtuar nga","Data","Veprime"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
              {loading && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Duke ngarkuar…</td></tr>}
              {!loading && !list.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Asnjë IP e konfiguruar — të gjitha IP-të janë të lejuara.</td></tr>}
              {!loading && list.map(ip => (
                <tr key={ip.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">{ip.cidr}</td>
                  <td className="px-4 py-3 text-slate-600">{ip.label||"—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{ip.first_name ? `${ip.first_name} ${ip.last_name}` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{ip.created_at ? new Date(ip.created_at).toLocaleDateString("sq-AL") : "—"}</td>
                  <td className="px-4 py-3"><button onClick={() => del(ip.id)} className="text-xs text-red-500 hover:underline">Fshi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ═══ DELEGATIONS TAB ═══ */
function DelegationsTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/delegations").then(({ data }) => setList(data||[])).catch(()=>{}).finally(() => setLoading(false));
  }, []);

  return (
    <Card className="overflow-hidden dark:bg-slate-800">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">🔄 Delegimet e aprovimit</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-700"><tr>
            {["Nga","Te","Nga data","Deri","Arsyeja","Aktiv"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
            {loading && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Duke ngarkuar…</td></tr>}
            {!loading && !list.length && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Asnjë delegim.</td></tr>}
            {!loading && list.map(d => (
              <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">{d.from_first} {d.from_last}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">{d.to_first} {d.to_last}</td>
                <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{d.start_date}</td>
                <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{d.end_date}</td>
                <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">{d.reason||"—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${d.active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                    {d.active ? "Aktiv" : "Joaktiv"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
