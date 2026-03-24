# scripts/setup-firewall.ps1
# Ekzekuto si Administrator në PowerShell
# Hap portet për qasje nga telefoni

param(
    [int]$HttpPort  = 18080,
    [int]$HttpsPort = 18443
)

Write-Host "🔥 Duke konfiguruar Windows Firewall..." -ForegroundColor Cyan

# Hiq rregullat e vjetra nëse ekzistojnë
$rules = @("FinApprovals-HTTP", "FinApprovals-HTTPS")
foreach ($rule in $rules) {
    if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
        Remove-NetFirewallRule -DisplayName $rule
        Write-Host "  🗑️  Hoqa rregullin e vjetër: $rule" -ForegroundColor Yellow
    }
}

# Shto rregull për HTTP
New-NetFirewallRule `
    -DisplayName "FinApprovals-HTTP" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $HttpPort `
    -Action Allow `
    -Profile Any `
    | Out-Null
Write-Host "  ✅ Port $HttpPort (HTTP) hapur" -ForegroundColor Green

# Shto rregull për HTTPS
New-NetFirewallRule `
    -DisplayName "FinApprovals-HTTPS" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $HttpsPort `
    -Action Allow `
    -Profile Any `
    | Out-Null
Write-Host "  ✅ Port $HttpsPort (HTTPS) hapur" -ForegroundColor Green

# Gjej IP-në lokale
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | 
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } | 
    Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "📡 IP-ja jote lokale: $localIP" -ForegroundColor White
Write-Host ""
Write-Host "📱 Hyr nga telefoni:" -ForegroundColor White
Write-Host "   HTTP:  http://${localIP}:${HttpPort}" -ForegroundColor Yellow
Write-Host "   HTTPS: https://${localIP}:${HttpsPort}" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Sigurohu që telefoni dhe PC-ja janë në të njëjtin WiFi!" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

# Gjenero QR code si HTML (hapet në browser)
$qrHtml = @"
<!DOCTYPE html>
<html>
<head>
  <title>QR Code - Fin Approvals</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <style>
    body { font-family: sans-serif; display:flex; flex-direction:column; align-items:center; 
           justify-content:center; min-height:100vh; margin:0; background:#f5f5f5; }
    .card { background:white; padding:2rem; border-radius:1rem; box-shadow:0 4px 20px rgba(0,0,0,.1); text-align:center; }
    h2 { margin:0 0 1rem; color:#1e40af; }
    p  { color:#64748b; font-size:.9rem; margin:.5rem 0; }
    a  { color:#2563eb; font-weight:bold; }
    #qr { margin: 1rem auto; }
  </style>
</head>
<body>
  <div class="card">
    <h2>📱 Fin Approvals</h2>
    <p>Skano QR kodin me telefon:</p>
    <div id="qr"></div>
    <p>Ose hyr direkt:</p>
    <p><a href="https://${localIP}:${HttpsPort}">https://${localIP}:${HttpsPort}</a></p>
    <p style="font-size:.75rem; color:#94a3b8; margin-top:1rem;">
      ⚠️ Klikoni "Advanced → Proceed" për self-signed cert
    </p>
  </div>
  <script>
    new QRCode(document.getElementById("qr"), {
      text: "https://${localIP}:${HttpsPort}",
      width: 200, height: 200,
      colorDark: "#1e40af", colorLight: "#ffffff"
    });
  </script>
</body>
</html>
"@

$qrPath = "$PSScriptRoot\mobile-qr.html"
$qrHtml | Out-File -FilePath $qrPath -Encoding UTF8
Start-Process $qrPath

Write-Host "🌐 QR Code i hapur në browser!" -ForegroundColor Green
