import { useEffect, useRef, useState } from "react";

export default function BarcodeScanner({ onResult, onClose }) {
  const videoRef    = useRef(null);
  const readerRef   = useRef(null);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let codeReader = null;

    const start = async () => {
      try {
        // Dynamically import to avoid bundle issues
        const { BrowserMultiFormatReader, NotFoundException } = await import("@zxing/browser");
        if (!mounted) return;
        codeReader = new BrowserMultiFormatReader();
        readerRef.current = codeReader;

        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (!devices.length) { setError("Asnjë kamerë e gjetur."); setLoading(false); return; }

        // Prefer back camera
        const backCam = devices.find(d => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear") || d.label.toLowerCase().includes("environment"));
        const deviceId = backCam?.deviceId || devices[devices.length - 1]?.deviceId;

        setLoading(false);
        await codeReader.decodeFromVideoDevice(deviceId, videoRef.current, (result, err) => {
          if (!mounted) return;
          if (result) {
            const text = result.getText();
            onResult(text);
          }
          // NotFoundException = still scanning, ignore
        });
      } catch (e) {
        if (mounted) {
          setError("S'u mund të hapet kamera. Kontrollo lejet.");
          setLoading(false);
        }
      }
    };

    start();

    return () => {
      mounted = false;
      try { readerRef.current?.reset(); } catch {}
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 absolute top-0 left-0 right-0 z-10">
        <span className="text-white font-medium text-sm">📷 Skano barkod</span>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-xl">×</button>
      </div>

      {/* Video */}
      <div className="flex-1 relative flex items-center justify-center">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />

        {/* Scan frame overlay */}
        {!error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-64 h-64">
              {/* Corner indicators */}
              {[["top-0 left-0","border-t-4 border-l-4"],["top-0 right-0","border-t-4 border-r-4"],["bottom-0 left-0","border-b-4 border-l-4"],["bottom-0 right-0","border-b-4 border-r-4"]].map(([pos, borders]) => (
                <div key={pos} className={`absolute ${pos} w-8 h-8 border-sky-400 ${borders}`} />
              ))}
              {/* Scan line animation */}
              <div className="absolute left-2 right-2 h-0.5 bg-sky-400/70 animate-scan" style={{ top:"50%" }} />
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2" />
              <p className="text-white/70 text-sm">Duke ndezur kamerën…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center px-6">
              <div className="text-4xl mb-3">🚫</div>
              <p className="text-white text-sm mb-4">{error}</p>
              <button onClick={onClose} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors">
                Mbyll
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-white/60 text-xs text-center py-3 bg-black/80">
        Vendos barkod-in brenda kornizës
      </p>

      <style>{`
        @keyframes scan {
          0%   { transform: translateY(-100px); opacity: 1; }
          50%  { transform: translateY(100px);  opacity: 1; }
          100% { transform: translateY(-100px); opacity: 1; }
        }
        .animate-scan { animation: scan 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
