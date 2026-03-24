import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const SMTP_PORT   = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? (SMTP_PORT === 465)).toLowerCase() === "true";

export const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  greetingTimeout: 15000,
  connectionTimeout: 15000,
  socketTimeout: 20000,
  tls: { rejectUnauthorized: process.env.NODE_ENV === "production", servername: process.env.SMTP_HOST },
});

transport.verify().then(
  () => console.log("SMTP OK:", { host: process.env.SMTP_HOST, port: SMTP_PORT }),
  (e) => console.warn("SMTP not available:", e?.message || e)
);

export async function sendMail({ to, cc, subject, html, attachments }) {
  const toList = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  const ccList = Array.isArray(cc) ? cc.filter(Boolean) : (cc ? [cc] : []);
  if (!toList.length) { console.warn("sendMail: no recipients, skipping"); return; }
  if (!process.env.SMTP_HOST) { console.warn("sendMail: SMTP_HOST not set, skipping"); return; }
  const info = await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: toList, cc: ccList, subject, html, attachments,
  });
  console.log("MAIL_OK:", info.messageId, "=>", [...toList, ...ccList].join(", "));
  return info;
}

const BASE_COLOR = "#1e3a5f";
const emailWrap = (title, body) => `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif}
.wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.head{background:${BASE_COLOR};padding:28px 32px}
.head h1{color:#fff;margin:0;font-size:20px;font-weight:600}
.head p{color:rgba(255,255,255,.6);margin:4px 0 0;font-size:13px}
.body{padding:28px 32px}
.info{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0}
.info table{width:100%;border-collapse:collapse}
.info td{padding:6px 0;font-size:14px;color:#374151}
.info td:first-child{color:#6b7280;width:40%}
.badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
.badge-pending{background:#fef3c7;color:#92400e}
.badge-approved{background:#d1fae5;color:#065f46}
.badge-rejected{background:#fee2e2;color:#991b1b}
.btn{display:inline-block;background:${BASE_COLOR};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;margin:8px 0}
.foot{padding:16px 32px;border-top:1px solid #f1f5f9;font-size:12px;color:#9ca3af}
</style></head>
<body><div class="wrap">
<div class="head"><h1>Fin Approvals</h1><p>${title}</p></div>
<div class="body">${body}</div>
<div class="foot">Fin Approvals Enterprise &bull; Mesazh automatik</div>
</div></body></html>`;

export function emailNewRequest({ reqRow, totalAmount, requiredRole, photoCount, appUrl }) {
  const subject = `[Fin Approvals] Kërkesë e re #${reqRow.id} — ${reqRow.buyer_name} — €${Number(totalAmount).toFixed(2)}`;
  const roleMap = { team_lead: "Team Lead", division_manager: "Menaxher Divizioni", sales_director: "Drejtor Shitjesh" };
  const html = emailWrap("Kërkesë e re për aprovim",
    `<p style="color:#374151;font-size:15px">Një kërkesë e re pret aprovimin tuaj.</p>
    <div class="info"><table>
      <tr><td>Agjenti</td><td><b>${reqRow.agent_first} ${reqRow.agent_last}</b></td></tr>
      <tr><td>Blerësi</td><td><b>${reqRow.buyer_code} — ${reqRow.buyer_name}</b></td></tr>
      ${reqRow.site_name ? `<tr><td>Objekti</td><td>${reqRow.site_name}</td></tr>` : ""}
      <tr><td>Shuma</td><td><b style="font-size:18px;color:${BASE_COLOR}">€${Number(totalAmount).toFixed(2)}</b></td></tr>
      <tr><td>Nivel aprovimi</td><td><span class="badge badge-pending">${roleMap[requiredRole] || requiredRole}</span></td></tr>
      ${reqRow.reason ? `<tr><td>Arsyeja</td><td>${reqRow.reason}</td></tr>` : ""}
      ${photoCount ? `<tr><td>Foto</td><td>${photoCount} foto bashkëngjitur</td></tr>` : ""}
    </table></div>
    <a href="${appUrl}/approvals" class="btn">Shiko Aprovime →</a>`
  );
  return { subject, html };
}

export function emailApprovalResult({ reqRow, action, approverName, approverRole, comment, appUrl }) {
  const isApproved = action === "approved";
  const subject = `[Fin Approvals] ${isApproved ? "✓ APROVIM" : "✕ REFUZIM"} — #${reqRow.id} — €${Number(reqRow.amount).toFixed(2)}`;
  const roleMap = { team_lead: "Team Lead", division_manager: "Menaxher Divizioni", sales_director: "Drejtor Shitjesh" };
  const html = emailWrap(isApproved ? "Kërkesa u aprovua" : "Kërkesa u refuzua",
    `<p style="color:#374151;font-size:15px">Kërkesa <b>#${reqRow.id}</b> mori vendim.</p>
    <div class="info"><table>
      <tr><td>Statusi</td><td><span class="badge ${isApproved ? "badge-approved" : "badge-rejected"}">${isApproved ? "✓ Aprovuar" : "✕ Refuzuar"}</span></td></tr>
      <tr><td>Blerësi</td><td><b>${reqRow.buyer_code} — ${reqRow.buyer_name}</b></td></tr>
      <tr><td>Shuma</td><td><b>€${Number(reqRow.amount).toFixed(2)}</b></td></tr>
      <tr><td>Vendimi nga</td><td>${approverName} (${roleMap[approverRole] || approverRole})</td></tr>
      ${comment ? `<tr><td>Koment</td><td>${comment}</td></tr>` : ""}
    </table></div>
    <a href="${appUrl}/agent" class="btn">Shiko Kërkesat →</a>`
  );
  return { subject, html };
}

export function emailPasswordReset({ name, resetUrl }) {
  const subject = "[Fin Approvals] Rivendos fjalëkalimin";
  const html = emailWrap("Rivendosje fjalëkalimi",
    `<p style="color:#374151;font-size:15px">Përshëndetje <b>${name}</b>,</p>
    <p style="color:#374151">Kemi marrë kërkesë për rivendosjen e fjalëkalimit të llogarisë suaj.</p>
    <a href="${resetUrl}" class="btn">Rivendos Fjalëkalimin →</a>
    <p style="color:#9ca3af;font-size:13px;margin-top:16px">Ky link skadron pas 1 ore. Nëse nuk keni kërkuar rivendosje, injoroni këtë email.</p>`
  );
  return { subject, html };
}
