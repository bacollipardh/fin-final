import { useEffect, useState, useRef } from "react";
import api from "../api";
import { useToast } from "./Toast";

const ROLE_COLOR = {
  agent: "bg-blue-100 text-blue-800",
  team_lead: "bg-emerald-100 text-emerald-800",
  division_manager: "bg-purple-100 text-purple-800",
  sales_director: "bg-indigo-100 text-indigo-800",
  admin: "bg-gray-100 text-gray-700",
};

function timeAgo(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60)   return "Tani";
  if (diff < 3600) return `${Math.floor(diff/60)} min`;
  if (diff < 86400) return `${Math.floor(diff/3600)} orë`;
  return new Date(date).toLocaleDateString("sq-AL");
}

export default function Comments({ requestId, currentUser }) {
  const [comments, setComments] = useState([]);
  const [body, setBody]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [sending, setSending]   = useState(false);
  const bottomRef = useRef(null);
  const { error: toastError }   = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/requests/${requestId}/comments`);
      setComments(data || []);
    } catch { toastError("Gabim gjatë ngarkimit të komenteve."); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (requestId) load(); }, [requestId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const { data } = await api.post(`/requests/${requestId}/comments`, { body: text });
      setComments(p => [...p, data]);
      setBody("");
    } catch (e) {
      toastError(e?.response?.data?.error || "Gabim gjatë dërgimit.");
    } finally { setSending(false); }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          💬 Diskutim
          {comments.length > 0 && <span className="ml-2 text-xs text-slate-400">({comments.length})</span>}
        </h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 max-h-72">
        {loading && (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-slate-200 border-t-[#1e3a5f] rounded-full animate-spin" />
          </div>
        )}
        {!loading && !comments.length && (
          <p className="text-xs text-slate-400 text-center py-4">Asnjë mesazh ende. Fillo diskutimin!</p>
        )}
        {!loading && comments.map(c => {
          const isMe = currentUser && c.user_id === currentUser.id;
          return (
            <div key={c.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
              {/* Avatar */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${ROLE_COLOR[c.role] || "bg-slate-100 text-slate-600"}`}>
                {(c.first_name?.[0] || "?").toUpperCase()}
              </div>
              {/* Bubble */}
              <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                <div className={`flex items-center gap-1.5 mb-1 ${isMe ? "flex-row-reverse" : ""}`}>
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.first_name} {c.last_name}</span>
                  <span className="text-xs text-slate-400">{timeAgo(c.created_at)}</span>
                </div>
                <div className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words
                  ${isMe
                    ? "bg-[#1e3a5f] text-white rounded-tr-sm"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-tl-sm"}`}>
                  {c.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700">
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Shkruaj mesazh… (Ctrl+Enter për dërgim)"
            rows={1}
            maxLength={2000}
            className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-400/30 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ minHeight: "38px", maxHeight: "120px" }}
            onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
          />
          <button onClick={send} disabled={!body.trim() || sending}
            className="px-3 py-2 bg-[#1e3a5f] text-white rounded-xl text-sm font-medium hover:bg-[#162d4a] disabled:opacity-50 transition-colors flex-shrink-0">
            {sending ? "…" : "→"}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1">Ctrl+Enter për dërgim të shpejtë</p>
      </div>
    </div>
  );
}
