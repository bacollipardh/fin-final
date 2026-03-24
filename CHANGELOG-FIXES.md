# Fin Approvals — Ndryshimet dhe Fiksimet (24 Mars 2026)

## 🔴 BUGS TË FIKSUARA

### 1. DELEGIMET NUK FUNKSIONIN (KRITIK)
**Problemi:** `DelegationTab` thirrte `/admin/users` për listën e kolegëve, por ky endpoint kërkon rolin `admin`. Kjo bënte që dropdown-i i delegimit dilte gjithmonë bosh për team_lead, division_manager, sales_director.

**Zgjidhja:**
- **server.js:** Endpoint i ri `GET /users/approvers` — lejon rolet team_lead, division_manager, sales_director, admin. Kthen listën e aprovuesve sipas divisionit (team_lead/division_manager shohin vetëm divisionin e vet + sales_director, ndërsa sales_director/admin shohin të gjithë).
- **Approvals.jsx:** `DelegationTab` tani thirr `/users/approvers` në vend të `/admin/users`.

### 2. SEARCH ARTIKUJSH — VETËM ME EMËR (KRITIK)
**Problemi:** Agjenti mund të kërkonte artikuj vetëm me emër në PricingBridge. Nuk funksiononte kërkimi me shifër (SKU) apo barkod.

**Zgjidhja:**
- **server.js:** Endpoint i ri `GET /articles/search?term=...` — kërkon në bazën lokale me SKU ILIKE, barkod ILIKE, DHE emër ILIKE njëkohësisht. Prioritet: SKU > barkod > emër. Respekton filtrimet sipas divisioneve për agjentë.
- **Agent.jsx:** Search dual — kërkon NJËKOHËSISHT lokalisht (articles/search) dhe PricingBridge (pb/article), bashkon rezultatet pa dublikata.
- **Agent.jsx:** Barcode handler — barcode scanner kërkon lokal+PB njëkohësisht. Nëse PB nuk gjen, provon lokalisht.
- **Agent.jsx:** Placeholder përditësuar: "Shifër, barkod, ose emër…"

### 3. SQL INJECTION RISK
**Problemi:** Dy vende ku `INTERVAL '${interval}'` përdorej me string interpolation në SQL query.

**Zgjidhja:** Zëvendësuar me `($N::int * INTERVAL '1 day')` duke përdorur parametra. Dy vende: login limit check (line ~460) dhe request creation limit check (line ~1122).

### 4. THRESHOLDS HARDCODED NË FRONTEND
**Problemi:** `roleForAmount()` në Agent.jsx kishte vlera hardcoded `99` dhe `199`. Nëse admini i ndryshonte thresholdet, frontend-i tregonte nivel të gabuar.

**Zgjidhja:** `roleForAmount(total, thresholds)` tani pranon parametrin `thresholds` nga `meta.thresholds` (që vjen nga backend). Fallback: 99/199 nëse meta nuk ka ngarkuar ende.

### 5. GALLERY FOTO URL
**Problemi:** Në Approvals.jsx, kur URL e fotos nuk fillonte me "http", nuk i shtohej API_BASE — foto nuk ngarkohej.

**Zgjidhja:** `API_BASE` shtohet automatikisht kur URL nuk fillon me "http".

---

## 📁 FILES TË NDRYSHUARA

| File | Ndryshime |
|------|-----------|
| `server/server.js` | +endpoint `/users/approvers`, +endpoint `/articles/search`, SQL injection fix ×2 |
| `client/src/pages/Agent.jsx` | Dual search (lokal+PB), barcode handler, thresholds dinamike, placeholder |
| `client/src/pages/Approvals.jsx` | DelegationTab → `/users/approvers`, gallery URL fix |

---

## 🟡 NJOFTUAR POR JO FIKSUAR (për fazën tjetër)

- SSE `res._sse_role` nuk përditësohet nëse roli ndryshon gjatë sesionit
- `@zxing/browser` duhet siguruar që është në package.json
- Duplicate ALTER statements në SQL migration (jo e dëmshme)
- Normalizer middleware pranon "5abc" si 5 (mund të jet confusing)
- Password strength vetëm min 6 chars (pa numra/simbole)

## 💡 VEÇORI TË SUGJERUARA

1. Push notifications (PWA)
2. Bulk approve/reject
3. Dashboard për Team Lead
4. Export PDF batch
5. Lejim automatik sipas rregullave (p.sh. max 30% për blerësin X)
6. Reminder kur delegimi skadon
7. Rate limiting per-user
