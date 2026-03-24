# Upgrade Guide — V2

## Nga versioni i vjetër te V2

### Hapi 1 — Ekzekuto migration SQL
```powershell
Get-Content server\db\patches\20260320_v2_features.sql | docker compose exec -T db psql -U postgres -d lejimet
```

### Hapi 2 — Rebuild containers
```powershell
docker compose up --build -d
```

### Hapi 3 — Verifiko
```powershell
docker compose logs api --tail=30
```

## Çfarë është shtuar në V2

- ✅ JWT refresh tokens (silent re-login, 30 ditë)
- ✅ Password reset me email
- ✅ Dashboard me statistika + grafik 30-ditë + top agjentë
- ✅ Export CSV
- ✅ Filtrim + paginim në aprovime pending
- ✅ SSE njofime në kohë reale (bell icon)
- ✅ Backup automatik ditor i DB (ora 02:00)
- ✅ Audit log për të gjitha veprimet admin
- ✅ Email template HTML i bukur
- ✅ trust proxy i konfiguruar (rate limit korrekt)
- ✅ DB pool me timeout settings
- ✅ Health check me verifikim DB
- ✅ Photo compression (max 1280px)
- ✅ Logout me revocim refresh token
