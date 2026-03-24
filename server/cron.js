// cron.js — scheduled jobs
import cron from "node-cron";
import { runFullSync } from "./pbSync.js";
import { q } from "./db.js";
import { sendMail } from "./mailer.js";
import dayjs from "dayjs";

const APP_URL = (process.env.APP_URL || "http://localhost:18080").replace(/\/$/, "");

async function runMonthlyReport(period) {
  console.log(`[CRON] Monthly report for ${period}`);
  try {
    // Check if already ran for this period
    const exists = await q("SELECT 1 FROM report_runs WHERE period=$1 AND status='ok'", [period]);
    if (exists.rowCount) { console.log(`[CRON] Report ${period} already ran`); return; }

    const [start, end] = [
      dayjs(period + "-01").startOf("month").format("YYYY-MM-DD"),
      dayjs(period + "-01").endOf("month").format("YYYY-MM-DD"),
    ];

    // Stats
    const totals = await q(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(amount),0)::numeric AS total_val,
        COUNT(*) FILTER (WHERE status='approved')::int AS approved,
        COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COALESCE(SUM(amount) FILTER (WHERE status='approved'),0)::numeric AS approved_val
       FROM requests WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')`,
      [start, end]
    );

    const topAgents = await q(
      `SELECT u.first_name, u.last_name, COUNT(r.id)::int AS cnt, COALESCE(SUM(r.amount),0)::numeric AS val
       FROM requests r JOIN users u ON u.id=r.agent_id
       WHERE r.created_at >= $1::date AND r.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY u.id,u.first_name,u.last_name ORDER BY cnt DESC LIMIT 10`,
      [start, end]
    );

    const topBuyers = await q(
      `SELECT b.code, b.name, COUNT(r.id)::int AS cnt, COALESCE(SUM(r.amount),0)::numeric AS val
       FROM requests r JOIN buyers b ON b.id=r.buyer_id
       WHERE r.created_at >= $1::date AND r.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY b.id,b.code,b.name ORDER BY val DESC LIMIT 10`,
      [start, end]
    );

    const s = totals.rows[0];
    const fmtNum = n => Number(n||0).toFixed(2);
    const fmtPct = (n,t) => t>0 ? `${Math.round((n/t)*100)}%` : "0%";

    const agentRows = topAgents.rows.map(a =>
      `<tr><td style="padding:6px 10px">${a.first_name} ${a.last_name}</td><td style="padding:6px 10px;text-align:center">${a.cnt}</td><td style="padding:6px 10px;text-align:right">€${fmtNum(a.val)}</td></tr>`
    ).join("");

    const buyerRows = topBuyers.rows.map(b =>
      `<tr><td style="padding:6px 10px">${b.code} ${b.name}</td><td style="padding:6px 10px;text-align:center">${b.cnt}</td><td style="padding:6px 10px;text-align:right">€${fmtNum(b.val)}</td></tr>`
    ).join("");

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<div style="max-width:640px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <div style="background:#1e3a5f;padding:28px 32px">
    <h1 style="color:#fff;margin:0;font-size:20px">📊 Raporti Mujor — ${period}</h1>
    <p style="color:rgba(255,255,255,.6);margin:4px 0 0;font-size:13px">Fin Approvals Enterprise</p>
  </div>
  <div style="padding:28px 32px">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#1e3a5f">${s.total}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Gjithsej kërkesa</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#16a34a">${s.approved}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Aprovuar (${fmtPct(s.approved,s.total)})</div>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#dc2626">${s.rejected}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px">Refuzuar (${fmtPct(s.rejected,s.total)})</div>
      </div>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:24px">
      <div style="font-size:13px;color:#1e40af">Vlera totale e aprovimeve</div>
      <div style="font-size:32px;font-weight:700;color:#1e3a5f">€${fmtNum(s.approved_val)}</div>
      <div style="font-size:12px;color:#6b7280">nga €${fmtNum(s.total_val)} gjithsej</div>
    </div>
    <h3 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:8px">🏆 Top 10 Agjentët</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px">Agjenti</th>
        <th style="padding:8px 10px;text-align:center;color:#6b7280;font-size:11px">Kërkesa</th>
        <th style="padding:8px 10px;text-align:right;color:#6b7280;font-size:11px">Vlera</th>
      </tr></thead>
      <tbody>${agentRows}</tbody>
    </table>
    <h3 style="font-size:14px;font-weight:600;color:#374151;margin-bottom:8px">🏪 Top 10 Blerësit</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:11px">Blerësi</th>
        <th style="padding:8px 10px;text-align:center;color:#6b7280;font-size:11px">Kërkesa</th>
        <th style="padding:8px 10px;text-align:right;color:#6b7280;font-size:11px">Vlera</th>
      </tr></thead>
      <tbody>${buyerRows}</tbody>
    </table>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Hap Dashboard →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #f1f5f9;font-size:12px;color:#9ca3af">
    Raporti automatik mujor · Fin Approvals Enterprise
  </div>
</div>
</body></html>`;

    // Send to all division managers and sales directors
    const recipients = await q("SELECT email FROM users WHERE role IN ('division_manager','sales_director') AND email IS NOT NULL");
    const emails = recipients.rows.map(r => r.email).filter(Boolean);

    if (emails.length) {
      await sendMail({
        to: emails,
        subject: `[Fin Approvals] Raporti Mujor — ${period}`,
        html,
      });
    }

    await q("INSERT INTO report_runs(period,status,detail) VALUES($1,'ok',$2)", [
      period, JSON.stringify({ total: s.total, approved: s.approved, emails_sent: emails.length })
    ]);
    console.log(`[CRON] Monthly report ${period} sent to ${emails.length} recipients`);
  } catch (e) {
    console.error("[CRON] Monthly report error:", e.message);
    await q("INSERT INTO report_runs(period,status,detail) VALUES($1,'error',$2)", [period, JSON.stringify({ error: e.message })]).catch(()=>{});
  }
}

export function startCronJobs() {
  // Run on 1st of each month at 07:00
  cron.schedule("0 7 1 * *", () => {
    const period = dayjs().subtract(1, "month").format("YYYY-MM");
    runMonthlyReport(period);
  }, { timezone: "Europe/Tirane" });

  // Clean up expired tokens every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try {
      await q("DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used=TRUE");
      await q("DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked=TRUE");
      await q("UPDATE user_sessions SET revoked=TRUE WHERE last_active < NOW() - INTERVAL '90 days'");
      console.log("[CRON] Token cleanup done");
    } catch (e) { console.error("[CRON] Cleanup error:", e.message); }
  });

  // Warm threshold cache on startup
  import("./approvalLogic.js").then(m => m.getThresholds()).catch(()=>{});

  // PricingBridge sync — çdo 12 orë (ora 06:00 dhe 18:00)
  cron.schedule("0 6,18 * * *", async () => {
    console.log("[CRON] PricingBridge sync starting...");
    try { await runFullSync(); } catch(e) { console.error("[CRON] pbSync error:", e.message); }
  });

  console.log("[CRON] Jobs scheduled");
}

export { runMonthlyReport };
