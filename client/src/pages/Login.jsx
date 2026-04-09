import { useState } from "react";
import api from "../api";
import { useToast } from "../components/Toast";

export default function Login() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const { error: toastError }   = useToast();

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) { toastError("Plotëso emailin dhe fjalëkalimin."); return; }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email: email.trim(), password });
      localStorage.setItem("token",         data.token);
      localStorage.setItem("refresh_token", data.refresh_token || "");
      localStorage.setItem("role",          data.profile.role);
      localStorage.setItem("profile",       JSON.stringify(data.profile));
      if (data.profile.role === "admin")        location.href = "/admin";
      else if (data.profile.role === "agent")   location.href = "/agent";
      else                                      location.href = "/approvals";
    } catch (ex) {
      toastError(ex.response?.data?.error || "Hyrja dështoi. Kontro emailin dhe fjalëkalimin.");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-400 rounded-xl flex items-center justify-center text-white font-bold text-sm">FA</div>
            <div><p className="text-white font-semibold">Fin Approvals</p><p className="text-white/50 text-xs">Enterprise Platform</p></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-1">Hyrje</h2>
          <p className="text-sm text-slate-500 mb-6">Hyr me kredencialet e llogarisë tënde</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="emri@kompania.com" required
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/60 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Fjalëkalimi</label>
              <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/60 transition-colors" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-[#1e3a5f] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#162d4a] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2">
              {loading ? "Duke hyrë…" : "Hyr"}
            </button>
          </form>
          <div className="mt-4 text-center">
            <a href="/forgot-password" className="text-xs text-slate-400 hover:text-[#1e3a5f] transition-colors">Harrova fjalëkalimin</a>
          </div>
        </div>
        <p className="text-center text-white/30 text-xs mt-6">Fin Approvals Enterprise &copy; {new Date().getFullYear()} · Created by Fatbardh Pacolli</p>
      </div>
    </div>
  );
}
