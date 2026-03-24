import { useState } from "react";
import api from "../api";
import { useToast } from "../components/Toast";

function AuthCard({ title, sub, children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-400 rounded-xl flex items-center justify-center text-white font-bold text-sm select-none">FA</div>
            <div>
              <p className="text-white font-semibold">Fin Approvals</p>
              <p className="text-white/50 text-xs">Enterprise Platform</p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-1">{title}</h2>
          <p className="text-sm text-slate-500 mb-6">{sub}</p>
          {children}
        </div>

        {/* Back link */}
        <div className="text-center mt-5">
          <a href="/login" className="text-white/40 text-xs hover:text-white/70 transition-colors">
            ← Kthehu te faqja e hyrjes
          </a>
        </div>

        <p className="text-center text-white/20 text-xs mt-4">
          Fin Approvals Enterprise &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   FORGOT PASSWORD
────────────────────────────────────────────── */
export function ForgotPassword() {
  const [email, setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const { error: toastError } = useToast();

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) { toastError("Shkruaj emailin tënd."); return; }
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (ex) {
      // Always show success to not reveal if email exists
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Rivendos fjalëkalimin"
      sub="Shkruaj emailin e llogarisë dhe do të marrësh udhëzime."
    >
      {sent ? (
        <div className="text-center py-4 space-y-3">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <span className="text-3xl">📧</span>
          </div>
          <p className="text-sm font-medium text-slate-700">Email u dërgua!</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Nëse ky email ekziston në sistem, do të marrësh linkun e rivendosjes brenda pak minutash.
            Kontrollo edhe spam-in.
          </p>
          <p className="text-xs text-slate-400">Linku skadon pas <b>1 ore</b>.</p>
          <a href="/login"
            className="block mt-4 w-full text-center bg-[#1e3a5f] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#162d4a] transition-colors">
            Kthehu te hyrja
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Adresa email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="emri@kompania.com"
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/60 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1e3a5f] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#162d4a] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Duke dërguar…" : "Dërgo udhëzimet"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

/* ──────────────────────────────────────────────
   RESET PASSWORD
────────────────────────────────────────────── */
export function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);
  const [showPass, setShowPass]   = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const { error: toastError, success } = useToast();

  const strength = (p) => {
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  };
  const str = strength(password);
  const strLabel = ["", "Shumë i dobët", "I dobët", "Mesatar", "I fortë"][str];
  const strColor = ["", "bg-red-500", "bg-orange-400", "bg-amber-400", "bg-emerald-500"][str];

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { toastError("Fjalëkalimi duhet të ketë të paktën 6 karaktere."); return; }
    if (password !== confirm) { toastError("Fjalëkalimet nuk përputhen."); return; }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      success("Fjalëkalimi u ndryshua me sukses!");
      setTimeout(() => { window.location.href = "/login"; }, 2500);
    } catch (ex) {
      const msg = ex?.response?.data?.error || "Gabim i panjohur.";
      if (msg.includes("pavlef") || msg.includes("Invalid") || msg.includes("expired")) {
        toastError("Ky link është i pavlefshëm ose ka skaduar. Kërko një link të ri.");
      } else {
        toastError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title="Link i pavlefshëm" sub="Ky link rivendosjeje nuk është i saktë.">
        <div className="text-center py-4 space-y-3">
          <div className="text-4xl">⚠️</div>
          <p className="text-sm text-slate-600">Kliko linkun nga emaili, ose kërko një link të ri.</p>
          <a href="/forgot-password"
            className="block mt-3 w-full text-center bg-[#1e3a5f] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#162d4a] transition-colors">
            Kërko link të ri
          </a>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Fjalëkalim i ri"
      sub="Vendos fjalëkalimin e ri të llogarisë tënde."
    >
      {done ? (
        <div className="text-center py-4 space-y-3">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <span className="text-3xl">✅</span>
          </div>
          <p className="text-sm font-medium text-slate-700">Fjalëkalimi u ndryshua!</p>
          <p className="text-xs text-slate-500">Po ridrejtohesh te hyrja…</p>
          <div className="w-8 h-1 bg-[#1e3a5f] rounded-full mx-auto animate-pulse mt-2" />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fjalëkalimi i ri *</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Minimum 6 karaktere"
                required
                minLength={6}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 pr-10 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/60 transition-colors"
              />
              <button type="button" onClick={() => setShowPass(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                {showPass ? "Fshih" : "Shfaq"}
              </button>
            </div>
            {/* Strength bar */}
            {password && (
              <div className="mt-1.5 space-y-1">
                <div className="flex gap-1">
                  {[1,2,3,4].map(i => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= str ? strColor : "bg-slate-200"}`} />
                  ))}
                </div>
                <p className={`text-xs ${str >= 3 ? "text-emerald-600" : str >= 2 ? "text-amber-600" : "text-red-500"}`}>{strLabel}</p>
              </div>
            )}
          </div>

          {/* Confirm */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Konfirmo fjalëkalimin *</label>
            <div className="relative">
              <input
                type={showConf ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Shkruaj sërish fjalëkalimin"
                required
                className={`w-full border rounded-lg px-3 py-2.5 pr-10 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors
                  ${confirm && password !== confirm
                    ? "border-red-300 focus:ring-red-200 focus:border-red-400"
                    : confirm && password === confirm
                    ? "border-emerald-300 focus:ring-emerald-200"
                    : "border-slate-300 focus:ring-sky-400/30 focus:border-sky-400/60"}`}
              />
              <button type="button" onClick={() => setShowConf(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                {showConf ? "Fshih" : "Shfaq"}
              </button>
            </div>
            {confirm && password !== confirm && (
              <p className="text-xs text-red-500 mt-1">Fjalëkalimet nuk përputhen.</p>
            )}
            {confirm && password === confirm && (
              <p className="text-xs text-emerald-600 mt-1">✓ Fjalëkalimet përputhen.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || (confirm && password !== confirm)}
            className="w-full bg-[#1e3a5f] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#162d4a] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Duke ndryshuar…" : "Ndrysho fjalëkalimin"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
