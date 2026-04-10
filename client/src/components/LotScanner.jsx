import { useState, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function LotScanner({ onResult, disabled = false }) {
  const [isOpen, setIsOpen]           = useState(false);
  const [stream, setStream]           = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview]         = useState(null);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState('');

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);

  const openCamera = useCallback(async () => {
    setError(''); setResult(''); setPreview(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(mediaStream);
      setIsOpen(true);
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = mediaStream; videoRef.current.play(); }
      }, 100);
    } catch (err) {
      if (err.name === 'NotAllowedError') setError('Kamera u bllokua. Lejo aksesin ne browser settings.');
      else if (err.name === 'NotFoundError') setError('Kamera nuk u gjet ne kete pajisje.');
      else setError('Gabim: ' + err.message);
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null); }
    setIsOpen(false); setPreview(null); setResult(''); setError('');
  }, [stream]);

  const captureAndProcess = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.95);
    setPreview(imageBase64); setIsProcessing(true); setError('');
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
      const response = await fetch(`${API_BASE}/ocr/lot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ image: imageBase64 }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      if (data.text) setResult(data.text);
      else setError(data.message || 'Nuk u gjet tekst. Provo serish.');
    } catch (err) {
      setError('OCR deshtoi: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const confirmResult = useCallback(() => {
    if (result && onResult) { onResult(result); closeCamera(); }
  }, [result, onResult, closeCamera]);

  const retryCapture = useCallback(() => {
    setPreview(null); setResult(''); setError('');
  }, []);

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={openCamera}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Skano Lot Kodin me kamere"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Skano Lot
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white">
              <h3 className="font-semibold text-sm">🔷 Skano Lot Kodin</h3>
              <button onClick={closeCamera} className="text-gray-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center">&times;</button>
            </div>

            <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
              {!preview ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="border-2 border-yellow-400 rounded-lg w-64 h-20 opacity-70" />
                    <p className="absolute bottom-4 text-yellow-300 text-xs font-medium">
                      Vendos lot kodin brenda kornizes
                    </p>
                  </div>
                </>
              ) : (
                <img src={preview} alt="Captured" className="w-full h-full object-cover" />
              )}
              {isProcessing && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-white text-sm">Duke lexuar tekstin...</p>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {result && (
              <div className="mx-4 mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-600 font-medium mb-1">✅ Teksti i gjetur:</p>
                <p className="text-lg font-bold text-green-800 font-mono tracking-wider">{result}</p>
              </div>
            )}

            {error && (
              <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">⚠️ {error}</p>
              </div>
            )}

            <div className="flex gap-2 p-4">
              {!preview ? (
                <button onClick={captureAndProcess} disabled={isProcessing}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50">
                  📸 Kap Foto
                </button>
              ) : (
                <>
                  <button onClick={retryCapture}
                    className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-xl transition-colors">
                    🔄 Provo Serish
                  </button>
                  {result && (
                    <button onClick={confirmResult}
                      className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors">
                      ✅ Konfirmo
                    </button>
                  )}
                </>
              )}
            </div>

            {error?.includes('bllokua') && (
              <p className="px-4 pb-3 text-xs text-gray-500 text-center">
                💡 Kamera kerkon HTTPS. Qasju me <strong>https://</strong> ose nga localhost.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
