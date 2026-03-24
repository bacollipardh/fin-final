#!/usr/bin/env bash
# scripts/setup-mobile.sh
# -----------------------------------------------
# 1. Gjeneron self-signed SSL cert
# 2. Shfaq IP-në lokale
# 3. Gjeneron QR code për telefon
# -----------------------------------------------
# Ekzekuto: bash scripts/setup-mobile.sh

set -e

CERT_DIR="./nginx/certs"
mkdir -p "$CERT_DIR"

echo ""
echo "🔐 Duke gjeneruar SSL cert..."

# Gjej IP-në lokale
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig 2>/dev/null | grep "IPv4" | head -1 | awk '{print $NF}')
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="192.168.1.100"  # fallback
fi

echo "📡 IP lokale: $LOCAL_IP"

# Gjenero cert me IP lokale
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -subj "/CN=fin-approvals/O=Local/C=XK" \
  -addext "subjectAltName=IP:$LOCAL_IP,IP:127.0.0.1,DNS:localhost" \
  2>/dev/null

echo "✅ Cert gjeneruar: $CERT_DIR/"
echo ""

# URL për telefon
MOBILE_URL="https://$LOCAL_IP:18443"
echo "📱 URL për telefon: $MOBILE_URL"
echo ""

# QR code në terminal (kërkon 'qrencode' - opsional)
if command -v qrencode &> /dev/null; then
  echo "📷 QR Code (skano me telefon):"
  qrencode -t ANSI "$MOBILE_URL"
else
  echo "💡 Instalo qrencode për QR: apt-get install qrencode"
  echo "   Ose hap manualisht: $MOBILE_URL"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 HAPAT E RADHËS:"
echo ""
echo "1. Kopjo nginx/default-https.conf → nginx/default.conf"
echo "   cp nginx/default-https.conf nginx/default.conf"
echo ""
echo "2. Shto port 18443 në docker-compose.yml (web service):"
echo "   ports:"
echo "     - \"0.0.0.0:18080:80\""
echo "     - \"0.0.0.0:18443:443\""
echo ""
echo "3. Mount cert-at në docker-compose.yml (web service):"
echo "   volumes:"
echo "     - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro"
echo "     - ./nginx/certs:/etc/nginx/certs:ro"
echo ""
echo "4. Restart:"
echo "   docker-compose restart web"
echo ""
echo "5. Hap Windows Firewall për port 18443:"
echo "   (ekzekuto setup-firewall.ps1 si Administrator)"
echo ""
echo "6. Nga telefoni: $MOBILE_URL"
echo "   ⚠️  Klikoni 'Advanced → Proceed' për self-signed cert"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
