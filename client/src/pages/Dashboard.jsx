import { useEffect, useState, useMemo } from "react";
import api from "../api";
import Layout from "../components/Layout";
import { useToast } from "../components/Toast";
import { Card, StatCard } from "../components/ui";
import { t } from "../i18n.js";

const euro = n => `€${Number(n||0).toFixed(2)}`;
const DAYS = ["Hënë","Martë","Mërkurë","Enjte","Premte","Shtunë","Diel"];
const HOURS = Array.from({length:24},(_,i)=>`${String(i).padStart(2,"0")}`);

function MiniBar({ label, val, max, color="bg-[#1e3a5f]" }) {
  const pct = max > 0 ? Math.round((val/max)*100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-600 dark:text-slate-300 truncate max-w-[200px]">{label}</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100 ml-2 flex-shrink-0">{val}</span>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{width:`${pct}%`}} />
      </div>
    </div>
  );
}

function TrendChart({ data }) {
  if (!data?.length) return <div className="h-32 flex items-center justify-center text-slate-400 text-sm">Pa të dhëna</div>;
  const maxVal = Math.max(...data.map(d => Number(d.cnt||0)), 1);
  return (
    <div className="flex items-end gap-0.5 h-32 w-full">
      {data.map((d,i) => {
        const h = Math.round((Number(d.cnt||0)/maxVal)*100);
        const label = new Date(d.day).toLocaleDateString("sq-AL",{day:"numeric",month:"short"});
        return (
          <div key={i} className="flex-1 flex flex-col items-center group relative">
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
              {label}: {d.cnt}
            </div>
            <div className="w-full bg-[#1e3a5f] dark:bg-sky-600 rounded-t hover:bg-sky-500 transition-colors" style={{height:`${h}%`,minHeight:h>0?"3px":"0"}} />
          </div>
        );
      })}
    </div>
  );
}

function HeatmapGrid({ data }) {
  if (!data?.length) return <div className="text-sm text-slate-400 py-4 text-center">Pa të dhëna</div>;
  const grid = {};
  data.forEach(d => { grid[`${d.dow}-${d.hour}`] = d.cnt; });
  const maxVal = Math.max(...data.map(d => d.cnt), 1);
  const COLOR_LEVELS = ["bg-slate-100 dark:bg-slate-800","bg-sky-100 dark:bg-sky-900","bg-sky-300 dark:bg-sky-700","bg-sky-500","bg-[#1e3a5f]"];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[500px]">
        <div className="flex mb-1">
          <div className="w-12" />
          {HOURS.filter((_,i) => i%3===0).map(h => (
            <div key={h} className="flex-1 text-center text-xs text-slate-400">{h}</div>
          ))}
        </div>
        {[1,2,3,4,5,6,0].map(dow => (
          <div key={dow} className="flex gap-0.5 mb-0.5 items-center">
            <div className="w-12 text-xs text-slate-500 text-right pr-2 flex-shrink-0">{DAYS[dow===0?6:dow-1]}</div>
            {HOURS.map((_,hour) => {
              const cnt = grid[`${dow}-${hour}`] || 0;
              const level = cnt === 0 ? 0 : Math.ceil((cnt/maxVal)*4);
              return (
                <div key={hour} title={`${DAYS[dow===0?6:dow-1]} ${hour}:00 — ${cnt} kërkesa`}
                  className={`flex-1 h-4 rounded-sm ${COLOR_LEVELS[level]} transition-colors cursor-default`} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PeriodCompare({ data }) {
  if (!data) return null;
  const { this_month_cnt=0, last_month_cnt=0, this_month_val=0, last_month_val=0 } = data;
  const cntDiff = last_month_cnt > 0 ? Math.round(((this_month_cnt-last_month_cnt)/last_month_cnt)*100) : 0;
  const valDiff = last_month_val > 0 ? Math.round(((this_month_val-last_month_val)/last_month_val)*100) : 0;
  const arrow = n => n > 0 ? <span className="text-emerald-600">↑ {n}%</span> : n < 0 ? <span className="text-red-500">↓ {Math.abs(n)}%</span> : <span className="text-slate-400">—</span>;
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs text-slate-500 mb-1">{t("thisMonth")}</p>
        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{this_month_cnt} <span className="text-sm font-normal">{arrow(cntDiff)}</span></p>
        <p className="text-xs text-slate-500">{euro(this_month_val)}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">{t("lastMonth")}</p>
        <p className="text-2xl font-bold text-slate-600 dark:text-slate-300">{last_month_cnt}</p>
        <p className="text-xs text-slate-500">{euro(last_month_val)}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const profile = useMemo(() => { try { return JSON.parse(localStorage.getItem("profile")||"{}"); } catch { return {}; } }, []);
  const { error: toastError } = useToast();
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [exportFrom, setExpFrom] = useState("");
  const [exportTo,   setExpTo]   = useState("");
  const [exporting,  setExporing] = useState(false);

  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/dashboard/stats"); setStats(data); }
      catch (e) { if (e?.response?.status===401){localStorage.clear();location.href="/login";return;} toastError("Gabim gjatë ngarkimit."); }
      finally { setLoading(false); }
    })();
  }, []);

  const exportCsv = async () => {
    setExporing(true);
    try {
      const p = new URLSearchParams();
      if (exportFrom) p.set("from", exportFrom);
      if (exportTo)   p.set("to",   exportTo);
      const { data } = await api.get(`/approvals/export-csv?${p}`, { responseType:"blob" });
      const url = URL.createObjectURL(new Blob([data],{type:"text/csv;charset=utf-8"}));
      const a = document.createElement("a"); a.href=url; a.download=`aprovime-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { toastError("Gabim gjatë eksportit."); }
    finally { setExporing(false); }
  };

  if (loading) return (
    <Layout profile={profile}>
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-[#1e3a5f] rounded-full animate-spin" />
      </div>
    </Layout>
  );

  const byStatus = stats?.by_status||[];
  const pending  = byStatus.find(s=>s.status==="pending");
  const approved = byStatus.find(s=>s.status==="approved");
  const rejected = byStatus.find(s=>s.status==="rejected");
  const agents   = stats?.top_agents||[];
  const maxCnt   = agents.length ? Math.max(...agents.map(a=>a.cnt)) : 1;

  return (
    <Layout profile={profile}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t("dashboard")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t("statsTitle")}</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label={t("totalRequests")} value={stats?.total||0} />
          <StatCard label={t("totalValue")}    value={euro(stats?.total_value)} color="blue" />
          <StatCard label={t("approvedValue")} value={euro(stats?.approved_value)} color="green" />
          <StatCard label={t("pending2")}      value={pending?.cnt||0} color="amber" />
        </div>

        {/* Period comparison + Aging */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-5 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">📅 {t("periodComp")}</h3>
            <PeriodCompare data={stats?.period_comparison} />
          </Card>
          <Card className="p-5 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">⏱️ {t("aging")}</h3>
            <div className="text-3xl font-bold text-[#1e3a5f] dark:text-sky-400">
              {stats?.aging?.avg_hours || "0.0"}
              <span className="text-base font-normal text-slate-500 ml-1">{t("hours")}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Koha mesatare e pritjes për {stats?.aging?.pending_cnt||0} kërkesa në pritje
            </p>
          </Card>
        </div>

        {/* Status breakdown */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-5 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">{t("byStatus")}</h3>
            <div className="space-y-3">
              {[
                { s:pending,  label:t("pending"),  dot:"bg-amber-400" },
                { s:approved, label:t("approved"), dot:"bg-emerald-500" },
                { s:rejected, label:t("rejected"), dot:"bg-red-500" },
              ].map(({s,label,dot}) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full ${dot}`} /><span className="text-sm text-slate-600 dark:text-slate-300">{label}</span></div>
                  <div className="text-right"><span className="font-bold text-slate-800 dark:text-slate-100">{s?.cnt||0}</span><span className="text-xs text-slate-400 ml-2">{euro(s?.val)}</span></div>
                </div>
              ))}
              {stats?.total > 0 && (
                <div className="mt-2 h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                  <div className="bg-amber-400 h-full" style={{width:`${Math.round(((pending?.cnt||0)/stats.total)*100)}%`}} />
                  <div className="bg-emerald-500 h-full" style={{width:`${Math.round(((approved?.cnt||0)/stats.total)*100)}%`}} />
                  <div className="bg-red-400 h-full" style={{width:`${Math.round(((rejected?.cnt||0)/stats.total)*100)}%`}} />
                </div>
              )}
            </div>
          </Card>
          <Card className="p-5 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">{t("byRole")}</h3>
            <div className="space-y-2">
              {!(stats?.by_role?.length) && <p className="text-sm text-slate-400">Asnjë në pritje.</p>}
              {(stats?.by_role||[]).map(r => (
                <div key={r.required_role} className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-300">{t(r.required_role)||r.required_role}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-100">{r.cnt}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Trend */}
        <Card className="p-5 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">{t("trend30")}</h3>
          <TrendChart data={stats?.trend_30d||[]} />
          <div className="flex justify-between mt-2 text-xs text-slate-400">
            {stats?.trend_30d?.[0] && <span>{new Date(stats.trend_30d[0].day).toLocaleDateString("sq-AL",{day:"numeric",month:"short"})}</span>}
            {stats?.trend_30d?.length>1 && <span>{new Date(stats.trend_30d[stats.trend_30d.length-1].day).toLocaleDateString("sq-AL",{day:"numeric",month:"short"})}</span>}
          </div>
        </Card>

        {/* Heatmap */}
        <Card className="p-5 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">🗓️ {t("heatmap")}</h3>
          <HeatmapGrid data={stats?.heatmap||[]} />
          <div className="flex items-center gap-2 mt-3 justify-end">
            <span className="text-xs text-slate-400">Pak</span>
            {["bg-slate-100 dark:bg-slate-800","bg-sky-100","bg-sky-300","bg-sky-500","bg-[#1e3a5f]"].map((c,i) => (
              <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
            ))}
            <span className="text-xs text-slate-400">Shumë</span>
          </div>
        </Card>

        {/* Top agents */}
        <Card className="p-5 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">🏆 {t("topAgents")}</h3>
          <div className="space-y-3">
            {!agents.length && <p className="text-sm text-slate-400">Pa të dhëna.</p>}
            {agents.map((a,i) => (
              <MiniBar key={i} label={`${i+1}. ${a.first_name} ${a.last_name}`} val={a.cnt} max={maxCnt} />
            ))}
          </div>
        </Card>

        {/* CSV Export */}
        <Card className="p-5 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">📥 Eksporto të dhëna</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t("fromDate")}</label>
              <input type="date" value={exportFrom} onChange={e=>setExpFrom(e.target.value)}
                className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 dark:bg-slate-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t("toDate")}</label>
              <input type="date" value={exportTo} onChange={e=>setExpTo(e.target.value)}
                className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/30 dark:bg-slate-700 dark:text-white" />
            </div>
            <button onClick={exportCsv} disabled={exporting}
              className="px-5 py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#162d4a] disabled:opacity-60 active:scale-95 transition-all">
              {exporting ? "Duke eksportuar…" : t("exportCsv")}
            </button>
            <p className="text-xs text-slate-400 self-center">Lër bosh për të gjitha datat</p>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
