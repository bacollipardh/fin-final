import { useEffect, useState, useCallback } from "react";
import api from "../api";
import { useToast } from "../components/Toast";
import { StatusBadge, euro } from "../components/ui";

const roleLabel = r => ({ team_lead:"Team Lead", division_manager:"Menaxher Divizioni", sales_director:"Drejtor Shitjesh" }[r] || r);
const fmt = n => Number(n||0).toFixed(2);

// ── Search section ────────────────────────────────────────────
function ApprovalSearch({ onSelect }) {
  const [searchId, setSearchId] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const { error: toastError } = useToast();

  const searchById = async () => {
    const id = Number(searchId.trim());
    if (!id) return toastError("Shkruaj ID-në e aprovimit financiar");
    setLoading(true);
    try {
      const { data } = await api.get(`/returns/approvals/${id}`);
      onSelect(data);
    } catch(e) {
      toastError(e?.response?.data?.error || "Aprovimi financiar nuk u gjet");
    } finally { setLoading(false); }
  };

  const searchFull = useCallback(async () => {
    if (!searchQ.trim()) return;
    setLoading(true);
    try {
      const { data } = await api.get("/returns/approvals/search", { params: { q: searchQ } });
      setResults(data);
    } catch { toastError("Gabim gjatë kërkimit"); }
    finally { setLoading(false); }
  }, [searchQ]);

  const loadApproval = async (id) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/returns/approvals/${id}`);
      onSelect(data);
      setResults([]);
      setSearchQ("");
    } catch(e) { toastError(e?.response?.data?.error || "Gabim"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Search by ID */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-3">Kërko me ID Aprovimi Financiar</h3>
        <div className="flex gap-2">
          <input
            type="number"
            value={searchId}
            onChange={e => setSearchId(e.target.value)}
            onKeyDown={e => e.key === "Enter" && searchById()}
            placeholder="P.sh. 42"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={searchById} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? "..." : "Ngarko"}
          </button>
        </div>
      </div>

      {/* Search by buyer/object/article */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-3">Kërko sipas Blerësit / Objektit / Artikullit</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && searchFull()}
            placeholder="Emri blerësi, objekti, SKU artikulli..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={searchFull} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            Kërko
          </button>
        </div>

        {results.length > 0 && (
          <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            {results.map(r => (
              <button key={r.id} onClick={() => loadApproval(r.id)}
                className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-blue-700">#{r.id}</span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-sm text-gray-700">{r.buyer_code} — {r.buyer_name}</span>
                    {r.site_name && <span className="text-sm text-gray-500 ml-1">/ {r.site_name}</span>}
                  </div>
                  <span className="text-sm font-semibold text-green-700">€{fmt(r.amount)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {r.agent_first} {r.agent_last} · {new Date(r.created_at).toLocaleDateString("sq-AL")}
                </div>
              </button>
            ))}
          </div>
        )}
        {results.length === 0 && searchQ && !loading && (
          <p className="text-sm text-gray-400 mt-2">Nuk u gjet asnjë aprovim financiar.</p>
        )}
      </div>
    </div>
  );
}

// ── Return form with loaded approval ─────────────────────────
function ReturnForm({ approval, onSuccess, onCancel }) {
  const { req, lines: srcLines } = approval;
  const [lines, setLines] = useState(() =>
    srcLines.map(l => ({ ...l, requested_return_qty: l.remaining_qty > 0 ? l.remaining_qty : 0, is_removed: l.remaining_qty <= 0 }))
  );
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { success, error: toastError } = useToast();

  const updateQty = (idx, val) => {
    setLines(prev => prev.map((l, i) => i !== idx ? l : { ...l, requested_return_qty: Math.max(0, Math.min(l.remaining_qty, Number(val)||0)) }));
  };

  const toggleRemove = (idx) => {
    setLines(prev => prev.map((l, i) => i !== idx ? l : { ...l, is_removed: !l.is_removed }));
  };

  const activeLines = lines.filter(l => !l.is_removed && l.requested_return_qty > 0);
  const totalValue = activeLines.reduce((sum, l) => sum + (Number(l.final_price)||0) * l.requested_return_qty, 0);

  const submit = async () => {
    if (!activeLines.length) return toastError("Duhet të ketë të paktën një linjë aktive me sasi > 0");
    if (!reason.trim()) return toastError("Arsyeja është e detyrueshme");
    setSubmitting(true);
    try {
      await api.post("/returns", {
        financial_approval_id: req.id,
        comment, reason,
        lines: lines.map(l => ({ request_item_id: l.request_item_id, requested_return_qty: l.requested_return_qty, is_removed: l.is_removed }))
      });
      success("Kërkesa e kthimit u dërgua me sukses!");
      onSuccess();
    } catch(e) {
      toastError(e?.response?.data?.error || "Gabim gjatë dërgimit");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">Aprovim Financiar #{req.id}</h3>
            <p className="text-sm text-gray-500">{new Date(req.created_at||Date.now()).toLocaleDateString("sq-AL")}</p>
          </div>
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 underline">← Kthe</button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">Blerësi:</span> <strong>{req.buyer_code} — {req.buyer_name}</strong></div>
          {req.site_name && <div><span className="text-gray-500">Objekti:</span> <strong>{req.site_name}</strong></div>}
          <div><span className="text-gray-500">Agjenti:</span> <strong>{req.agent_first} {req.agent_last}</strong></div>
          <div><span className="text-gray-500">Nivel aprovimi:</span> <strong>{roleLabel(req.required_role)}</strong></div>
        </div>
      </div>

      {/* Lines grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="font-semibold text-gray-700">Linjat e Kthimit</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                <th className="px-4 py-2 text-left">SKU / Artikull</th>
                <th className="px-4 py-2 text-left">Lot Kodi</th>
                <th className="px-4 py-2 text-right">Çmimi Final</th>
                <th className="px-4 py-2 text-right">Sasia Aprov.</th>
                <th className="px-4 py-2 text-right">Tashmë Kthyer</th>
                <th className="px-4 py-2 text-right">Mbetet</th>
                <th className="px-4 py-2 text-right w-28">Kthim Kërkuar</th>
                <th className="px-4 py-2 text-center">Hiq</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, idx) => (
                <tr key={idx} className={line.is_removed ? "opacity-40 bg-gray-50" : line.remaining_qty <= 0 ? "bg-amber-50" : ""}>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-blue-700">{line.sku}</div>
                    <div className="text-gray-700">{line.name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{line.lot_kod || "—"}</td>
                  <td className="px-4 py-3 text-right">€{fmt(line.final_price)}</td>
                  <td className="px-4 py-3 text-right font-medium">{line.approved_qty}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{line.already_returned_qty}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">{line.remaining_qty}</td>
                  <td className="px-4 py-3 text-right">
                    {line.remaining_qty > 0 && !line.is_removed ? (
                      <input
                        type="number" min={0} max={line.remaining_qty}
                        value={line.requested_return_qty}
                        onChange={e => updateQty(idx, e.target.value)}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    ) : (
                      <span className="text-gray-400">{line.remaining_qty <= 0 ? "0 mbetur" : "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {line.remaining_qty > 0 && (
                      <button onClick={() => toggleRemove(idx)}
                        className={`text-xs px-2 py-1 rounded font-medium transition-colors ${line.is_removed ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-100 text-red-600 hover:bg-red-200"}`}>
                        {line.is_removed ? "Shto" : "Hiq"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
          <span className="text-sm text-gray-500 mr-2">Vlera totale e kthimit:</span>
          <span className="font-bold text-blue-700">€{fmt(totalValue)}</span>
        </div>
      </div>

      {/* Comment & Reason */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Arsyeja <span className="text-red-500">*</span></label>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Pse po kthehet malli..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Koment (opsional)</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Shënime shtesë..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Anulo</button>
        <button onClick={submit} disabled={submitting || !activeLines.length}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
          {submitting ? "Duke dërguar..." : `Dërgo Kërkesën (${activeLines.length} linja)`}
        </button>
      </div>
    </div>
  );
}

// ── My returns history ────────────────────────────────────────
function MyReturns({ refresh }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get("/returns/my").then(r => setData(r.data)).catch(()=>{}).finally(() => setLoading(false));
  }, [refresh]);

  if (loading) return <div className="text-center py-8 text-gray-400">Duke ngarkuar...</div>;
  if (!data.length) return <div className="text-center py-8 text-gray-400">Nuk keni kërkesa kthimi.</div>;

  return (
    <div className="space-y-3">
      {data.map(r => (
        <div key={r.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-gray-50"
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
            <div>
              <span className="font-semibold text-gray-800">Kthim #{r.id}</span>
              <span className="mx-2 text-gray-400">·</span>
              <span className="text-sm text-gray-600">Aprovim #{r.financial_approval_id}</span>
              <span className="mx-2 text-gray-400">·</span>
              <span className="text-sm text-gray-600">{r.buyer_code} — {r.buyer_name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-blue-700">€{fmt(r.total_value)}</span>
              <StatusBadge status={r.status} />
            </div>
          </button>
          {expanded === r.id && (
            <div className="border-t border-gray-100 px-5 py-4">
              {r.reason && <p className="text-sm text-gray-600 mb-3"><strong>Arsyeja:</strong> {r.reason}</p>}
              {r.last_approver && (
                <p className="text-sm text-gray-500 mb-3">
                  <strong>Vendimi:</strong> {r.last_action === "approved" ? "✓ Aprovuar" : "✕ Refuzuar"} nga {r.last_approver}
                  {r.last_comment && ` — "${r.last_comment}"`}
                </p>
              )}
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400">
                  <th className="text-left pb-1">SKU</th><th className="text-left pb-1">Artikull</th>
                  <th className="text-right pb-1">Lot</th><th className="text-right pb-1">Sasia</th><th className="text-right pb-1">Vlera</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {r.lines.filter(l=>!l.is_removed).map((l,i)=>(
                    <tr key={i}>
                      <td className="py-1 font-mono text-blue-700">{l.sku}</td>
                      <td className="py-1 text-gray-700">{l.name}</td>
                      <td className="py-1 text-right font-mono text-gray-500">{l.lot_kod||"—"}</td>
                      <td className="py-1 text-right">{l.requested_return_qty}</td>
                      <td className="py-1 text-right">€{fmt(Number(l.final_price)*l.requested_return_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main KthimiPaAfat component ───────────────────────────────
export default function KthimiPaAfat() {
  const [view, setView] = useState("search"); // search | form | history
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = (data) => {
    setSelectedApproval(data);
    setView("form");
  };

  const handleSuccess = () => {
    setSelectedApproval(null);
    setView("history");
    setRefreshKey(k => k+1);
  };

  const handleCancel = () => {
    setSelectedApproval(null);
    setView("search");
  };

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {[["search","🔍 Kërkesë e Re"],["history","📋 Historiku Im"]].map(([v,label])=>(
          <button key={v} onClick={()=>{ setView(v); setSelectedApproval(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${view===v||( v==="search"&&view==="form") ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {view === "search" && <ApprovalSearch onSelect={handleSelect} />}
      {view === "form" && selectedApproval && (
        <ReturnForm approval={selectedApproval} onSuccess={handleSuccess} onCancel={handleCancel} />
      )}
      {view === "history" && <MyReturns refresh={refreshKey} />}
    </div>
  );
}
