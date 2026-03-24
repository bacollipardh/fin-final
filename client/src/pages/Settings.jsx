import { useEffect, useState, useMemo } from "react";
import api from "../api";
import Layout from "../components/Layout";
import { useToast } from "../components/Toast";
import { Card } from "../components/ui";
import { useTheme } from "../theme.jsx";
import { t, setLang, getLang, langs } from "../i18n.js";

export default function Settings() {
  const profile = useMemo(() => { try { return JSON.parse(localStorage.getItem("profile")||"{}"); } catch { return {}; } }, []);
  const { success, error: toastError, info } = useToast();
  const { dark, toggle: toggleDark } = useTheme();
  const [, forceRender] = useState(0);

  // 2FA
  const [has2fa,    setHas2fa]    = useState(false);
  const [setup2fa,  setSetup2fa]  = useState(null); // { secret, qr }
  const [totpCode,  setTotpCode]  = useState("");
  const [disCode,   setDisCode]   = useState("");
  const [showing2fa, setShowing2fa] = useState(false);
  const [confirmDis, setConfirmDis] = useState(false);
  const [verifying,  setVerifying]  = useState(false);

  // Sessions
  const [sessions,       setSessions]       = useState([]);
  const [sessionsLoading, setSessionsLoad]  = useState(false);
  const [revokingAll,    setRevokingAll]    = useState(false);

  useEffect(() => {
    // Check 2FA status from stored profile
    const u = JSON.parse(localStorage.getItem("profile")||"{}");
    setHas2fa(!!u.totp_enabled);
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setSessionsLoad(true);
    try {
      const { data } = await api.get("/auth/sessions");
      setSessions(data || []);
    } catch { toastError("Gabim gjatë ngarkimit të sesioneve."); }
    finally { setSessionsLoad(false); }
  };

  // ── 2FA setup ──
  const start2faSetup = async () => {
    try {
      const { data } = await api.post("/auth/2fa/setup");
      setSetup2fa(data);
      setShowing2fa(true);
      setTotpCode("");
    } catch { toastError("Gabim gjatë konfigurimit 2FA."); }
  };

  const confirm2fa = async () => {
    if (!totpCode || totpCode.length !== 6) { toastError("Shkruaj kodin 6-shifror."); return; }
    setVerifying(true);
    try {
      await api.post("/auth/2fa/confirm", { code: totpCode });
      setHas2fa(true);
      setShowing2fa(false);
      setSetup2fa(null);
      const p = JSON.parse(localStorage.getItem("profile")||"{}");
      p.totp_enabled = true;
      localStorage.setItem("profile", JSON.stringify(p));
      success("2FA u aktivizua me sukses!");
    } catch { toastError("Kodi është i gabuar. Provo sërish."); }
    finally { setVerifying(false); }
  };

  const disable2fa = async () => {
    if (!disCode || disCode.length !== 6) { toastError("Shkruaj kodin 6-shifror."); return; }
    setVerifying(true);
    try {
      await api.post("/auth/2fa/disable", { code: disCode });
      setHas2fa(false);
      setConfirmDis(false);
      setDisCode("");
      const p = JSON.parse(localStorage.getItem("profile")||"{}");
      p.totp_enabled = false;
      localStorage.setItem("profile", JSON.stringify(p));
      info("2FA u çaktivizua.");
    } catch { toastError("Kodi është i gabuar."); }
    finally { setVerifying(false); }
  };

  const revokeSession = async (id) => {
    try {
      await api.delete(`/auth/sessions/${id}`);
      setSessions(p => p.filter(s => s.id !== id));
      success("Seansi u mbyll.");
    } catch { toastError("Gabim."); }
  };

  const revokeAllSessions = async () => {
    setRevokingAll(true);
    try {
      await api.delete("/auth/sessions");
      await loadSessions();
      success("Të gjitha seancat e tjera u mbyllën.");
    } catch { toastError("Gabim."); }
    finally { setRevokingAll(false); }
  };

  const changeLang = (lang) => {
    setLang(lang);
    forceRender(n => n+1);
    info(lang === "sq" ? "Gjuha ndërrua në Shqip." : "Language changed to English.");
  };

  return (
    <Layout profile={profile}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">⚙️ {t("settings")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{profile.first_name} {profile.last_name} · {profile.email}</p>
        </div>

        {/* Appearance */}
        <Card className="p-5 dark:bg-slate-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">🎨 Pamja</h2>
          <div className="space-y-3">
            {/* Dark mode */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("darkMode")}</p>
                <p className="text-xs text-slate-500">Ndryshon pamjen e aplikacionit</p>
              </div>
              <button onClick={toggleDark}
                className={`relative w-12 h-6 rounded-full transition-colors ${dark ? "bg-[#1e3a5f]" : "bg-slate-300"}`}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${dark ? "translate-x-6" : "translate-x-0.5"}`} />
              </button>
            </div>
            {/* Language */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("language")}</p>
                <p className="text-xs text-slate-500">Gjuha e ndërfaqes</p>
              </div>
              <div className="flex gap-2">
                {Object.entries(langs).map(([code, label]) => (
                  <button key={code} onClick={() => changeLang(code)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                      ${getLang() === code
                        ? "bg-[#1e3a5f] text-white"
                        : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* 2FA */}
        <Card className="p-5 dark:bg-slate-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">🔐 {t("twoFactor")}</h2>
          <p className="text-xs text-slate-500 mb-4">
            {has2fa ? "2FA është aktiv — llogaria juaj është e mbrojtur shtesë." : "Aktivizo 2FA për siguri shtesë të llogarisë."}
          </p>

          {!has2fa && !showing2fa && (
            <button onClick={start2faSetup}
              className="px-4 py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#162d4a] transition-colors">
              {t("setupTotp")}
            </button>
          )}

          {showing2fa && setup2fa && (
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4 text-center">
                <p className="text-xs text-slate-600 dark:text-slate-300 mb-3">{t("scanQr")}</p>
                <img src={setup2fa.qr} alt="QR Code" className="w-40 h-40 mx-auto rounded-lg" />
              </div>
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-1">Kodi manual (nëse nuk mund të skanosh):</p>
                <code className="text-xs font-mono text-slate-700 dark:text-slate-200 break-all">{setup2fa.secret}</code>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t("enterCode")}</label>
                <div className="flex gap-2">
                  <input value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                    placeholder="123456" maxLength={6}
                    className="flex-1 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-sky-400/30 dark:bg-slate-700 dark:text-white" />
                  <button onClick={confirm2fa} disabled={verifying || totpCode.length !== 6}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                    {verifying ? "…" : t("verify")}
                  </button>
                </div>
              </div>
              <button onClick={() => { setShowing2fa(false); setSetup2fa(null); }}
                className="text-xs text-slate-400 hover:text-slate-600 underline">{t("cancel")}</button>
            </div>
          )}

          {has2fa && !confirmDis && (
            <button onClick={() => setConfirmDis(true)}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors">
              {t("disable2fa")}
            </button>
          )}
          {has2fa && confirmDis && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">Shkruaj kodin nga aplikacioni tënd TOTP për të çaktivizuar 2FA:</p>
              <div className="flex gap-2">
                <input value={disCode} onChange={e => setDisCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                  placeholder="123456" maxLength={6}
                  className="flex-1 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-red-300/30 dark:bg-slate-700 dark:text-white" />
                <button onClick={disable2fa} disabled={verifying || disCode.length !== 6}
                  className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 disabled:opacity-60 transition-colors">
                  {verifying ? "…" : "Çaktivizo"}
                </button>
                <button onClick={() => { setConfirmDis(false); setDisCode(""); }}
                  className="px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors">{t("cancel")}</button>
              </div>
            </div>
          )}
        </Card>

        {/* Sessions */}
        <Card className="p-5 dark:bg-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">💻 Seancat aktive</h2>
              <p className="text-xs text-slate-500 mt-0.5">Pajisjet ku je i kyçur aktualisht</p>
            </div>
            {sessions.length > 1 && (
              <button onClick={revokeAllSessions} disabled={revokingAll}
                className="px-3 py-1.5 border border-red-300 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors">
                {revokingAll ? "…" : "Mbyll të tjerat"}
              </button>
            )}
          </div>
          {sessionsLoading && <div className="py-4 text-center text-sm text-slate-400">Duke ngarkuar…</div>}
          {!sessionsLoading && !sessions.length && <p className="text-sm text-slate-400">Asnjë seansë aktive.</p>}
          <div className="space-y-2">
            {sessions.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {s.device_name?.includes("Telefon") ? "📱" : s.device_name?.includes("Tablet") ? "📲" : "💻"}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {s.device_name || "Pajisje e panjohur"}
                      {i === 0 && <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Aktuale</span>}
                    </p>
                    <p className="text-xs text-slate-500">IP: {s.ip || "—"} · {s.last_active ? new Date(s.last_active).toLocaleDateString("sq-AL") : "—"}</p>
                  </div>
                </div>
                {i !== 0 && (
                  <button onClick={() => revokeSession(s.id)}
                    className="text-xs text-red-500 hover:text-red-700 hover:underline transition-colors">Mbyll</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
