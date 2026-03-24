import { useEffect, useMemo, useState, useCallback } from "react";
import api from "../api";
import Layout from "../components/Layout";
import { useToast } from "../components/Toast";
import { StatusBadge, RoleBadge, SkeletonRow, Card, StatCard, euro } from "../components/ui";
import Comments from "../components/Comments.jsx";

const ROLE_LABEL = { team_lead:"Team Lead", division_manager:"Menaxher Divizioni", sales_director:"Drejtor Shitjesh" };
const PER_PAGE = 25;

/* ── Reusable paginated history table ── */
function HistoryTable({ rows, loading, onOpenPhotos, onOpenPdf, setDetail, onComment }) {
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(r =>
      (`${r.agent_first} ${r.agent_last}`).toLowerCase().includes(q) ||
      (r.buyer_code||"").toLowerCase().includes(q) ||
      (r.buyer_name||"").toLowerCase().includes(q) ||
      (r.site_name||"").toLowerCase().includes(q)
    );
  }, [rows, search]);

  useEffect(() => { setPage(1); }, [search, rows]);

  const pages    = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pages);
  const paged    = filtered.slice((safePage-1)*PER_PAGE, safePage*PER_PAGE);

  return (
    <Card className="overflow-hidden">
      {/* Search + count */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50 flex-wrap gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Kërko agjent, blerës, objekt…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 w-56 bg-white" />
        <span className="text-xs text-slate-400">{filtered.length} {filtered.length !== rows.length ? `/ ${rows.length}` : ""} rekorde</span>
      </div>

      {loading && (
        <div className="p-4"><table className="min-w-full"><tbody>
          {Array.from({length:5}).map((_,i) => <SkeletonRow key={i} cols={7} />)}
        </tbody></table></div>
      )}

      {!loading && !paged.length && (
        <div className="py-12 text-center text-sm text-slate-400">
          {search ? "Asnjë rezultat për kërkimin." : "S'ka historik."}
        </div>
      )}

      {!loading && paged.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white border-b border-slate-100">
              <tr>{["ID","Agjenti","Blerësi","Shuma","Statusi","Data","Dokumente"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paged.map((r, i) => {
                const photoCount = (Array.isArray(r.photos) ? r.photos : []).length;
                return (
                  <tr key={`${r.id}-${i}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-[#1e3a5f]">
                      <button onClick={() => setDetail(r)} className="hover:underline">#{r.id}</button>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap text-xs">{r.agent_first} {r.agent_last}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{r.buyer_code} {r.buyer_name}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{euro(r.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                        ${r.action==="approved" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                        : r.action==="rejected" ? "bg-red-100 text-red-800 border-red-200"
                        : r.status==="approved" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                        : r.status==="rejected" ? "bg-red-100 text-red-800 border-red-200"
                        : "bg-amber-100 text-amber-800 border-amber-200"}`}>
                        {r.action==="approved"||r.status==="approved" ? "✓ Aprovuar"
                        : r.action==="rejected"||r.status==="rejected" ? "✕ Refuzuar" : "Në pritje"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {(r.acted_at||r.created_at) ? new Date(r.acted_at||r.created_at).toLocaleDateString("sq-AL") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 whitespace-nowrap">
                        <button onClick={() => onOpenPdf(r.id, false)} className="text-xs text-[#1e3a5f] hover:underline">PDF</button>
                        <button onClick={() => onOpenPdf(r.id, true)}  className="text-xs text-slate-400 hover:underline">⬇</button>
                        {onComment && <button onClick={() => onComment(r.id)} className="text-xs text-blue-500 hover:underline">💬</button>}
                        {photoCount > 0 && (
                          <button onClick={() => onOpenPhotos(r)} className="text-xs text-emerald-600 hover:underline">Foto ({photoCount})</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
          <span>Gjithsej <b className="text-slate-700">{filtered.length}</b> — faqja <b className="text-slate-700">{safePage}</b> / <b className="text-slate-700">{pages}</b></span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p-1)} disabled={safePage<=1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
            <button onClick={() => setPage(p => p+1)} disabled={safePage>=pages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── Main component ── */
export default function Approvals() {
  const profile = useMemo(() => { try { return JSON.parse(localStorage.getItem("profile")||"{}"); } catch { return {}; } }, []);
  const role = profile.role || "";
  const { success, error: toastError } = useToast();

  const [pending, setPending]   = useState([]);
  const [pendTotal, setPendTotal] = useState(0);
  const [pendPage,  setPendPage]  = useState(1);
  const [pendPages, setPendPages] = useState(1);
  const [fltBuyer,    setFltBuyer]    = useState("");
  const [fltAgent,    setFltAgent]    = useState("");
  const [fltAmountMin, setFltAmtMin]  = useState("");
  const [fltAmountMax, setFltAmtMax]  = useState("");

  const [myHistory,   setMyHistory]   = useState([]);
  const [tlHistory,   setTlHistory]   = useState([]);
  const [allHistory,  setAllHistory]  = useState([]);

  const [tab, setTab]         = useState("pending");
  const [loading, setLoading] = useState(false);
  const [histLoad, setHistLoad] = useState(false);
  const [acting, setActing]   = useState({});
  const [exporting, setExporting] = useState(false);

  const API_BASE = (api?.defaults?.baseURL || import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const [gallery, setGallery] = useState({ open:false, urls:[], idx:0 });
  const closeGallery = () => setGallery({ open:false, urls:[], idx:0 });
  const [detail, setDetail]         = useState(null);
  const [commentReqId, setCommentReqId] = useState(null);
  const [commentModal, setCommentModal] = useState(null);
  const [comment, setComment] = useState("");

  /* ── Load pending ── */
  const loadPending = useCallback(async (page=1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page:String(page), per:"20" });
      if (fltBuyer)    params.set("buyer",      fltBuyer);
      if (fltAgent)    params.set("agent",      fltAgent);
      if (fltAmountMin) params.set("amount_min", fltAmountMin);
      if (fltAmountMax) params.set("amount_max", fltAmountMax);
      const res = await api.get(`/approvals/pending?${params}`);
      const d = res.data;
      setPending(Array.isArray(d) ? d : (d?.rows||[]));
      setPendTotal(d?.total||(Array.isArray(d)?d.length:0));
      setPendPage(d?.page||page);
      setPendPages(d?.pages||1);
    } catch (e) {
      if (e?.response?.status===401) { localStorage.clear(); location.href="/login"; return; }
      toastError("Gabim gjatë ngarkimit.");
    } finally { setLoading(false); }
  }, [fltBuyer, fltAgent, fltAmountMin, fltAmountMax]);

  /* ── Load history based on tab ── */
  const loadHistory = useCallback(async (tabKey) => {
    setHistLoad(true);
    try {
      if (tabKey==="history") {
        const r = await api.get("/approvals/my-history");
        setMyHistory(r.data||[]);
      } else if (tabKey==="teamlead") {
        const r = await api.get("/approvals/teamlead-history");
        setTlHistory(r.data||[]);
      } else if (tabKey==="all") {
        const r = await api.get("/approvals/all-history");
        setAllHistory(r.data||[]);
      }
    } catch { toastError("Gabim gjatë ngarkimit të historikut."); }
    finally { setHistLoad(false); }
  }, []);

  useEffect(() => { loadPending(1); }, []);
  useEffect(() => {
    if (tab==="pending") return;
    loadHistory(tab);
  }, [tab]);

  /* ── Open photos ── */
  const openPhotos = async (row) => {
    let urls = (Array.isArray(row.photos)?row.photos:[]).map(u=>typeof u==="string"?u:u?.url).filter(Boolean);
    if (!urls.length && row.id) {
      try { const { data } = await api.get(`/requests/${row.id}/photos`); urls=(data||[]).map(u=>typeof u==="string"?u:u?.url).filter(Boolean); } catch {}
    }
    if (!urls.length) { toastError("Kjo kërkesë nuk ka foto."); return; }
    setGallery({ open:true, urls, idx:0 });
  };

  const openPdf = async (id, download=false) => {
    try {
      const { data } = await api.get(`/requests/${id}/pdf`, { responseType:"arraybuffer" });
      const blob = new Blob([data], { type:"application/pdf" });
      const url  = URL.createObjectURL(blob);
      if (download) { const a=document.createElement("a"); a.href=url; a.download=`kerkes-${id}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
      else window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toastError("Gabim gjatë hapjes PDF."); }
  };

  const openCommentModal = (id, action) => { setComment(""); setCommentModal({ id, action }); };

  const confirmAct = async () => {
    if (!commentModal) return;
    const { id, action } = commentModal;
    setCommentModal(null);
    setActing(a => ({...a, [id]:true}));
    try {
      await api.post("/approvals/act", { id, action, comment:comment||"" });
      success(action==="approved" ? "Kërkesa u aprovua!" : "Kërkesa u refuzua.");
      await loadPending(pendPage);
    } catch (e) {
      const msg = e?.response?.data?.error||e?.message||"Gabim";
      toastError(msg==="already_decided" ? "Kjo kërkesë është vendosur tashmë." : msg==="wrong_role" ? "Nuk keni rolin e duhur." : msg==="forbidden" ? "Nuk keni leje." : `Gabim: ${msg}`);
    } finally { setActing(a => ({...a, [id]:false})); }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data } = await api.get("/approvals/export-csv", { responseType:"blob" });
      const url = URL.createObjectURL(new Blob([data], { type:"text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href=url; a.download=`aprovime-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { toastError("Gabim gjatë eksportit."); }
    finally { setExporting(false); }
  };

  const renderItemSummary = (row) => {
    const items = row.items||[];
    if (Array.isArray(items)&&items.length) return items.map(it=>`${it.sku} ×${it.quantity}`).join(", ");
    return row.article_summary||row.sku||"—";
  };

  /* ── Stats ── */
  const pendingCount  = pendTotal;
  const approvedCount = myHistory.filter(h=>h.action==="approved").length;
  const rejectedCount = myHistory.filter(h=>h.action==="rejected").length;

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e) => {
      if (tab !== "pending") return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.key === "a" || e.key === "A") && pending.length > 0) openCommentModal(pending[0].id, "approved");
      if ((e.key === "r" || e.key === "R") && pending.length > 0) openCommentModal(pending[0].id, "rejected");
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tab, pending]);

  /* ── Tabs config ── */
  const TABS = [
    { key:"pending",    label:`Në pritje (${pendingCount})` },
    { key:"history",    label:"Historiku im" },
    ...( ["team_lead","division_manager","sales_director"].includes(role) ? [{ key:"delegation", label:"🔄 Delegim" }] : []),
    ...(role==="division_manager" ? [{ key:"teamlead", label:"Historiku Team Lead" }] : []),
    ...(role==="sales_director"   ? [{ key:"all",      label:"Të gjitha" }] : []),
  ];

  return (
    <Layout profile={profile}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Aprovime</h1>
          <p className="text-sm text-slate-500 mt-0.5">{profile.first_name} {profile.last_name} · {ROLE_LABEL[role]||role}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Në pritje"  value={pendingCount}  color="amber" />
          <StatCard label="Aprovuar"   value={approvedCount} color="green" />
          <StatCard label="Refuzuar"   value={rejectedCount} color="red"   />
        </div>

        {/* Tabs + Export */}
        <div className="flex items-center border-b border-slate-200 gap-1">
          <div className="flex gap-1 flex-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap
                  ${tab===t.key ? "border-[#1e3a5f] text-[#1e3a5f]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                {t.label}
              </button>
            ))}
          </div>
          {(role==="sales_director"||role==="division_manager") && (
            <button onClick={exportCsv} disabled={exporting}
              className="mb-px px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 active:scale-95 transition-all whitespace-nowrap">
              {exporting ? "…" : "⬇ CSV"}
            </button>
          )}
        </div>

        {/* ═══ PENDING TAB ═══ */}
        {tab==="pending" && (
          <Card className="overflow-hidden">
            {/* Filters */}
            <div className="px-5 pt-4 pb-3 border-b border-slate-100 bg-slate-50">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input value={fltBuyer} onChange={e=>setFltBuyer(e.target.value)} placeholder="Blerësi…"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 bg-white" />
                <input value={fltAgent} onChange={e=>setFltAgent(e.target.value)} placeholder="Agjenti…"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 bg-white" />
                <input type="number" value={fltAmountMin} onChange={e=>setFltAmtMin(e.target.value)} placeholder="Shuma min €"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 bg-white" />
                <input type="number" value={fltAmountMax} onChange={e=>setFltAmtMax(e.target.value)} placeholder="Shuma max €"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 bg-white" />
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button onClick={() => loadPending(1)}
                  className="px-3 py-1.5 bg-[#1e3a5f] text-white text-xs font-medium rounded-lg hover:bg-[#162d4a] transition-colors">
                  Filtro
                </button>
                {(fltBuyer||fltAgent||fltAmountMin||fltAmountMax) && (
                  <button onClick={() => { setFltBuyer(""); setFltAgent(""); setFltAmtMin(""); setFltAmtMax(""); }}
                    className="text-xs text-slate-400 hover:text-slate-600 underline">Pastro</button>
                )}
                <span className="text-xs text-slate-400 ml-auto">{pendTotal} gjithsej</span>
              </div>
            </div>

            {loading && (
              <div className="p-4"><table className="min-w-full"><tbody>
                {Array.from({length:3}).map((_,i) => <SkeletonRow key={i} cols={7} />)}
              </tbody></table></div>
            )}

            {!loading && !pending.length && (
              <div className="py-16 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-slate-500 text-sm">Asnjë kërkesë në pritje.</p>
              </div>
            )}

            {!loading && pending.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>{["ID","Agjenti","Blerësi","Artikujt","Shuma","Foto","Veprime"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pending.map(r => {
                      const photoCount = (Array.isArray(r.photos)?r.photos:[]).length;
                      const isActing = !!acting[r.id];
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-700">
                            <button onClick={() => setDetail(r)} className="text-[#1e3a5f] hover:underline">#{r.id}</button>
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap text-xs">{r.first_name} {r.last_name}</td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{r.buyer_code} {r.buyer_name}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs max-w-[180px] truncate">{renderItemSummary(r)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{euro(r.amount)}</td>
                          <td className="px-4 py-3">
                            {photoCount>0
                              ? <button onClick={()=>openPhotos(r)} className="text-xs text-emerald-600 hover:underline whitespace-nowrap">📷 {photoCount}</button>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2 flex-wrap">
                              <button onClick={()=>openPdf(r.id)} className="text-xs text-slate-500 hover:underline whitespace-nowrap">PDF</button>
                              <button onClick={()=>setCommentReqId(r.id)} className="text-xs text-blue-500 hover:underline whitespace-nowrap">💬</button>
                              <button disabled={isActing} onClick={()=>openCommentModal(r.id,"approved")}
                                className="inline-flex items-center px-2.5 py-1 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                                {isActing ? "…" : "✓ Aprovo"}
                              </button>
                              <button disabled={isActing} onClick={()=>openCommentModal(r.id,"rejected")}
                                className="inline-flex items-center px-2.5 py-1 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                                {isActing ? "…" : "✕ Refuzo"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pending pagination */}
            {pendPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
                <span>Faqja <b className="text-slate-700">{pendPage}</b> / <b className="text-slate-700">{pendPages}</b></span>
                <div className="flex gap-2">
                  <button onClick={()=>{ const p=pendPage-1; setPendPage(p); loadPending(p); }} disabled={pendPage<=1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
                  <button onClick={()=>{ const p=pendPage+1; setPendPage(p); loadPending(p); }} disabled={pendPage>=pendPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ═══ HISTORY TABS ═══ */}
        {tab==="history" && (
          <HistoryTable rows={myHistory} loading={histLoad} onOpenPhotos={openPhotos} onOpenPdf={openPdf} setDetail={setDetail} onComment={setCommentReqId} />
        )}
        {tab==="teamlead" && (
          <HistoryTable rows={tlHistory} loading={histLoad} onOpenPhotos={openPhotos} onOpenPdf={openPdf} setDetail={setDetail} onComment={setCommentReqId} />
        )}
        {tab==="all" && (
          <HistoryTable rows={allHistory} loading={histLoad} onOpenPhotos={openPhotos} onOpenPdf={openPdf} setDetail={setDetail} onComment={setCommentReqId} />
        )}
        {tab==="delegation" && <DelegationTab profile={profile} />}
      </div>

      {/* Comment / Confirm Modal */}
      {commentModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              {commentModal.action==="approved" ? "✓ Konfirmo Aprovimin" : "✕ Konfirmo Refuzimin"}
            </h3>
            <p className="text-sm text-slate-500 mb-4">Kërkesa #{commentModal.id}</p>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={3}
              placeholder="Koment opsional…" maxLength={1000}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={()=>setCommentModal(null)}
                className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">Anulo</button>
              <button onClick={confirmAct}
                className={`flex-1 text-white rounded-xl py-2 text-sm font-medium active:scale-95 transition-all
                  ${commentModal.action==="approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-500 hover:bg-red-600"}`}>
                {commentModal.action==="approved" ? "Aprovo" : "Refuzo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900">Kërkesa #{detail.id}</h3>
              <button onClick={()=>setDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 text-xl">&times;</button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Agjenti</span><span className="font-medium">{detail.first_name||detail.agent_first} {detail.last_name||detail.agent_last}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Blerësi</span><span className="font-medium">{detail.buyer_code} {detail.buyer_name}</span></div>
              {detail.site_name && <div className="flex justify-between"><span className="text-slate-500">Objekti</span><span className="font-medium">{detail.site_name}</span></div>}
              {detail.invoice_ref && <div className="flex justify-between"><span className="text-slate-500">Ref. faturë</span><span className="font-medium">{detail.invoice_ref}</span></div>}
              {detail.reason && <div className="flex justify-between"><span className="text-slate-500">Arsyeja</span><span className="font-medium text-right max-w-xs">{detail.reason}</span></div>}
              <div className="border-t border-slate-100 pt-2">
                {(detail.items?.length ? detail.items : []).map((it,i) => (
                  <div key={i} className="flex justify-between text-xs py-0.5">
                    <span>{it.sku} — {it.name} ×{it.quantity}</span>
                    <span className="font-medium">{euro(it.line_amount)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="text-slate-500">Totali</span>
                <span className="font-bold text-lg text-slate-900">{euro(detail.amount)}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Statusi</span><StatusBadge status={detail.status||detail.action} /></div>
              <div className="flex justify-between"><span className="text-slate-500">Niveli</span><RoleBadge role={detail.required_role} /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={()=>openPdf(detail.id)} className="flex-1 border border-slate-300 text-slate-600 rounded-xl py-2 text-sm font-medium hover:bg-slate-50 transition-colors">📄 PDF</button>
              {(Array.isArray(detail.photos)&&detail.photos.length>0) && (
                <button onClick={()=>{ setDetail(null); openPhotos(detail); }} className="flex-1 border border-emerald-300 text-emerald-700 rounded-xl py-2 text-sm font-medium hover:bg-emerald-50 transition-colors">📷 Foto</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comments Modal */}
      {commentReqId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setCommentReqId(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg h-[70vh] sm:h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">💬 Diskutim — Kërkesa #{commentReqId}</span>
              <button onClick={() => setCommentReqId(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 text-xl">&times;</button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <Comments requestId={commentReqId} currentUser={profile} />
            </div>
          </div>
        </div>
      )}

      {/* Gallery Modal */}
      {gallery.open && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4" onClick={closeGallery}>
          <div className="w-full max-w-4xl" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/70 text-sm">Foto {gallery.idx+1} / {gallery.urls.length}</span>
              <button onClick={closeGallery} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-xl transition-colors">&times;</button>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={()=>setGallery(s=>({...s,idx:Math.max(0,s.idx-1)}))} disabled={gallery.idx===0}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl disabled:opacity-30 transition-colors flex-shrink-0">‹</button>
              <img src={gallery.urls[gallery.idx]?.startsWith("http") ? gallery.urls[gallery.idx] : `${API_BASE}${gallery.urls[gallery.idx]}`} alt="" className="flex-1 max-h-[80vh] object-contain rounded-xl" onError={e=>{e.target.style.display="none"}} />
              <button onClick={()=>setGallery(s=>({...s,idx:Math.min(s.urls.length-1,s.idx+1)}))} disabled={gallery.idx>=gallery.urls.length-1}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl disabled:opacity-30 transition-colors flex-shrink-0">›</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

/* ═══ DELEGATION TAB ═══ */
function DelegationTab({ profile }) {
  const { success, error: toastError } = useToast();
  const [delegations, setDelegations] = useState([]);
  const [users, setUsers]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [form, setForm]               = useState({ to_user_id:"", start_date:"", end_date:"", reason:"" });
  const [saving, setSaving]           = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [delRes, usersRes] = await Promise.all([
        api.get("/delegations/my"),
        api.get("/users/approvers").catch(() => ({ data:[] })),
      ]);
      setDelegations(delRes.data || []);
      // Users already filtered by backend — just exclude self
      setUsers((usersRes.data || []).filter(u => u.id !== profile.id));
    } catch { toastError("Gabim gjatë ngarkimit."); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const save = async () => {
    if (!form.to_user_id || !form.start_date || !form.end_date) { toastError("Plotëso të gjitha fushat e detyrueshme."); return; }
    if (new Date(form.start_date) > new Date(form.end_date)) { toastError("Data e fillimit duhet të jetë para datës së mbarimit."); return; }
    setSaving(true);
    try {
      await api.post("/delegations", { ...form, to_user_id: Number(form.to_user_id) });
      success("Delegimi u ruajt. Personit të zgjedhur i dërgohet email-notifikim.");
      setForm({ to_user_id:"", start_date:"", end_date:"", reason:"" });
      await loadData();
    } catch (e) { toastError(e?.response?.data?.error || "Gabim."); }
    finally { setSaving(false); }
  };

  const cancel = async (id) => {
    try { await api.delete(`/delegations/${id}`); success("Delegimi u anulua."); await loadData(); }
    catch { toastError("Gabim."); }
  };

  const today = new Date().toISOString().slice(0,10);
  const inputCls = "w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 bg-white dark:bg-slate-700 dark:text-white";
  const selectCls = "w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-400/30";

  return (
    <div className="space-y-4">
      {/* New delegation form */}
      <Card className="p-5 dark:bg-slate-800">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">🔄 Delego Aprovimin</h2>
        <p className="text-xs text-slate-500 mb-4">
          Gjatë periudhës së pushimeve, delego aprovimin te një koleg. Sistemi do t'i caktojë automatikisht kërkesat atij/asaj.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Delego te *</label>
            <select value={form.to_user_id} onChange={e => setForm(p=>({...p,to_user_id:e.target.value}))} className={selectCls}>
              <option value="">Zgjedh personin…</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.first_name} {u.last_name} ({u.role === "team_lead" ? "Team Lead" : u.role === "division_manager" ? "Menaxher" : "Drejtor"})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Arsyeja (opsionale)</label>
            <input value={form.reason} onChange={e => setForm(p=>({...p,reason:e.target.value}))} placeholder="p.sh. Pushime vjetore" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nga data *</label>
            <input type="date" min={today} value={form.start_date} onChange={e => setForm(p=>({...p,start_date:e.target.value}))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Deri më *</label>
            <input type="date" min={form.start_date||today} value={form.end_date} onChange={e => setForm(p=>({...p,end_date:e.target.value}))} className={inputCls} />
          </div>
        </div>
        <button disabled={saving} onClick={save}
          className="mt-4 px-6 py-2.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-xl hover:bg-[#162d4a] disabled:opacity-60 active:scale-95 transition-all">
          {saving ? "Duke ruajtur…" : "Konfirmo Delegimin"}
        </button>
      </Card>

      {/* Active delegations */}
      <Card className="overflow-hidden dark:bg-slate-800">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Delegimet e mia</h2>
        </div>
        {loading && <div className="py-8 text-center text-slate-400 text-sm">Duke ngarkuar…</div>}
        {!loading && !delegations.length && (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">🔄</div>
            <p className="text-sm text-slate-400">Asnjë delegim aktiv.</p>
          </div>
        )}
        {!loading && delegations.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700 border-b border-slate-100 dark:border-slate-600">
                <tr>{["Te","Nga data","Deri","Arsyeja","Statusi",""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                {delegations.map(d => {
                  const isActive = d.active && new Date(d.end_date) >= new Date() && new Date(d.start_date) <= new Date();
                  const isFuture = d.active && new Date(d.start_date) > new Date();
                  const isPast   = !d.active || new Date(d.end_date) < new Date();
                  return (
                    <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {d.to_first} {d.to_last}
                        {d.to_email && <div className="text-xs text-slate-400">{d.to_email}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs whitespace-nowrap">{d.start_date}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs whitespace-nowrap">{d.end_date}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px] truncate">{d.reason||"—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                          ${isActive ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : isFuture ? "bg-blue-100 text-blue-800 border-blue-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                          {isActive ? "✓ Aktiv tani" : isFuture ? "⏳ I ardhshëm" : "✕ Përfunduar"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(isActive || isFuture) && (
                          <button onClick={() => cancel(d.id)} className="text-xs text-red-500 hover:underline whitespace-nowrap">Anulo</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Keyboard shortcuts hint */}
      <div className="text-xs text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700">
        <span className="font-semibold text-slate-600 dark:text-slate-300">⌨️ Shortcuts:</span>
        {" "}<kbd className="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 rounded text-xs">A</kbd> Aprovo të parën
        {" · "}<kbd className="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 rounded text-xs">R</kbd> Refuzo të parën
        {" (vetëm tek tab Në pritje)"}
      </div>
    </div>
  );
}
