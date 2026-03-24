import { useState, useCallback, useRef, createContext, useContext } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const success = useCallback((msg, d) => toast(msg, "success", d), [toast]);
  const error   = useCallback((msg, d) => toast(msg, "error",   d ?? 6000), [toast]);
  const info    = useCallback((msg, d) => toast(msg, "info",    d), [toast]);
  const warn    = useCallback((msg, d) => toast(msg, "warning", d), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warn }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium animate-slide-in
              ${t.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : t.type === "error"   ? "bg-red-50 border-red-200 text-red-800"
              : t.type === "warning" ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-blue-50 border-blue-200 text-blue-800"}`}
          >
            <span className="mt-0.5 flex-shrink-0 text-base">
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : t.type === "warning" ? "⚠" : "ℹ"}
            </span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity text-lg leading-none -mt-0.5"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
