(function () {
  const PER = 10;
  const STATUSES = ["pending", "approved", "rejected"];
  const LEADERS = ["team_lead", "division_manager", "sales_director"]; // të tre rolet

  function qs(s, r = document) { return r.querySelector(s); }
  function qsa(s, r = document) { return Array.from(r.querySelectorAll(s)); }
  function fmtAmount(a) { const n = Number(a || 0); return "€" + n.toFixed(2); }

  function buildControls(container) {
    const wrap = document.createElement("div");
    wrap.className = "filters-bar";
    wrap.innerHTML = `
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.5rem 0;">
        <label> Status:
          <select id="hf-status">
            <option value="">— Të gjithë —</option>
            ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </label>
        <label> Lideri:
          <select id="hf-leader">
            <option value="">— Të gjithë —</option>
            ${LEADERS.map(l => `<option value="${l}">${l}</option>`).join("")}
          </select>
        </label>
        <label> Data:
          <input type="date" id="hf-date"/>
        </label>
      </div>
      <div id="hf-pager" style="display:flex;align-items:center;gap:.5rem;margin:.25rem 0;"></div>
    `;
    container.prepend(wrap);
    return {
      status: qs("#hf-status", wrap),
      leader: qs("#hf-leader", wrap),
      date: qs("#hf-date", wrap),
      pager: qs("#hf-pager", wrap),
    };
  }

  async function fetchPage({ status, leader, date, page }) {
    const q = new URLSearchParams({ per: String(PER), page: String(page) });
    if (status) q.set("status", status);
    if (leader) q.set("leader", leader);
    if (date) q.set("date", date);
    const token = localStorage.getItem("token") || "";
    const res = await fetch(`/api/requests/my?${q.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  }

  function renderRows(tbody, rows) {
    tbody.innerHTML = "";
    if (!rows || !rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="8" style="padding:.5rem">S’ka të dhëna.</td>`;
      tbody.appendChild(tr);
      return;
    }
    for (const r of rows) {
      // përmbledhje items
      let itemsText = "-";
      if (Array.isArray(r.items) && r.items.length) {
        itemsText = r.items.map(it => `${it.sku} x${it.quantity}`).join(", ");
      } else if (r.article_summary) {
        itemsText = r.article_summary;
      }

      // numri i fotove
      const photoCount =
        (Array.isArray(r.photos) && r.photos.length) ||
        (Array.isArray(r.photo_urls) && r.photo_urls.length) ||
        r.photo_count || 0;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.id ?? ""}</td>
        <td>${(r.buyer_code || "")} ${r.buyer_name || ""}</td>
        <td>${r.site_name || "-"}</td>
        <td>${itemsText}</td>
        <td>${fmtAmount(r.amount)}</td>
        <td>${r.status ?? ""}</td>
        <td>${r.required_role ?? ""}</td>
        <td>
          <a href="/api/requests/${r.id}/pdf" target="_blank">Shiko PDF</a>
          ${photoCount ? ` · <span title="Foto">${"Foto"} (${photoCount})</span>` : " · —"}
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  function renderPager(pager, page, pages, onGo) {
    pager.innerHTML = "";
    const btnPrev = document.createElement("button");
    btnPrev.textContent = "‹ Mbrapa";
    btnPrev.disabled = page <= 1;
    btnPrev.onclick = () => onGo(page - 1);

    const span = document.createElement("span");
    span.textContent = `Faqja ${page} nga ${pages}`;

    const btnNext = document.createElement("button");
    btnNext.textContent = "Para ›";
    btnNext.disabled = page >= pages;
    btnNext.onclick = () => onGo(page + 1);

    [btnPrev, span, btnNext].forEach(el => {
      el.style.padding = ".25rem .5rem";
      el.style.border = "1px solid #ccc";
      el.style.borderRadius = "4px";
      el.style.background = "#fff";
    });
    pager.append(btnPrev, span, btnNext);
  }

  async function attach() {
    // gjej seksionin me titull "Historiku im"
    const heading = qsa("h1,h2,h3").find(h => /Historiku im/i.test(h.textContent || ""));
    if (!heading) return;
    const container = heading.parentElement;
    const table = container.querySelector("table") || qsa("table", container)[0];
    if (!table) return;

    // nëse mungon thead, krijo
    if (!table.tHead) {
      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th>ID</th><th>Blerësi</th><th>Objekti</th><th>Artikulli/Items</th>
          <th>Shuma</th><th>Status</th><th>Kërkohet nga</th><th>Dokumente</th>
        </tr>`;
      table.prepend(thead);
    }
    const tbody = table.tBodies[0] || table.createTBody();

    const ui = buildControls(container);

    let state = { status: "", leader: "", date: "", page: 1 };
    const reload = async () => {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:.5rem">Duke ngarkuar…</td></tr>`;
      try {
        const data = await fetchPage(state);
        renderRows(tbody, data.rows || []);
        renderPager(ui.pager, data.page || 1, data.pages || 1, (p) => { state.page = p; reload(); });
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:.5rem;color:#b00">Gabim gjatë ngarkimit.</td></tr>`;
      }
    };

    ui.status.onchange = () => { state.status = ui.status.value; state.page = 1; reload(); };
    ui.leader.onchange = () => { state.leader = ui.leader.value; state.page = 1; reload(); };
    ui.date.onchange   = () => { state.date   = ui.date.value;   state.page = 1; reload(); };

    reload();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
})();
