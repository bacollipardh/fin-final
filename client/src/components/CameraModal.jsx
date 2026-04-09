// client/src/components/CameraModal.jsx
// Komponenti për foto dokumenti — hapet si modal/popup
// Përdorim: <CameraModal onCapture={(file) => setPhotos(p => [...p, file])} />

import { useState, useRef, useCallback, useEffect } from 'react';

export default function CameraModal({ onCapture, disabled = false }) {
  const [isOpen, setIsOpen]     = useState(false);
  const [stream, setStream]     = useState(null);
  const [cameraErr, setCameraErr] = useState('');
  const [captured, setCaptured] = useState([]); // foto të kapur në këtë sesion

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);

  /* ── Hap kamerën ── */
  const openCamera = useCallback(async () => {
    setCameraErr('');
    setCaptured([]);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraErr('Kamera nuk mbështetet në këtë browser.');
      setIsOpen(true);
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      setIsOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      if (location.protocol === 'http:' && location.hostname !== 'localhost') {
        setCameraErr('Kamera kërkon HTTPS. Qasju me https://');
      } else if (err.name === 'NotAllowedError') {
        setCameraErr('Kamera u bllokua. Lejo aksesin në browser settings.');
      } else {
        setCameraErr('Gabim: ' + (err.message || err.name));
      }
      setIsOpen(true);
    }
  }, []);

  /* ── Mbyll kamerën ── */
  const closeCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    setIsOpen(false);
    setCaptured([]);
    setCameraErr('');
  }, [stream]);

  /* ── Kap foto ── */
  const capturePhoto = useCallback(async () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;

    const MAX_W = 1280, w = v.videoWidth || 1280, h = v.videoHeight || 720;
    if (w > MAX_W) { c.width = MAX_W; c.height = Math.round(h * (MAX_W / w)); }
    else { c.width = w; c.height = h; }

    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, c.width, c.height);

    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) return;
    if (blob.size > 5 * 1024 * 1024) {
      setCameraErr('Foto > 5MB, provo sërish.');
      return;
    }

    const ts = new Date(), pad = n => String(n).padStart(2, '0');
    const name = `foto-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.jpg`;
    const file = new File([blob], name, { type: 'image/jpeg' });

    // Shto në listën lokale dhe thirr callback-un
    const preview = URL.createObjectURL(blob);
    setCaptured(prev => [...prev, { file, preview, name }]);
    setCameraErr('');
  }, []);

  /* ── Konfirmo dhe mbyll ── */
  const confirmAll = useCallback(() => {
    captured.forEach(({ file }) => onCapture(file));
    closeCamera();
  }, [captured, onCapture, closeCamera]);

  /* ── Fshi preview URL kur mbyllet ── */
  useEffect(() => {
    return () => captured.forEach(({ preview }) => URL.revokeObjectURL(preview));
  }, [captured]);

  /* ── Kliko jashtë modal për mbyllje ── */
  const handleBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) closeCamera();
  }, [closeCamera]);

  return (
    <div className="inline-block">
      {/* Butoni kryesor */}
      <button
        type="button"
        onClick={openCamera}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium
                   border border-slate-300 rounded-lg bg-white hover:bg-slate-50
                   text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors duration-150"
        title="Shkrep foto dokumenti"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        📷 Shkrep Foto
      </button>

      {/* ── MODAL ── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={handleBackdrop}
        >
          <div className="relative w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white">
              <h3 className="font-semibold text-sm">📸 Foto e Dokumentit</h3>
              <button onClick={closeCamera} className="text-gray-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center">&times;</button>
            </div>

            {/* Video */}
            {!cameraErr && (
              <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <p className="absolute bottom-3 left-0 right-0 text-center text-yellow-300 text-xs font-medium pointer-events-none">
                  Vendos dokumentin para kamerës dhe shtype "Shkrepe"
                </p>
              </div>
            )}

            {/* Gabim */}
            {cameraErr && (
              <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">⚠ {cameraErr}</p>
              </div>
            )}

            {/* Canvas i fshehur */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Foto të kapur (thumbnail) */}
            {captured.length > 0 && (
              <div className="px-4 pt-3">
                <p className="text-xs font-medium text-slate-600 mb-2">
                  ✅ {captured.length} foto {captured.length === 1 ? 'e shtuar' : 'të shtuara'}:
                </p>
                <div className="flex gap-2 flex-wrap">
                  {captured.map((c, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={c.preview}
                        alt={c.name}
                        className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                      />
                      <button
                        onClick={() => setCaptured(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Butona aksion */}
            <div className="flex gap-2 p-4">
              {!cameraErr && (
                <button
                  onClick={capturePhoto}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-900 text-white
                             font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  📸 Shkrepe
                </button>
              )}
              {captured.length > 0 && (
                <button
                  onClick={confirmAll}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white
                             font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  ✅ Konfirmo ({captured.length})
                </button>
              )}
              <button
                onClick={closeCamera}
                className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700
                           font-semibold rounded-xl transition-colors"
              >
                Mbyll
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
