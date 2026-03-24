// Shared UI components

export function StatusBadge({ status }) {
  const map = {
    pending:  { label: "Në pritje", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    approved: { label: "Aprovuar",  cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    rejected: { label: "Refuzuar",  cls: "bg-red-100 text-red-800 border-red-200" },
  };
  const { label, cls } = map[status] || { label: status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}

export function RoleBadge({ role }) {
  const map = {
    team_lead:        { label: "Team Lead",       cls: "bg-blue-100 text-blue-800 border-blue-200" },
    division_manager: { label: "Menaxher",         cls: "bg-purple-100 text-purple-800 border-purple-200" },
    sales_director:   { label: "Drejtor",          cls: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    agent:            { label: "Agjent",            cls: "bg-slate-100 text-slate-700 border-slate-200" },
    admin:            { label: "Admin",             cls: "bg-gray-100 text-gray-700 border-gray-200" },
  };
  const { label, cls } = map[role] || { label: role, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{label}</span>;
}

export function SkeletonRow({ cols = 6 }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-slate-200 rounded w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard() {
  return (
    <div className="animate-pulse bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="h-4 bg-slate-200 rounded w-1/3" />
      <div className="h-8 bg-slate-200 rounded w-1/2" />
      <div className="h-3 bg-slate-200 rounded w-2/3" />
    </div>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Btn({ children, variant = "primary", size = "md", disabled, onClick, type = "button", className = "" }) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy/50 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
  const variants = {
    primary:  "bg-navy text-white hover:bg-navy-dark active:scale-[0.98]",
    secondary:"bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-[0.98]",
    success:  "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98]",
    danger:   "bg-red-500 text-white hover:bg-red-600 active:scale-[0.98]",
    ghost:    "bg-transparent text-slate-600 hover:bg-slate-100",
    outline:  "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Input({ label, error, className = "", ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>}
      <input
        className={`w-full border rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 bg-white
          focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/50 transition-colors
          ${error ? "border-red-300 focus:ring-red-200" : "border-slate-300"}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function Select({ label, error, className = "", children, ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>}
      <select
        className={`w-full border rounded-lg px-3 py-2 text-sm text-slate-900 bg-white
          focus:outline-none focus:ring-2 focus:ring-navy/30 focus:border-navy/50 transition-colors
          ${error ? "border-red-300" : "border-slate-300"}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function Pager({ page, pages, total, per, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
      <span>Gjithsej <b className="text-slate-700">{total}</b> — faqja <b className="text-slate-700">{page}</b> nga <b className="text-slate-700">{pages}</b></span>
      <div className="flex gap-2">
        <button onClick={onPrev} disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors">
          ‹ Prev
        </button>
        <button onClick={onNext} disabled={page >= pages}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors">
          Next ›
        </button>
      </div>
    </div>
  );
}

export function StatCard({ label, value, sub, color = "default" }) {
  const colors = {
    default: "text-slate-900",
    blue:    "text-blue-700",
    green:   "text-emerald-700",
    amber:   "text-amber-700",
    red:     "text-red-700",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function euro(n) { return `€${Number(n || 0).toFixed(2)}`; }
