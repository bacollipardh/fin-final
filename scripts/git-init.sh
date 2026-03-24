#!/usr/bin/env bash
# scripts/git-init.sh
# Inicializo Git repo dhe bëje gati për GitHub
# Ekzekuto nga root i projektit: bash scripts/git-init.sh

set -e

echo "🔧 Inicializimi i Git repo..."

# Init nëse nuk ekziston
if [ ! -d ".git" ]; then
  git init
  echo "✅ Git repo inicializuar"
else
  echo "ℹ️  Git repo ekziston tashmë"
fi

# Krijo .gitignore nëse nuk ekziston
if [ ! -f ".gitignore" ]; then
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
**/node_modules/

# Environment - MOS I COMMIT KURRË!
.env
**/.env
!.env.example

# Build outputs
dist/
build/
**/dist/
**/build/

# Docker
.docker/

# Uploads (të dhëna reale)
server/uploads/
uploads/

# Backups
backups/*.sql.gz

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Certs (sensitive)
nginx/certs/

# Temp
*.tmp
*.bak
EOF
  echo "✅ .gitignore krijuar"
fi

# Commit fillestar
git add -A
git commit -m "feat: initial commit - fin-approvals v2.0" 2>/dev/null || \
git commit --allow-empty -m "feat: initial commit - fin-approvals v2.0"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 HAPAT E RADHËS për GitHub:"
echo ""
echo "1. Krijo repo të ri në github.com (PRIVATE)"
echo "   Emri: fin-approvals"
echo ""
echo "2. Lidhe me GitHub:"
echo "   git remote add origin https://github.com/USERNAME/fin-approvals.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "3. Shto GitHub Secrets (Settings → Secrets → Actions):"
echo "   SSH_HOST     → IP e serverit"
echo "   SSH_USER     → user (p.sh. ubuntu)"
echo "   SSH_KEY      → çelësi privat SSH"
echo "   PROJECT_PATH → /path/to/fin-approvals-modified"
echo ""
echo "4. Çdo 'git push origin main' do të deployjë automatikisht!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
