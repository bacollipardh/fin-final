import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../api";
import { useTheme } from "../theme.jsx";
import { t, setLang, getLang, langs } from "../i18n.js";

const roleLabel = (r) => t(r) || r;

const roleNav = {
  agent:            [{ path:"/agent",     icon:"📋", key:"newRequest" }],
  avancues:         [{ path:"/avancues",  icon:"📋", key:"newRequest" }],
  team_lead:        [{ path:"/approvals", icon:"✅", key:"approvals"  }],
  division_manager: [{ path:"/dashboard", icon:"📊", key:"dashboard"  }, { path:"/approvals", icon:"✅", key:"approvals" }],
  sales_director:   [{ path:"/dashboard", icon:"📊", key:"dashboard"  }, { path:"/approvals", icon:"✅", key:"approvals" }],
  admin:            [{ path:"/admin",     icon:"⚙️", key:"adminPanel" }],
};

function initials(f,l){return((f?.[0]||"")+(l?.[0]||"")).toUpperCase()||"?";}

export default function Layout({ children, profile }) {
  const [open,    setOpen]   = useState(false);
  const [notifs,  setNotifs] = useState([]);
  const [bell,    setBell]   = useState(false);
  const [showN,   setShowN]  = useState(false);
  const [, forceRender]      = useState(0);
  const navigate  = useNavigate();
  const location  = useLocation();
  const role      = profile?.role || "";
  const nav       = roleNav[role] || [];
  const evtRef    = useRef(null);
  const bellRef   = useRef(null);
  const { dark, toggle: toggleDark } = useTheme();

  const changeLang = () => {
    setLang(getLang() === "sq" ? "en" : "sq");
    forceRender(n => n+1);
  };

  // SSE — lidhje e vetme, e sigurt ndaj React Strict Mode dhe re-renders
  useEffect(() => {
    const BASE = (api?.defaults?.baseURL || "").replace(/\/$/, "");
    let es = null;
    let retryTimer = null;
    let destroyed = false;
    let retryDelay = 3000;

    const addNotif = (type, msg) => {
      setNotifs(p => [{ id: Date.now() + Math.random(), type, msg, ts: new Date() }, ...p.slice(0, 19)]);
      setBell(true);
    };

    const connect = () => {
      if (destroyed) return;
      const token = localStorage.getItem("token");
      if (!token) return;

      // Mbyll lidhjen e meparshme nese ekziston
      if (es) { try { es.close(); } catch {} es = null; }

      const url = `${BASE}/notifications/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      evtRef.current = es;
      retryDelay = 3000; // reset delay pas lidhjes se suksesshme

      es.addEventListener("new_request", e => {
        const d = JSON.parse(e.data);
        addNotif("new", `🔔 Kërkesë e re #${d.id} — €${Number(d.amount||0).toFixed(2)} (${d.buyer||""})`);
      });

      es.addEventListener("request_decided", e => {
        const d = JSON.parse(e.data);
        addNotif("decided", `${d.action==="approved"?"✅":"❌"} Kërkesa #${d.id} u ${d.action==="approved"?"aprovua":"refuzua"}`);
      });

      es.addEventListener("new_comment", e => {
        const d = JSON.parse(e.data);
        addNotif("comment", `💬 Koment i ri te kërkesa #${d.request_id}`);
      });

      es.onerror = () => {
        if (destroyed) return;
        try { es.close(); } catch {}
        es = null;
        evtRef.current = null;
        // Retry me backoff — max 30s
        retryDelay = Math.min(retryDelay * 1.5, 30000);
        retryTimer = setTimeout(connect, retryDelay);
      };
    };

    // Vonese e vogel per te shmangur double-connect ne Strict Mode
    const initTimer = setTimeout(connect, 100);

    return () => {
      destroyed = true;
      clearTimeout(initTimer);
      clearTimeout(retryTimer);
      try { es?.close(); } catch {}
      es = null;
      evtRef.current = null;
    };
  }, []);

  // Close bell on outside click
  useEffect(() => {
    const h = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setShowN(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const logout = async () => {
    try { const rt=localStorage.getItem("refresh_token"); if(rt) await api.post("/auth/logout",{refresh_token:rt}); } catch {}
    localStorage.clear();
    navigate("/login", { replace:true });
  };

  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-900 flex transition-colors`}>
      {open && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-[#1e3a5f] flex flex-col transform transition-transform duration-200 ${open?"translate-x-0":"-translate-x-full"} lg:translate-x-0 lg:static lg:flex`}>
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-sky-400 rounded-lg flex items-center justify-center text-white font-bold text-sm select-none">FA</div>
            <span className="text-white font-semibold text-sm">Fin Approvals</span>
          </div>
          <button className="ml-auto text-white/50 lg:hidden text-xl" onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/5">
            <div className="w-9 h-9 rounded-full bg-sky-400/20 border border-sky-400/30 flex items-center justify-center text-sky-300 font-semibold text-sm flex-shrink-0">
              {initials(profile?.first_name, profile?.last_name)}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{profile?.first_name} {profile?.last_name}</p>
              <p className="text-white/50 text-xs truncate">{roleLabel(role)}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(item => (
            <a key={item.path} href={item.path} onClick={e => { e.preventDefault(); navigate(item.path); setOpen(false); }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${location.pathname===item.path?"bg-white/10 text-white":"text-white/60 hover:bg-white/5 hover:text-white"}`}>
              <span>{item.icon}</span>{t(item.key)}
            </a>
          ))}
        </nav>
        {/* Dark mode + Language in sidebar bottom */}
        <div className="px-3 py-3 border-t border-white/10 space-y-1">
          <button onClick={toggleDark}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors">
            <span>{dark ? "☀️" : "🌙"}</span>
            <span>{dark ? "Modalitet i ndritshëm" : "Modalitet i errët"}</span>
          </button>
          <button onClick={changeLang}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors">
            <span>🌐</span>
            <span>{getLang() === "sq" ? "Switch to English" : "Kalo në Shqip"}</span>
          </button>
          <a href="/settings" onClick={e=>{e.preventDefault();navigate("/settings");setOpen(false);}}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 transition-colors">
            <span>⚙️</span><span>Cilësimet</span>
          </a>
          <button onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/50 hover:text-red-300 hover:bg-red-500/10 transition-colors">
            <span>→</span><span>{t("logout")}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 lg:px-6 gap-4 sticky top-0 z-10">
          <button className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" onClick={() => setOpen(true)}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div className="flex-1" />
          {profile?.pda_number && <span className="text-xs text-slate-400 hidden sm:block">PDA: {profile.pda_number}</span>}

          {/* Bell */}
          <div className="relative" ref={bellRef}>
            <button onClick={() => { setShowN(p => !p); setBell(false); }}
              className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors">
              🔔
              {bell && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
            </button>
            {showN && (
              <div className="absolute right-0 top-12 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-50 max-h-96 overflow-y-auto">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Njoftime</span>
                  {notifs.length > 0 && <button onClick={() => setNotifs([])} className="text-xs text-slate-400 hover:text-slate-600">Pastro</button>}
                </div>
                {!notifs.length
                  ? <div className="py-8 text-center text-sm text-slate-400">Pa njoftime.</div>
                  : notifs.map(n => (
                    <div key={n.id} className="px-4 py-3 border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <p className="text-sm text-slate-700 dark:text-slate-200">{n.msg}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{n.ts?.toLocaleTimeString("sq-AL")}</p>
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-200 font-semibold text-xs">
            {initials(profile?.first_name, profile?.last_name)}
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
