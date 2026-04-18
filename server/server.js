// server.js — Fin Approvals Enterprise v3
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import fs from "fs";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { q, pool, getClient } from "./db.js";
import { signJWT, signRefresh, verifyRefresh, compare, hash, requireAuth, requireRole, generateTotpSecret, verifyTotp, totpLib, deviceFingerprint } from "./auth.js";
import { requiredRoleForAmount, requiredRoleForAmountAsync, getThresholds, invalidateThresholdCache } from "./approvalLogic.js";
import { normalizeNumbers } from "./normalize-mw.js";
import { sendMail, emailNewRequest, emailApprovalResult, emailPasswordReset } from "./mailer.js";
import { audit } from "./audit.js";
import { startCronJobs } from "./cron.js";
import { pbSearchArticle, pbLookupPrice } from "./pricingBridge.js";
import { runFullSync, syncArticles, syncBuyers } from "./pbSync.js";

dotenv.config();

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const APP_URL    = (process.env.APP_URL || "http://localhost:18080").replace(/\/$/, "");
const fmtMoney   = (n) => Number(n || 0).toFixed(2);
const MAX_LEN    = { reason:1000, invoice_ref:200, comment:1000, name:300, sku:100, body:2000 };
const trimLen    = (v, key) => { if (!v) return v; const s=String(v).trim(); return MAX_LEN[key] ? s.slice(0,MAX_LEN[key]) : s; };
const cleanId    = (v) => { const n=Number(v); return Number.isFinite(n)&&n>0?n:null; };
const getIp      = (req) => req.ip || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
const hashToken  = (t) => crypto.createHash("sha256").update(t).digest("hex");

async function regclassExists(name) {
  try { const r=await q("SELECT to_regclass($1) as t",[name]); return Boolean(r.rows?.[0]?.t); } catch { return false; }
}

/* ─────────────── APP ─────────────── */
const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'", "data:"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    }
  }
}));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:18080,http://localhost:5173")
  .split(",").map(o=>o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED_ORIGINS.includes("*")) {
      if (process.env.NODE_ENV !== "development") console.warn("[CORS] WARNING: wildcard origin allowed in production!");
      return cb(null, true);
    }
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(normalizeNumbers);
app.use(morgan("combined"));

/* ─── Rate limits ─── */
const loginLimiter = rateLimit({ windowMs:60_000, max:10, message:{error:"Shumë përpjekje. Provo pas 1 minute."} });
const resetLimiter = rateLimit({ windowMs:15*60_000, max:5 });
const apiLimiter   = rateLimit({ windowMs:60_000, max:400 });
app.use(apiLimiter);

/* ─── API prefix ─── */
const API_PREFIX = process.env.API_PREFIX || "/api";
app.use((req,_res,next)=>{
  if(req.url===API_PREFIX) req.url="/";
  else if(req.url.startsWith(API_PREFIX+"/")) req.url=req.url.slice(API_PREFIX.length);
  next();
});

/* ─── IP Whitelist middleware for admin routes ─── */
async function checkIpWhitelist(req, res, next) {
  try {
    const count = await q("SELECT COUNT(*)::int AS c FROM ip_whitelist");
    if (!count.rows[0].c) return next(); // no entries = all allowed
    const ip = getIp(req);
    const r = await q("SELECT 1 FROM ip_whitelist WHERE $1::inet <<= cidr::inet LIMIT 1", [ip]);
    if (r.rowCount) return next();
    return res.status(403).json({ error: "IP not whitelisted" });
  } catch { return next(); }
}

/* ─────────────── UPLOADS ─────────────── */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive:true });
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge:"30d", index:false }));

const storage = multer.diskStorage({
  destination: (_req,_file,cb) => cb(null,UPLOAD_DIR),
  filename:    (_req,file,cb) => { const ext=path.extname(file.originalname).toLowerCase(); cb(null,Date.now()+"-"+Math.random().toString(36).slice(2)+ext); },
});
const upload = multer({ storage, limits:{ fileSize:5*1024*1024 },
  fileFilter:(_req,file,cb)=>{ const ok=/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype); cb(ok?null:new Error("Tipi nuk lejohet"),ok); }
});

/* ─────────────── SSE ─────────────── */
const sseClients = new Map();
function sseAdd(uid,res){if(!sseClients.has(uid))sseClients.set(uid,new Set());sseClients.get(uid).add(res);}
function sseRemove(uid,res){sseClients.get(uid)?.delete(res);}
function sseSend(uid,event,data){const c=sseClients.get(uid);if(!c)return;const m=`event:${event}\ndata:${JSON.stringify(data)}\n\n`;c.forEach(r=>{try{r.write(m)}catch{}});}
function sseBroadcastRole(role,divId,event,data){sseClients.forEach((c)=>c.forEach(r=>{if(r._sse_role===role&&(role==="sales_director"||r._sse_div===divId)){try{r.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`)}catch{}}}))}

const requireSseAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    const queryToken =
        typeof req.query.token === "string" && req.query.token.trim()
            ? req.query.token.trim()
            : null;

    const token = bearerToken || queryToken;

    if (!token) {
        return res.status(401).json({ error: "No token" });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        if (e?.name === "TokenExpiredError") {
            return res.status(401).json({ error: "token_expired" });
        }
        return res.status(401).json({ error: "Invalid token" });
    }
};

app.get("/notifications/stream", requireSseAuth, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res._sse_role = req.user.role;
    res._sse_div = req.user.division_id;

    sseAdd(req.user.id, res);
    res.write("event:connected\ndata:{\"ok\":true}\n\n");

    const ka = setInterval(() => {
        try { res.write(":ping\n\n"); } catch {}
    }, 25000);

    req.on("close", () => {
        clearInterval(ka);
        sseRemove(req.user.id, res);
    });
});
/* ─────────────── HELPERS ─────────────── */
async function resolveTeamLeadAssignee({agentId,divisionId}) {
  // Check active delegation first
  const deleg = await q(
    `SELECT to_user_id FROM approval_delegations
     WHERE from_user_id IN (SELECT id FROM users WHERE division_id=$1 AND role='team_lead')
       AND active=TRUE AND start_date<=CURRENT_DATE AND end_date>=CURRENT_DATE LIMIT 1`,
    [divisionId]
  );
  if (deleg.rowCount) return { assigneeId: deleg.rows[0].to_user_id, reason:"delegation" };

  const a=await q("SELECT team_leader_id FROM users WHERE id=$1",[agentId]);
  const agentTl=a.rows?.[0]?.team_leader_id||null;
  const isValid=async(id)=>{if(!id)return false;const r=await q("SELECT 1 FROM users WHERE id=$1 AND role='team_lead' AND division_id=$2",[id,divisionId]);return!!r.rowCount};
  if(agentTl&&await isValid(agentTl))return{assigneeId:agentTl,reason:"agent.team_leader_id"};
  const d=await q("SELECT default_team_leader_id FROM divisions WHERE id=$1",[divisionId]);
  const divTl=d.rows?.[0]?.default_team_leader_id||null;
  if(divTl&&await isValid(divTl))return{assigneeId:divTl,reason:"division.default_team_leader_id"};
  const tl=await q("SELECT id FROM users WHERE role='team_lead' AND division_id=$1 ORDER BY id LIMIT 1",[divisionId]);
  if(tl.rowCount)return{assigneeId:tl.rows[0].id,reason:"fallback.team_lead"};
  const dm=await q("SELECT id FROM users WHERE role='division_manager' AND division_id=$1 ORDER BY id LIMIT 1",[divisionId]);
  if(dm.rowCount)return{assigneeId:dm.rows[0].id,reason:"fallback.division_manager"};
  return{assigneeId:null,reason:"none"};
}

async function approverEmailsFor(reqRow) {
  // Check if this request is from an avancues user
  const agentUser = await q("SELECT role FROM users WHERE id=$1", [reqRow.agent_id]);
  const isAvancues = agentUser.rows[0]?.role === 'avancues';

  if (isAvancues) {
    // Avancues: notify ALL team leads across ALL divisions + sales director based on threshold
    const emails = new Set();
    if (reqRow.required_role === 'team_lead') {
      // All team leads from all divisions
      const tls = await q("SELECT email FROM users WHERE role='team_lead' AND email IS NOT NULL");
      tls.rows.forEach(x => { if(x.email) emails.add(x.email); });
    } else if (reqRow.required_role === 'division_manager') {
      // All division managers
      const dms = await q("SELECT email FROM users WHERE role='division_manager' AND email IS NOT NULL");
      dms.rows.forEach(x => { if(x.email) emails.add(x.email); });
    }
    // Always include sales director for avancues
    const sds = await q("SELECT email FROM users WHERE role='sales_director' AND email IS NOT NULL");
    sds.rows.forEach(x => { if(x.email) emails.add(x.email); });
    return [...emails];
  }

  // Original agent logic
  if(reqRow.required_role==="team_lead"){
    const id=reqRow.assigned_to_user_id??(await resolveTeamLeadAssignee({agentId:reqRow.agent_id,divisionId:reqRow.division_id})).assigneeId;
    if(!id)return[];
    const r=await q("SELECT email FROM users WHERE id=$1 AND email IS NOT NULL",[id]);
    return r.rows.map(x=>x.email).filter(Boolean);
  }
  if(reqRow.required_role==="division_manager"){
    const r=await q("SELECT email FROM users WHERE role='division_manager' AND division_id=$1 AND email IS NOT NULL",[reqRow.division_id]);
    return r.rows.map(x=>x.email).filter(Boolean);
  }
  const r=await q("SELECT email FROM users WHERE role='sales_director' AND email IS NOT NULL");
  return r.rows.map(x=>x.email).filter(Boolean);
}

async function loadRequestForPdf(reqId) {
  const rq=await q(
    `SELECT r.*,ag.first_name AS agent_first,ag.last_name AS agent_last,ag.email AS agent_email,
       ag.pda_number AS agent_pda,d.name AS division_name,b.code AS buyer_code,b.name AS buyer_name,
       s.site_code,s.site_name,a.sku AS single_sku,a.name AS single_name,a.sell_price AS single_price
     FROM requests r JOIN users ag ON ag.id=r.agent_id LEFT JOIN divisions d ON d.id=r.division_id
     JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id
     LEFT JOIN articles a ON a.id=r.article_id WHERE r.id=$1`,[reqId]);
  if(!rq.rowCount)throw new Error("Request not found");
  const reqRow=rq.rows[0];
  const itemsRes=await q(`SELECT ri.article_id,ri.quantity,ri.line_amount,ri.cmimi_baze,ri.rabat_pct,ri.lejim_pct,ri.ddv_pct,ri.cmimi_pas_rabateve,ri.lot_kod,ri.barkod,a.sku,a.name,a.sell_price FROM request_items ri JOIN articles a ON a.id=ri.article_id WHERE ri.request_id=$1 ORDER BY ri.id`,[reqId]);
  let items=itemsRes.rows;
  if(!items.length&&reqRow.article_id)items=[{article_id:reqRow.article_id,quantity:reqRow.quantity||1,line_amount:reqRow.amount,sku:reqRow.single_sku,name:reqRow.single_name,sell_price:reqRow.single_price}];
  const approvals=await q(`SELECT a.*,u.first_name,u.last_name FROM approvals a JOIN users u ON u.id=a.approver_id WHERE a.request_id=$1 ORDER BY a.acted_at`,[reqId]);
  return{reqRow,items,approvals:approvals.rows};
}

function pdfFromRequestRows({reqRow,items,approvals,watermark}) {
  return new Promise((resolve,reject)=>{
    const PDFDoc=new PDFDocument({size:"A4",margin:0,info:{Title:"Kërkesë për Lejim Financiar",Author:"Fin Approvals"}});
    const chunks=[];PDFDoc.on("data",c=>chunks.push(c));PDFDoc.on("end",()=>resolve(Buffer.concat(chunks)));PDFDoc.on("error",reject);

    const fontReg=process.env.PDF_FONT_REG||process.env.PDF_FONT_REG||"/usr/share/fonts/dejavu/DejaVuSans.ttf";
    const fontBold=process.env.PDF_FONT_BOLD||process.env.PDF_FONT_BOLD||"/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf";
    const hasReg=fs.existsSync(fontReg),hasBold=fs.existsSync(fontBold);
    if(hasReg)PDFDoc.registerFont("R",fontReg);
    if(hasBold)PDFDoc.registerFont("B",fontBold);
    const setR=()=>{try{PDFDoc.font("R")}catch{PDFDoc.font("Helvetica")}};
    const setB=()=>{try{PDFDoc.font("B")}catch{PDFDoc.font("Helvetica-Bold")}};

    const PW=PDFDoc.page.width; // 595
    const ML=30,MR=30;
    const CW=PW-ML-MR; // 535
    const fmtD=d=>{try{return new Date(d).toLocaleString("sq-AL")}catch{return String(d||"")}};
    const fm4=n=>Number(n||0).toFixed(4);
    const fm2=n=>Number(n||0).toFixed(2);
    const cl=s=>(s??'').toString();

    // normalize items
    items=(items||[]).map(it=>{
      const qty=Number(it.quantity||1);
      const base=it.cmimi_baze!=null?Number(it.cmimi_baze):Number(it.sell_price||0);
      const rabat=it.rabat_pct!=null?Number(it.rabat_pct):null;
      const lejim=it.lejim_pct!=null?Number(it.lejim_pct):0;
      const pbPrice=it.cmimi_pas_rabateve!=null?Number(it.cmimi_pas_rabateve):null;
      // Gjithmone rillogaris: cmimi_pb (ose baze) * qty * (1 - lejim/100)
      const priceForCalc=pbPrice!=null?pbPrice:base;
      const line=Number((priceForCalc*qty*(1-lejim/100)).toFixed(2));
      return{...it,qty,base,line,rabat,lejim,pbPrice};
    });

    let Y=0;

    // ── HEADER ──
    PDFDoc.rect(0,0,PW,52).fill("#1e3a5f");
    setB();PDFDoc.fontSize(14).fillColor("#ffffff").text("KËRKESË PËR LEJIM FINANCIAR",0,12,{width:PW,align:"center"});
    setR();PDFDoc.fontSize(8.5).fillColor("rgba(255,255,255,0.72)").text(`#${reqRow.id}  ·  ${fmtD(reqRow.created_at)}  ·  Gjeneruar automatikisht`,0,31,{width:PW,align:"center"});
    Y=62;

    // ── WATERMARK ──
    if(watermark){
      const wt=watermark==="approved"?"APROVUAR":watermark==="rejected"?"REFUZUAR":"";
      if(wt){
        PDFDoc.save();
        PDFDoc.opacity(0.055);
        setB();PDFDoc.fontSize(72).fillColor(watermark==="approved"?"#16a34a":"#dc2626");
        PDFDoc.rotate(-38,{origin:[PW/2,PDFDoc.page.height/2]});
        PDFDoc.text(wt,PW/2-180,PDFDoc.page.height/2-36,{width:360,align:"center"});
        PDFDoc.restore();
      }
    }

    // ── INFO GRID ──
    const IH=80;
    const IW=(CW-10)/2;
    // Left block bg
    PDFDoc.rect(ML,Y,IW,IH).fill("#f7f8fa");
    PDFDoc.rect(ML,Y,2.5,IH).fill("#1e3a5f");
    // Right block bg
    PDFDoc.rect(ML+IW+10,Y,IW,IH).fill("#f7f8fa");
    PDFDoc.rect(ML+IW+10,Y,2.5,IH).fill("#1e3a5f");

    // Left labels
    setB();PDFDoc.fontSize(7).fillColor("#8b9cb3");
    PDFDoc.text("TË DHËNAT E AGJENTIT",ML+8,Y+7);
    setB();PDFDoc.fontSize(9).fillColor("#555");
    const agRows=[
      ["Agjenti:",[`${cl(reqRow.agent_first)} ${cl(reqRow.agent_last)}`.trim()]],
      ["PDA:",[cl(reqRow.agent_pda)||"—"]],
      ["Divizioni:",[cl(reqRow.division_name)||"—"]],
    ];
    agRows.forEach(([k,v],i)=>{
      const ry=Y+18+i*17;
      setB();PDFDoc.fontSize(8.5).fillColor("#374151").text(k,ML+8,ry,{width:52,continued:false});
      setR();PDFDoc.fontSize(8.5).fillColor("#111").text(v[0],ML+62,ry,{width:IW-70});
    });

    // Right labels
    const rx=ML+IW+10;
    setB();PDFDoc.fontSize(7).fillColor("#8b9cb3");
    PDFDoc.text("TË DHËNAT E BLERJES",rx+8,Y+7);
    const buyRows=[
      ["Blerësi:",`${cl(reqRow.buyer_code)} ${cl(reqRow.buyer_name)}`.trim()],
      ["Objekti:",reqRow.site_code?`${cl(reqRow.site_code)} — ${cl(reqRow.site_name)}`:cl(reqRow.site_name)||"—"],
      ["Nr. faturës:",cl(reqRow.invoice_ref)||"—"],
      ["Arsyeja:",cl(reqRow.reason)||"—"],
    ];
    buyRows.forEach(([k,v],i)=>{
      const ry=Y+18+i*15;
      setB();PDFDoc.fontSize(8.5).fillColor("#374151").text(k,rx+8,ry,{width:54,continued:false});
      setR();PDFDoc.fontSize(8.5).fillColor("#111").text(v,rx+64,ry,{width:IW-72,ellipsis:true});
    });

    Y+=IH+12;

    // ── SECTION TITLE ──
    setB();PDFDoc.fontSize(7).fillColor("#8b9cb3").text("ARTIKUJT",ML,Y);
    PDFDoc.moveTo(ML+48,Y+4).lineTo(ML+CW,Y+4).lineWidth(0.5).strokeColor("#e2e8f0").stroke();
    Y+=12;

    // ── TABLE ──
    // col widths must sum to CW=535
    // SKU(54) Art(150) Base(54) Qty(26) Rabat%(46) PB(52) Lejim%(46) DDV%(36) Final(58) + 8 for padding ≈ 535
    const TH=["SKU","Artikulli","Çmimi bazë","Qty","Rabat %","Çmimi PB","Lejim %","Çm. Final","Final €"];
    const TW=[60,140,50,24,44,50,44,50,54];  // shto kolonen Çm.Final
    const TA=["L","L","R","C","R","R","R","R","R"];
    const TSUM=TW.reduce((a,b)=>a+b,0); // 520
    const ROW_H=32;
    const HDR_H=18;

    // header
    PDFDoc.rect(ML,Y,TSUM,HDR_H).fill("#1e3a5f");
    let hx=ML;
    setB();PDFDoc.fontSize(8).fillColor("#ffffff");
    TH.forEach((h,i)=>{
      const align=TA[i]==="R"?"right":TA[i]==="C"?"center":"left";
      PDFDoc.text(h,hx+3,Y+5,{width:TW[i]-6,align});
      hx+=TW[i];
    });
    Y+=HDR_H;

    // rows
    let total=0;
    items.forEach((it,idx)=>{
      const bg=idx%2===0?"#ffffff":"#f8f9fb";
      PDFDoc.rect(ML,Y,TSUM,ROW_H).fill(bg);
      // borders
      let bx=ML;
      TW.forEach(w=>{PDFDoc.rect(bx,Y,w,ROW_H).stroke("#e5e7eb");bx+=w;});

      const rowY=Y;
      const mid=rowY+Math.round(ROW_H/2)-5;
      let cx=ML;

      setB();PDFDoc.fontSize(8.5).fillColor("#1e3a5f");
      PDFDoc.y=rowY+4; PDFDoc.text(cl(it.sku),cx+3,rowY+4,{width:TW[0]-6,lineBreak:false,ellipsis:true});
      if(it.barkod){setR();PDFDoc.fontSize(6.5).fillColor("#aaa");PDFDoc.y=rowY+18;PDFDoc.text(cl(it.barkod),cx+3,rowY+18,{width:TW[0]-6,lineBreak:false,ellipsis:true});}
      cx+=TW[0];

      setR();PDFDoc.fontSize(8.5).fillColor("#1a1a1a");
      PDFDoc.y=rowY+4; PDFDoc.text(cl(it.article_name||it.name),cx+3,rowY+4,{width:TW[1]-6,lineBreak:false,ellipsis:true});
      if(it.lot_kod){PDFDoc.fontSize(7.5).fillColor("#1d4ed8");PDFDoc.y=rowY+18;PDFDoc.text("Lot: "+cl(it.lot_kod),cx+3,rowY+18,{width:TW[1]-6,lineBreak:false,ellipsis:true});}
      cx+=TW[1];

      setR();PDFDoc.fontSize(8.5).fillColor("#111");
      PDFDoc.y=mid;PDFDoc.text(fm4(it.base),cx+3,mid,{width:TW[2]-6,align:"right",lineBreak:false});cx+=TW[2];
      PDFDoc.y=mid;PDFDoc.text(String(it.qty),cx+3,mid,{width:TW[3]-6,align:"center",lineBreak:false});cx+=TW[3];
      if(it.rabat!=null){PDFDoc.fillColor("#dc2626");PDFDoc.y=mid;PDFDoc.text(`${it.rabat.toFixed(2)}%`,cx+3,mid,{width:TW[4]-6,align:"right",lineBreak:false});}
      else{PDFDoc.fillColor("#aaa");PDFDoc.y=mid;PDFDoc.text("—",cx+3,mid,{width:TW[4]-6,align:"right",lineBreak:false});}
      cx+=TW[4];
      setB();PDFDoc.fillColor("#1e3a5f");PDFDoc.y=mid;PDFDoc.text(it.pbPrice!=null?fm4(it.pbPrice):"—",cx+3,mid,{width:TW[5]-6,align:"right",lineBreak:false});cx+=TW[5];
      PDFDoc.fillColor("#7c3aed");PDFDoc.y=mid;PDFDoc.text(`${it.lejim.toFixed(2)}%`,cx+3,mid,{width:TW[6]-6,align:"right",lineBreak:false});cx+=TW[6];
      // Çmimi Final per njësi = pbPrice * (1 - lejim/100)
      const finalUnit=it.pbPrice!=null?Number((it.pbPrice*(1-it.lejim/100)).toFixed(4)):Number((it.base*(1-it.lejim/100)).toFixed(4));
      setB();PDFDoc.fillColor("#16a34a");PDFDoc.y=mid;PDFDoc.text(fm4(finalUnit),cx+3,mid,{width:TW[7]-6,align:"right",lineBreak:false});cx+=TW[7];
      PDFDoc.fillColor("#111");PDFDoc.y=mid;PDFDoc.text(fm2(it.line),cx+3,mid,{width:TW[8]-6,align:"right",lineBreak:false});

      total+=Number(it.line||0);
      Y=rowY+ROW_H;
      PDFDoc.y=Y;
    });

    // Total row
    PDFDoc.rect(ML,Y,TSUM,20).fill("#1e3a5f");
    setB();PDFDoc.fontSize(9.5).fillColor("#ffffff");
    PDFDoc.text("TOTALI:",ML+3,Y+5,{width:TSUM-TW[8]-6,align:"right"});
    PDFDoc.text(`€ ${fm2(total)}`,ML+TSUM-TW[8]+3,Y+5,{width:TW[8]-6,align:"right"});
    Y+=28;

    // ── STATUS + APPROVAL ──
    const BH=62;
    const BW=(CW-10)/2;

    // Status
    const st=(reqRow.status||"").toLowerCase();
    const isApp=st==="approved",isRej=st==="rejected";
    const sbg=isApp?"#f0fdf4":isRej?"#fef2f2":"#f8f9fa";
    const slc=isApp?"#16a34a":isRej?"#dc2626":"#374151";
    const slabel=isApp?"E aprovuar":isRej?"E refuzuar":"Në pritje";
    PDFDoc.rect(ML,Y,BW,BH).fill(sbg);
    PDFDoc.rect(ML,Y,2.5,BH).fill(slc);
    setB();PDFDoc.fontSize(7).fillColor("#8b9cb3").text("STATUSI",ML+8,Y+8);
    setB();PDFDoc.fontSize(13).fillColor(slc).text(slabel,ML+8,Y+20);
    setR();PDFDoc.fontSize(8).fillColor("#8b9cb3").text(`Niveli: ${cl(reqRow.required_role)||"—"}`,ML+8,Y+42);

    // Approval
    const ax=ML+BW+10;
    PDFDoc.rect(ax,Y,BW,BH).fill("#f7f8fa");
    PDFDoc.rect(ax,Y,2.5,BH).fill("#1e3a5f");
    setB();PDFDoc.fontSize(7).fillColor("#8b9cb3").text("APROVIMI",ax+8,Y+8);
    const last=Array.isArray(approvals)&&approvals.length?approvals[approvals.length-1]:null;
    if(last){
      setR();PDFDoc.fontSize(8.5).fillColor("#111");
      PDFDoc.text(`Data: ${fmtD(last.acted_at)}`,ax+8,Y+20,{width:BW-16});
      PDFDoc.text(`Nga: ${cl(last.first_name)} ${cl(last.last_name)} (${cl(last.approver_role)})`,ax+8,Y+33,{width:BW-16,ellipsis:true});
      PDFDoc.text(`Koment: ${cl(last.comment)||"—"}`,ax+8,Y+46,{width:BW-16,ellipsis:true});
    }else{
      setR();PDFDoc.fontSize(8.5).fillColor("#aaa").text("S'ka aprovim ende.",ax+8,Y+30,{width:BW-16});
    }
    Y+=BH+20;

    // ── FOOTER ──
    const FY=PDFDoc.page.height-28;
    PDFDoc.rect(0,FY,PW,28).fill("#f1f5f9");
    setR();PDFDoc.fontSize(7.5).fillColor("#94a3b8");
    PDFDoc.text("Fin Approvals · Dokument konfidencial",ML,FY+10,{width:CW/2});
    PDFDoc.text(`Gjeneruar: ${fmtD(new Date())} · Faqe 1/1`,ML+CW/2,FY+10,{width:CW/2,align:"right"});

    PDFDoc.end();
  });
}


// ── Load return data for PDF ───────────────────────────────────
async function loadReturnForPdf(returnId) {
  const rr = await q(`
    SELECT rr.id, rr.status, rr.required_role, rr.total_value, rr.comment, rr.reason, rr.created_at,
           rr.financial_approval_id,
           b.code AS buyer_code, b.name AS buyer_name,
           s.site_code, s.site_name,
           ag.first_name AS agent_first, ag.last_name AS agent_last,
           ag.pda_number AS agent_pda,
           d.name AS division_name
    FROM return_requests rr
    JOIN buyers b ON b.id = rr.buyer_id
    LEFT JOIN buyer_sites s ON s.id = rr.site_id
    JOIN users ag ON ag.id = rr.agent_id
    LEFT JOIN divisions d ON d.id = rr.division_id
    WHERE rr.id = $1
  `, [returnId]);
  if (!rr.rowCount) throw new Error("Return not found");
  const retRow = rr.rows[0];

  const lines = await q(`
    SELECT rl.sku, rl.name, rl.lot_kod, rl.final_price,
           rl.approved_qty, rl.already_returned_qty, rl.remaining_qty,
           rl.requested_return_qty, rl.is_removed
    FROM return_request_lines rl
    WHERE rl.return_request_id = $1 AND rl.is_removed = FALSE
    ORDER BY rl.id
  `, [returnId]);

  const approvals = await q(`
    SELECT ra.*, u.first_name, u.last_name
    FROM return_approvals ra
    JOIN users u ON u.id = ra.approver_id
    WHERE ra.return_id = $1
    ORDER BY ra.acted_at
  `, [returnId]);

  return { retRow, lines: lines.rows, approvals: approvals.rows };
}

// ── Generate PDF for Kthim pa Afat ───────────────────────────
function pdfFromReturnRows({ retRow, lines, approvals, watermark }) {
  return new Promise((resolve, reject) => {
    const PDFDoc = new PDFDocument({ size:"A4", margin:0, info:{ Title:"Kërkesë për Kthim pa Afat", Author:"Fin Approvals" } });
    const chunks = []; PDFDoc.on("data", c=>chunks.push(c)); PDFDoc.on("end", ()=>resolve(Buffer.concat(chunks))); PDFDoc.on("error", reject);

    const fontReg  = process.env.PDF_FONT_REG  || "/usr/share/fonts/dejavu/DejaVuSans.ttf";
    const fontBold = process.env.PDF_FONT_BOLD || "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf";
    const hasReg = fs.existsSync(fontReg), hasBold = fs.existsSync(fontBold);
    if (hasReg)  PDFDoc.registerFont("R", fontReg);
    if (hasBold) PDFDoc.registerFont("B", fontBold);
    const setR = () => { try { PDFDoc.font("R"); } catch { PDFDoc.font("Helvetica"); } };
    const setB = () => { try { PDFDoc.font("B"); } catch { PDFDoc.font("Helvetica-Bold"); } };

    const PW = PDFDoc.page.width;
    const ML = 30, MR = 30, CW = PW - ML - MR;
    const fmtD = d => { try { return new Date(d).toLocaleString("sq-AL"); } catch { return String(d||""); } };
    const fm2  = n => Number(n||0).toFixed(2);
    const cl   = s => (s??'').toString();

    let Y = 0;

    // ── HEADER ──
    PDFDoc.rect(0, 0, PW, 52).fill("#1e3a5f");
    setB(); PDFDoc.fontSize(14).fillColor("#ffffff").text("KËRKESË PËR KTHIM PA AFAT", 0, 12, { width:PW, align:"center" });
    setR(); PDFDoc.fontSize(8.5).fillColor("rgba(255,255,255,0.72)")
      .text(`#${retRow.id}  ·  Aprovim Financiar #${retRow.financial_approval_id}  ·  ${fmtD(retRow.created_at)}  ·  Gjeneruar automatikisht`, 0, 31, { width:PW, align:"center" });
    Y = 62;

    // ── WATERMARK ──
    if (watermark) {
      const wt = watermark==="approved" ? "APROVUAR" : watermark==="rejected" ? "REFUZUAR" : "";
      if (wt) {
        PDFDoc.save();
        PDFDoc.opacity(0.055);
        setB(); PDFDoc.fontSize(72).fillColor(watermark==="approved" ? "#16a34a" : "#dc2626");
        PDFDoc.rotate(-38, { origin:[PW/2, PDFDoc.page.height/2] });
        PDFDoc.text(wt, PW/2-180, PDFDoc.page.height/2-36, { width:360, align:"center" });
        PDFDoc.restore();
      }
    }

    // ── INFO GRID ──
    const IH = 80, IW = (CW-10)/2;
    PDFDoc.rect(ML, Y, IW, IH).fill("#f7f8fa");
    PDFDoc.rect(ML, Y, 2.5, IH).fill("#1e3a5f");
    PDFDoc.rect(ML+IW+10, Y, IW, IH).fill("#f7f8fa");
    PDFDoc.rect(ML+IW+10, Y, 2.5, IH).fill("#1e3a5f");

    setB(); PDFDoc.fontSize(7).fillColor("#8b9cb3").text("TË DHËNAT E AGJENTIT", ML+8, Y+7);
    const agRows = [
      ["Agjenti:", `${cl(retRow.agent_first)} ${cl(retRow.agent_last)}`.trim()],
      ["PDA:",     cl(retRow.agent_pda)||"—"],
      ["Divizioni:", cl(retRow.division_name)||"—"],
    ];
    agRows.forEach(([k, v], i) => {
      const ry = Y+18+i*17;
      setB(); PDFDoc.fontSize(8.5).fillColor("#374151").text(k, ML+8, ry, { width:52, continued:false });
      setR(); PDFDoc.fontSize(8.5).fillColor("#111").text(v, ML+62, ry, { width:IW-70 });
    });

    const rx = ML+IW+10;
    setB(); PDFDoc.fontSize(7).fillColor("#8b9cb3").text("TË DHËNAT E BLERJES", rx+8, Y+7);
    const buyRows = [
      ["Blerësi:",   `${cl(retRow.buyer_code)} ${cl(retRow.buyer_name)}`.trim()],
      ["Objekti:",   retRow.site_name||"—"],
      ["Arsyeja:",   cl(retRow.reason)||"—"],
      ["Aprov. Fin:", `#${retRow.financial_approval_id}`],
    ];
    buyRows.forEach(([k, v], i) => {
      const ry = Y+18+i*15;
      setB(); PDFDoc.fontSize(8.5).fillColor("#374151").text(k, rx+8, ry, { width:58, continued:false });
      setR(); PDFDoc.fontSize(8.5).fillColor("#111").text(v, rx+68, ry, { width:IW-76, ellipsis:true });
    });
    Y += IH+12;

    // ── SECTION TITLE ──
    setB(); PDFDoc.fontSize(7).fillColor("#8b9cb3").text("LINJAT E KTHIMIT", ML, Y);
    PDFDoc.moveTo(ML+72, Y+4).lineTo(ML+CW, Y+4).lineWidth(0.5).strokeColor("#e2e8f0").stroke();
    Y += 12;

    // ── TABLE ──
    // Cols: SKU(60) | Artikull(148) | Lot Kodi(60) | Çmimi Final(58) | Sasia Aprov.(52) | Kthim Kërkuar(58) | Vlera(54) = 490 + padding
    const TH = ["SKU", "Artikulli", "Lot Kodi", "Çm. Final", "Sasia Aprov.", "Sasia Kthimit", "Vlera €"];
    const TW = [58, 148, 60, 56, 54, 62, 52];
    const TA = ["L", "L", "C", "R", "C", "C", "R"];
    const TSUM = TW.reduce((a,b)=>a+b, 0);
    const ROW_H = 30, HDR_H = 18;

    // header
    PDFDoc.rect(ML, Y, TSUM, HDR_H).fill("#1e3a5f");
    let hx = ML;
    setB(); PDFDoc.fontSize(7.5).fillColor("#ffffff");
    TH.forEach((h, i) => {
      const align = TA[i]==="R" ? "right" : TA[i]==="C" ? "center" : "left";
      PDFDoc.text(h, hx+3, Y+5, { width:TW[i]-6, align });
      hx += TW[i];
    });
    Y += HDR_H;

    // rows
    let total = 0;
    lines.forEach((line, idx) => {
      const bg = idx%2===0 ? "#ffffff" : "#f8f9fb";
      PDFDoc.rect(ML, Y, TSUM, ROW_H).fill(bg);
      let bx = ML;
      TW.forEach(w => { PDFDoc.rect(bx, Y, w, ROW_H).stroke("#e5e7eb"); bx += w; });

      const mid = Y + Math.round(ROW_H/2) - 5;
      let cx = ML;
      const lineValue = Number(line.final_price||0) * Number(line.requested_return_qty||0);
      total += lineValue;

      // SKU
      setB(); PDFDoc.fontSize(8.5).fillColor("#1e3a5f");
      PDFDoc.text(cl(line.sku), cx+3, Y+4, { width:TW[0]-6, lineBreak:false, ellipsis:true });
      cx += TW[0];

      // Artikull
      setR(); PDFDoc.fontSize(8.5).fillColor("#1a1a1a");
      PDFDoc.text(cl(line.name), cx+3, Y+4, { width:TW[1]-6, lineBreak:false, ellipsis:true });
      cx += TW[1];

      // Lot Kodi
      setR(); PDFDoc.fontSize(8).fillColor("#1d4ed8");
      PDFDoc.text(cl(line.lot_kod)||"—", cx+3, mid, { width:TW[2]-6, align:"center", lineBreak:false });
      cx += TW[2];

      // Çmimi Final
      setB(); PDFDoc.fontSize(8.5).fillColor("#16a34a");
      PDFDoc.text(`€${fm2(line.final_price)}`, cx+3, mid, { width:TW[3]-6, align:"right", lineBreak:false });
      cx += TW[3];

      // Sasia Aprovuar
      setR(); PDFDoc.fontSize(8.5).fillColor("#374151");
      PDFDoc.text(String(line.approved_qty||0), cx+3, mid, { width:TW[4]-6, align:"center", lineBreak:false });
      cx += TW[4];

      // Sasia Kthimit (kryesorja)
      setB(); PDFDoc.fontSize(10).fillColor("#1e3a5f");
      PDFDoc.text(String(line.requested_return_qty||0), cx+3, mid, { width:TW[5]-6, align:"center", lineBreak:false });
      cx += TW[5];

      // Vlera
      setB(); PDFDoc.fontSize(8.5).fillColor("#111");
      PDFDoc.text(`€${fm2(lineValue)}`, cx+3, mid, { width:TW[6]-6, align:"right", lineBreak:false });

      Y += ROW_H;
      PDFDoc.y = Y;
    });

    // Total row
    PDFDoc.rect(ML, Y, TSUM, 20).fill("#1e3a5f");
    setB(); PDFDoc.fontSize(9.5).fillColor("#ffffff");
    PDFDoc.text("TOTALI:", ML+3, Y+5, { width:TSUM-TW[6]-6, align:"right" });
    PDFDoc.text(`€ ${fm2(total)}`, ML+TSUM-TW[6]+3, Y+5, { width:TW[6]-6, align:"right" });
    Y += 28;

    // ── STATUS + APPROVAL ──
    const BH = 62, BW = (CW-10)/2;
    const st = (retRow.status||"").toLowerCase();
    const isApp = st==="approved", isRej = st==="rejected";
    const sbg   = isApp ? "#f0fdf4" : isRej ? "#fef2f2" : "#f8f9fa";
    const slc   = isApp ? "#16a34a" : isRej ? "#dc2626" : "#374151";
    const slabel= isApp ? "E aprovuar" : isRej ? "E refuzuar" : "Në pritje";
    PDFDoc.rect(ML, Y, BW, BH).fill(sbg);
    PDFDoc.rect(ML, Y, 2.5, BH).fill(slc);
    setB(); PDFDoc.fontSize(7).fillColor("#8b9cb3").text("STATUSI", ML+8, Y+8);
    setB(); PDFDoc.fontSize(13).fillColor(slc).text(slabel, ML+8, Y+20);
    setR(); PDFDoc.fontSize(8).fillColor("#8b9cb3").text(`Niveli: ${cl(retRow.required_role)||"—"}`, ML+8, Y+42);

    const ax = ML+BW+10;
    PDFDoc.rect(ax, Y, BW, BH).fill("#f7f8fa");
    PDFDoc.rect(ax, Y, 2.5, BH).fill("#1e3a5f");
    setB(); PDFDoc.fontSize(7).fillColor("#8b9cb3").text("APROVIMI", ax+8, Y+8);
    const last = Array.isArray(approvals) && approvals.length ? approvals[approvals.length-1] : null;
    if (last) {
      setR(); PDFDoc.fontSize(8.5).fillColor("#111");
      PDFDoc.text(`Data: ${fmtD(last.acted_at)}`, ax+8, Y+20, { width:BW-16 });
      PDFDoc.text(`Nga: ${cl(last.first_name)} ${cl(last.last_name)} (${cl(last.approver_role)})`, ax+8, Y+33, { width:BW-16, ellipsis:true });
      PDFDoc.text(`Koment: ${cl(last.comment)||"—"}`, ax+8, Y+46, { width:BW-16, ellipsis:true });
    } else {
      setR(); PDFDoc.fontSize(8.5).fillColor("#aaa").text("S'ka aprovim ende.", ax+8, Y+30, { width:BW-16 });
    }
    Y += BH+20;

    // ── FOOTER ──
    const FY = PDFDoc.page.height-28;
    PDFDoc.rect(0, FY, PW, 28).fill("#f1f5f9");
    setR(); PDFDoc.fontSize(7.5).fillColor("#94a3b8");
    PDFDoc.text("Fin Approvals · Kthim pa Afat · Dokument konfidencial", ML, FY+10, { width:CW/2 });
    PDFDoc.text(`Gjeneruar: ${fmtD(new Date())} · Faqe 1/1`, ML+CW/2, FY+10, { width:CW/2, align:"right" });

    PDFDoc.end();
  });
}

// ── GET /returns/:id/pdf ───────────────────────────────────────
app.get("/returns/:id/pdf", requireAuth, async(req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error:"id invalid" });
    const { retRow, lines, approvals } = await loadReturnForPdf(id);
    // Auth: agent who owns it, or approver in same division, or admin
    const u = req.user;
    if (u.role === "agent" || u.role === "avancues") {
      if (retRow.agent_id !== u.id) return res.status(403).json({ error:"forbidden" });
    }
    const watermark = (retRow.status==="approved"||retRow.status==="rejected") ? retRow.status : null;
    const pdf = await pdfFromReturnRows({ retRow, lines, approvals, watermark });
    res.setHeader("Content-Type", "application/pdf");
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename=kthim-${id}.pdf`);
    return res.send(pdf);
  } catch(e) {
    console.error("[RETURN PDF ERROR]", e?.message);
    return res.status(500).json({ error:"pdf_error", detail:e?.message });
  }
});

/* ─────────────── HEALTH ─────────────── */
app.get("/",(_, res)=>res.send("OK"));
app.get("/health",async(_,res)=>{try{await q("SELECT 1");res.json({ok:true,db:"ok",time:new Date().toISOString()})}catch(e){res.status(503).json({ok:false,db:"down"})}});

/* ─────────────── AUTH ─────────────── */
app.post("/auth/login", loginLimiter, async(req,res)=>{
  try {
    const{email,password}=req.body??{};
    if(!email||!password)return res.status(400).json({error:"Email dhe fjalëkalimi janë të detyrueshme"});
    const r=await q("SELECT * FROM users WHERE email=$1",[email]);
    if(!r.rowCount)return res.status(401).json({error:"Kredenciale të gabuara"});
    const u=r.rows[0];
    if(!u.password_hash||!(await compare(password,u.password_hash)))return res.status(401).json({error:"Kredenciale të gabuara"});

    // Check agent limit warning
    let limitWarning = null;
    if (u.role === "agent" || u.role === "avancues") {
      try {
        const limits = await q("SELECT period,max_amount FROM agent_limits WHERE user_id=$1",[u.id]);
        for (const lim of limits.rows) {
          const intervalDays = lim.period === "monthly" ? 30 : 7;
          const spent = await q(
            `SELECT COALESCE(SUM(amount),0)::numeric AS s FROM requests WHERE agent_id=$1 AND created_at >= NOW() - ($2::int * INTERVAL '1 day')`,
            [u.id, intervalDays]
          );
          const pct = Number(spent.rows[0].s) / Number(lim.max_amount);
          if (pct >= 0.8) limitWarning = { period: lim.period, used: Number(spent.rows[0].s), max: Number(lim.max_amount), pct: Math.round(pct*100) };
        }
      } catch {}
    }

    // 2FA check
    if(u.totp_enabled&&u.totp_verified){
      const tempToken = crypto.randomBytes(16).toString("hex");
      await q("INSERT INTO refresh_tokens(user_id,token,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[u.id,"2fa:"+tempToken]);
      return res.json({requires_2fa:true,temp_token:tempToken});
    }

    // Session tracking + suspicious login
    const fp = deviceFingerprint(req);
    const ip = getIp(req);
    const known = await q("SELECT 1 FROM known_devices WHERE user_id=$1 AND fingerprint=$2",[u.id,fp]);
    if(!known.rowCount) {
      await q("INSERT INTO known_devices(user_id,fingerprint,ip,label,first_seen,last_seen) VALUES($1,$2,$3,'Auto-detected',NOW(),NOW()) ON CONFLICT(user_id,fingerprint) DO UPDATE SET last_seen=NOW(),ip=$3",[u.id,fp,ip]);
      if(u.email) {
        sendMail({
          to:u.email,
          subject:"[Fin Approvals] Hyrje e re e dyshimtë",
          html:`<p>U identifikua hyrje nga pajisje/IP e re:<br><b>IP:</b> ${ip}<br><b>Browser:</b> ${req.headers["user-agent"]||"i panjohur"}<br><b>Koha:</b> ${new Date().toLocaleString()}</p><p>Nëse nuk jeni ju, ndryshoni fjalëkalimin menjëherë.</p>`
        }).catch(()=>{});
      }
    } else {
      await q("UPDATE known_devices SET last_seen=NOW(),ip=$2 WHERE user_id=$1 AND fingerprint=$3",[u.id,ip,fp]);
    }

    try{await q("UPDATE users SET last_login=NOW() WHERE id=$1",[u.id])}catch{}

    const accessToken  = signJWT(u);
    const refreshToken = signRefresh(u.id);
    const exp = new Date(Date.now()+30*24*60*60*1000);
    try{await q("INSERT INTO refresh_tokens(user_id,token,expires_at) VALUES($1,$2,$3)",[u.id,refreshToken,exp])}catch{}

    // Track session
    try{
      const uaStr=(req.headers["user-agent"]||"").slice(0,200);
      const devLabel=uaStr.includes("Mobile")?"Telefon":uaStr.includes("Tablet")?"Tablet":"Desktop/Web";
      await q("INSERT INTO user_sessions(user_id,token_hash,device_name,ip,user_agent) VALUES($1,$2,$3,$4,$5)",[u.id,hashToken(accessToken),devLabel,ip,uaStr.slice(0,300)]);
    }catch{}

    res.json({
      token:accessToken, refresh_token:refreshToken,
      profile:{id:u.id,first_name:u.first_name,last_name:u.last_name,role:u.role,division_id:u.division_id,pda_number:u.pda_number,email:u.email},
      limit_warning:limitWarning,
    });
  }catch(e){console.error("LOGIN_ERR:",e);res.status(500).json({error:"Gabim serveri"});}
});

app.post("/auth/2fa/verify", async(req,res)=>{
  try {
    const{temp_token,totp_code}=req.body??{};
    if(!temp_token||!totp_code)return res.status(400).json({error:"Parametra mungojnë"});
    const stored=await q("SELECT * FROM refresh_tokens WHERE token=$1 AND revoked=FALSE AND expires_at>NOW()",["2fa:"+temp_token]);
    if(!stored.rowCount)return res.status(401).json({error:"Token i pavlefshëm"});
    const userId=stored.rows[0].user_id;
    await q("UPDATE refresh_tokens SET revoked=TRUE WHERE token=$1",["2fa:"+temp_token]);
    const u=await q("SELECT * FROM users WHERE id=$1",[userId]);
    if(!u.rowCount)return res.status(401).json({error:"Përdoruesi nuk u gjet"});
    const user=u.rows[0];
    if(!verifyTotp(totp_code,user.totp_secret))return res.status(401).json({error:"Kodi TOTP është i gabuar"});
    try{await q("UPDATE users SET last_login=NOW() WHERE id=$1",[userId])}catch{}
    const accessToken=signJWT(user);
    const refreshToken=signRefresh(user.id);
    await q("INSERT INTO refresh_tokens(user_id,token,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",[userId,refreshToken]);
    res.json({token:accessToken,refresh_token:refreshToken,profile:{id:user.id,first_name:user.first_name,last_name:user.last_name,role:user.role,division_id:user.division_id,pda_number:user.pda_number,email:user.email}});
  }catch(e){res.status(500).json({error:"server"});}
});

app.post("/auth/2fa/setup", requireAuth, async(req,res)=>{
  try {
    const secret=generateTotpSecret();
    await q("UPDATE users SET totp_secret=$1,totp_enabled=FALSE,totp_verified=FALSE WHERE id=$2",[secret,req.user.id]);
    const user=await q("SELECT email,first_name FROM users WHERE id=$1",[req.user.id]);
    const label=`FinApprovals:${user.rows[0]?.email||req.user.id}`;
    const otpauth=totpLib.keyuri(user.rows[0]?.email||String(req.user.id),"Fin Approvals",secret);
    const qrDataUrl=await QRCode.toDataURL(otpauth);
    res.json({secret,qr:qrDataUrl,otpauth});
  }catch(e){res.status(500).json({error:"server"});}
});

app.post("/auth/2fa/confirm", requireAuth, async(req,res)=>{
  try {
    const{code}=req.body??{};
    const u=await q("SELECT totp_secret FROM users WHERE id=$1",[req.user.id]);
    if(!u.rowCount||!u.rows[0].totp_secret)return res.status(400).json({error:"Setup 2FA eerst"});
    if(!verifyTotp(code,u.rows[0].totp_secret))return res.status(401).json({error:"Kodi i gabuar"});
    await q("UPDATE users SET totp_enabled=TRUE,totp_verified=TRUE WHERE id=$1",[req.user.id]);
    res.json({ok:true});
  }catch{res.status(500).json({error:"server"});}
});

app.post("/auth/2fa/disable", requireAuth, async(req,res)=>{
  try {
    const{code}=req.body??{};
    const u=await q("SELECT totp_secret FROM users WHERE id=$1",[req.user.id]);
    if(!u.rowCount)return res.status(404).json({error:"not_found"});
    if(u.rows[0].totp_secret&&!verifyTotp(code,u.rows[0].totp_secret))return res.status(401).json({error:"Kodi i gabuar"});
    await q("UPDATE users SET totp_secret=NULL,totp_enabled=FALSE,totp_verified=FALSE WHERE id=$1",[req.user.id]);
    res.json({ok:true});
  }catch{res.status(500).json({error:"server"});}
});

app.post("/auth/refresh", async(req,res)=>{
  try {
    const{refresh_token}=req.body??{};
    if(!refresh_token)return res.status(401).json({error:"Missing refresh_token"});
    let payload;try{payload=verifyRefresh(refresh_token)}catch{return res.status(401).json({error:"Invalid or expired"})};
    if(payload.type!=="refresh")return res.status(401).json({error:"Not a refresh token"});
    const stored=await q("SELECT * FROM refresh_tokens WHERE token=$1 AND revoked=FALSE AND expires_at>NOW()",[refresh_token]);
    if(!stored.rowCount)return res.status(401).json({error:"Token revoked"});
    const u=await q("SELECT * FROM users WHERE id=$1",[payload.id]);
    if(!u.rowCount)return res.status(401).json({error:"User not found"});
    res.json({token:signJWT(u.rows[0])});
  }catch{res.status(500).json({error:"server"});}
});

app.post("/auth/logout", requireAuth, async(req,res)=>{
  const{refresh_token}=req.body??{};
  if(refresh_token){try{await q("UPDATE refresh_tokens SET revoked=TRUE WHERE token=$1",[refresh_token])}catch{}}
  const authHeader=req.headers.authorization||"";
  const token=authHeader.startsWith("Bearer ")?authHeader.slice(7):null;
  if(token){try{await q("UPDATE user_sessions SET revoked=TRUE WHERE token_hash=$1",[hashToken(token)])}catch{}}
  res.json({ok:true});
});

app.post("/auth/forgot-password", resetLimiter, async(req,res)=>{
  try {
    const{email}=req.body??{};
    if(!email)return res.status(400).json({error:"Email mungon"});
    const r=await q("SELECT id,first_name,last_name FROM users WHERE email=$1",[email]);
    if(!r.rowCount)return res.json({ok:true});
    const user=r.rows[0];
    const token=crypto.randomBytes(32).toString("hex");
    const expires=new Date(Date.now()+60*60*1000);
    await q("INSERT INTO password_reset_tokens(user_id,token,expires_at) VALUES($1,$2,$3)",[user.id,token,expires]);
    const resetUrl=`${APP_URL}/reset-password?token=${token}`;
    const{subject,html}=emailPasswordReset({name:`${user.first_name} ${user.last_name}`,resetUrl});
    await sendMail({to:email,subject,html});
    res.json({ok:true});
  }catch(e){console.error("FORGOT_ERR:",e);res.status(500).json({error:"server"});}
});

app.post("/auth/reset-password", async(req,res)=>{
  try {
    const{token,password}=req.body??{};
    if(!token||!password||password.length<6)return res.status(400).json({error:"Token dhe fjalëkalim i ri (min 6 karaktere) kërkohen"});
    const r=await q("SELECT * FROM password_reset_tokens WHERE token=$1 AND used=FALSE AND expires_at>NOW()",[token]);
    if(!r.rowCount)return res.status(400).json({error:"Token i pavlefshëm ose i skaduar"});
    const{user_id}=r.rows[0];
    await q("UPDATE users SET password_hash=$1 WHERE id=$2",[await hash(password),user_id]);
    await q("UPDATE password_reset_tokens SET used=TRUE WHERE token=$1",[token]);
    await q("UPDATE refresh_tokens SET revoked=TRUE WHERE user_id=$1",[user_id]);
    res.json({ok:true});
  }catch{res.status(500).json({error:"server"});}
});

/* ─── Sessions ─── */
app.get("/auth/sessions", requireAuth, async(req,res)=>{
  const r=await q("SELECT id,device_name,ip,last_active,created_at FROM user_sessions WHERE user_id=$1 AND revoked=FALSE ORDER BY last_active DESC LIMIT 20",[req.user.id]);
  res.json(r.rows);
});
app.delete("/auth/sessions/:id", requireAuth, async(req,res)=>{
  await q("UPDATE user_sessions SET revoked=TRUE WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);
  res.json({ok:true});
});
app.delete("/auth/sessions", requireAuth, async(req,res)=>{
  const token=req.headers.authorization?.slice(7);
  await q("UPDATE user_sessions SET revoked=TRUE WHERE user_id=$1 AND token_hash<>$2",[req.user.id,token?hashToken(token):""]);
  res.json({ok:true});
});

/* ─────────────── PRICINGBRIDGE PROXY ─────────────── */

/* ── Local article search (sku + barkod + emër) ── */
app.get("/articles/search", requireAuth, async(req,res)=>{
  res.set("Cache-Control","no-store");
  const { term } = req.query;
  if (!term || term.trim().length < 2) return res.status(400).json({ error: "term duhet >= 2 karaktere" });
  const t = term.trim();
  try {
    // Kërko në bazën lokale: me SKU, barkod, ose emër
    let divFilter = "";
    const params = [`%${t}%`, `%${t}%`, `%${t}%`];
    let paramIdx = 3;

    // Filter-i i division-it hiqet - te gjithe agjentët shohin te gjitha artikujt

    const r = await q(
      `SELECT id, sku, name, sell_price, barkod, division_id
       FROM articles
       WHERE (sku ILIKE $1 OR barkod ILIKE $2 OR name ILIKE $3)${divFilter}
       ORDER BY
         CASE WHEN sku ILIKE $1 THEN 0 WHEN barkod ILIKE $2 THEN 1 ELSE 2 END,
         sku
       LIMIT 30`,
      params
    );
    res.json({ articles: r.rows });
  } catch(e) {
    console.error("[LOCAL_SEARCH]", e.message);
    res.status(500).json({ error: "server" });
  }
});

app.get("/pb/article", requireAuth, async(req,res)=>{
  res.set("Cache-Control","no-store");
  const{term,sifraOe}=req.query;
  if(!term||term.trim().length<2) return res.status(400).json({error:"term duhet >= 2 karaktere"});
  try{
    let arts=await pbSearchArticle(term.trim(), sifraOe?parseInt(sifraOe):1);
    // Te gjithe agjentët dhe avancues shohin te gjitha artikujt nga PricingBridge
    // (PB nuk kthen Sifra_Div, filter-i i division-it hiqet)
    return res.json({articles:arts});
  }catch(e){
    console.error("[PB] article search:",e.message);
    return res.status(502).json({error:"PricingBridge nuk disponueshëm",detail:e.message});
  }
});

app.get("/pb/price", requireAuth, async(req,res)=>{
  const{sifraKup,sifraObj,sifraArt,lotBr}=req.query;
  if(!sifraKup||!sifraArt) return res.status(400).json({error:"sifraKup dhe sifraArt të detyrueshme"});
  try{
    const result=await pbLookupPrice({sifraKup:sifraKup.trim(),sifraObj:sifraObj?parseInt(sifraObj):null,sifraArt:sifraArt.trim(),lotBr:lotBr?lotBr.trim():null});
    if(!result) return res.status(404).json({error:"Çmimi nuk u gjet"});
    return res.json({price:result});
  }catch(e){
    console.error("[PB] price lookup:",e.message);
    return res.status(502).json({error:"PricingBridge nuk disponueshëm",detail:e.message});
  }
});

/* ─────────────── META ─────────────── */
app.get("/meta", requireAuth, async(req,res)=>{
  // Merr divisionet e agjentit/avancuesit (mund te jete shume)
  let agentDivisionIds=[];
  if(req.user.role==="agent"||req.user.role==="avancues"){
    const adiv=await q("SELECT division_id FROM agent_divisions WHERE agent_id=$1",[req.user.id]);
    agentDivisionIds=adiv.rows.map(r=>r.division_id);
    // Fallback: nese nuk ka ne agent_divisions, perdor division_id nga users
    if(!agentDivisionIds.length){
      if(req.user.role==="avancues"){
        // Avancues merr te gjitha divizionet automatikisht
        const allDivs=await q("SELECT id FROM divisions ORDER BY id");
        agentDivisionIds=allDivs.rows.map(r=>r.id);
      } else {
        const ud=await q("SELECT division_id FROM users WHERE id=$1",[req.user.id]);
        if(ud.rows[0]?.division_id) agentDivisionIds=[ud.rows[0].division_id];
      }
    }
  }

  // Filtro articles sipas divisioneve te agjentit (vetem divizionet me artikuj: 2-7,9)
  // Avancues ka te gjitha divizionet, pra merr te gjitha artikujt
  const validDivIds = agentDivisionIds.filter(d => d !== 1 && d !== 8);
  const articlesQ = (req.user.role==="avancues")
    ? q("SELECT id,sku,name,sell_price FROM articles WHERE division_id IS NOT NULL AND division_id NOT IN (1,8) ORDER BY sku")
    : (validDivIds.length>0
      ? q(`SELECT id,sku,name,sell_price FROM articles WHERE division_id = ANY($1::int[]) ORDER BY sku`,[validDivIds])
      : q("SELECT id,sku,name,sell_price FROM articles WHERE division_id IS NOT NULL AND division_id NOT IN (1,8) ORDER BY sku"));

  const[buyers,sites,articles,me,thresholds]=await Promise.all([
    q("SELECT id,code,name FROM buyers ORDER BY code"),
    q("SELECT id,buyer_id,site_code,site_name FROM buyer_sites ORDER BY site_code"),
    articlesQ,
    q("SELECT u.id,u.first_name,u.last_name,u.pda_number,u.division_id,d.name as division_name,u.team_leader_id FROM users u LEFT JOIN divisions d ON d.id=u.division_id WHERE u.id=$1",[req.user.id]),
    getThresholds(),
  ]);
  // Agent limit info
  let agentLimit=null;
  if(req.user.role==="agent"||req.user.role==="avancues"){
    try{
      const limits=await q("SELECT period,max_amount FROM agent_limits WHERE user_id=$1",[req.user.id]);
      if(limits.rowCount){
        agentLimit=[];
        for(const lim of limits.rows){
          const intervalDays2=lim.period==="monthly"?30:7;
          const spent=await q(`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM requests WHERE agent_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,[req.user.id,intervalDays2]);
          agentLimit.push({period:lim.period,max:Number(lim.max_amount),used:Number(spent.rows[0].s),pct:Math.round(Number(spent.rows[0].s)/Number(lim.max_amount)*100)});
        }
      }
    }catch{}
  }
  res.json({buyers:buyers.rows,sites:sites.rows,articles:articles.rows,me:me.rows[0],thresholds,agentLimit,agentDivisionIds});
});

/* ─────────────── THRESHOLDS (Admin) ─────────────── */
app.get("/admin/thresholds", requireAuth, requireRole("admin"), async(_,res)=>{
  const r=await q("SELECT key,value,label FROM approval_thresholds ORDER BY key");
  res.json(r.rows);
});
app.put("/admin/thresholds", requireAuth, requireRole("admin"), async(req,res)=>{
  const{team_lead_max,division_manager_max}=req.body??{};
  if(!team_lead_max||!division_manager_max)return res.status(400).json({error:"Parametra mungojnë"});
  if(Number(team_lead_max)>=Number(division_manager_max))return res.status(400).json({error:"Team Lead max duhet të jetë më i vogël se Division Manager max"});
  await q("UPDATE approval_thresholds SET value=$1,updated_at=NOW(),updated_by=$3 WHERE key=$2",[Number(team_lead_max),"team_lead_max",req.user.id]);
  await q("UPDATE approval_thresholds SET value=$1,updated_at=NOW(),updated_by=$3 WHERE key=$2",[Number(division_manager_max),"division_manager_max",req.user.id]);
  invalidateThresholdCache();
  await audit(req,"update","thresholds",null,{team_lead_max,division_manager_max});
  res.json({ok:true});
});

/* ─────────────── APPROVER LIST (for delegations) ─────────────── */
app.get("/users/approvers", requireAuth, requireRole("team_lead","division_manager","sales_director","admin"), async(req,res)=>{
  try {
    const approverRoles = ["team_lead","division_manager","sales_director"];
    let r;
    if (req.user.role === "sales_director" || req.user.role === "admin") {
      // Sales director / admin mund të shohë të gjithë aprovuesit
      r = await q(
        `SELECT id,first_name,last_name,email,role,division_id FROM users
         WHERE role = ANY($1::user_role[]) AND id <> $2 ORDER BY first_name,last_name`,
        [approverRoles, req.user.id]
      );
    } else {
      // Team lead / division manager sheh vetëm aprovuesit e divisionit të vet
      r = await q(
        `SELECT id,first_name,last_name,email,role,division_id FROM users
         WHERE role = ANY($1::user_role[]) AND id <> $2
           AND (division_id = $3 OR role = 'sales_director')
         ORDER BY first_name,last_name`,
        [approverRoles, req.user.id, req.user.division_id]
      );
    }
    res.json(r.rows);
  } catch(e) { console.error("APPROVERS_ERR:", e); res.status(500).json({error:"server"}); }
});

/* ─────────────── DELEGATIONS ─────────────── */
app.get("/delegations/my", requireAuth, requireRole("team_lead","division_manager","sales_director"), async(req,res)=>{
  const r=await q(
    `SELECT d.*,u.first_name AS to_first,u.last_name AS to_last,u.email AS to_email
     FROM approval_delegations d JOIN users u ON u.id=d.to_user_id
     WHERE d.from_user_id=$1 ORDER BY d.created_at DESC`,[req.user.id]);
  res.json(r.rows);
});
app.post("/delegations", requireAuth, requireRole("team_lead","division_manager","sales_director"), async(req,res)=>{
  const{to_user_id,start_date,end_date,reason}=req.body??{};
  if(!to_user_id||!start_date||!end_date)return res.status(400).json({error:"Parametra mungojnë"});
  if(Number(to_user_id)===req.user.id)return res.status(400).json({error:"Nuk mund të delegosh te vetja"});
  if(new Date(start_date)>new Date(end_date))return res.status(400).json({error:"Data e fillimit duhet të jetë para datës së mbarimit"});
  try{
    const r=await q(
      "INSERT INTO approval_delegations(from_user_id,to_user_id,start_date,end_date,reason) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [req.user.id,Number(to_user_id),start_date,end_date,trimLen(reason,"comment")||null]);
    // Notify the delegate
    const delegate=await q("SELECT email,first_name FROM users WHERE id=$1",[to_user_id]);
    if(delegate.rows[0]?.email){
      sendMail({
        to:delegate.rows[0].email,
        subject:"[Fin Approvals] Detyrim delegimi",
        html:`<p>Përshëndetje <b>${delegate.rows[0].first_name}</b>,</p><p>Aprovimi është deleguar te ju nga <b>${req.user.first_name} ${req.user.last_name}</b> për periudhën <b>${start_date} — ${end_date}</b>.</p><p>Gjatë kësaj periudhe do t'u caktohen kërkesat automatikisht.</p><a href="${APP_URL}/approvals" style="background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">Hap Aprovime →</a>`
      }).catch(()=>{});
    }
    res.json({id:r.rows[0].id});
  }catch(e){res.status(500).json({error:"server"});}
});
app.delete("/delegations/:id", requireAuth, async(req,res)=>{
  const id=Number(req.params.id);
  await q("UPDATE approval_delegations SET active=FALSE WHERE id=$1 AND from_user_id=$2",[id,req.user.id]);
  res.json({ok:true});
});
app.get("/admin/delegations", requireAuth, requireRole("admin"), async(_,res)=>{
  const r=await q(
    `SELECT d.*,f.first_name AS from_first,f.last_name AS from_last,t.first_name AS to_first,t.last_name AS to_last
     FROM approval_delegations d JOIN users f ON f.id=d.from_user_id JOIN users t ON t.id=d.to_user_id
     ORDER BY d.created_at DESC LIMIT 100`);
  res.json(r.rows);
});

/* ─────────────── AGENT LIMITS ─────────────── */
app.get("/admin/agent-limits", requireAuth, requireRole("admin"), async(_,res)=>{
  const r=await q(
    `SELECT al.*,u.first_name,u.last_name,u.email
     FROM agent_limits al JOIN users u ON u.id=al.user_id
     ORDER BY u.first_name,u.last_name,al.period`);
  res.json(r.rows);
});
app.post("/admin/agent-limits", requireAuth, requireRole("admin"), async(req,res)=>{
  const{user_id,period,max_amount}=req.body??{};
  if(!user_id||!period||!max_amount)return res.status(400).json({error:"Parametra mungojnë"});
  if(!["weekly","monthly"].includes(period))return res.status(400).json({error:"Period: weekly ose monthly"});
  try{
    await q("INSERT INTO agent_limits(user_id,period,max_amount) VALUES($1,$2,$3) ON CONFLICT(user_id,period) DO UPDATE SET max_amount=$3,updated_at=NOW()",[Number(user_id),period,Number(max_amount)]);
    await audit(req,"upsert","agent_limit",Number(user_id),{period,max_amount});
    res.json({ok:true});
  }catch{res.status(500).json({error:"server"});}
});
app.delete("/admin/agent-limits/:userId/:period", requireAuth, requireRole("admin"), async(req,res)=>{
  await q("DELETE FROM agent_limits WHERE user_id=$1 AND period=$2",[Number(req.params.userId),req.params.period]);
  res.json({ok:true});
});

/* ─── IP Whitelist ─── */
app.get("/admin/ip-whitelist", requireAuth, requireRole("admin"), async(_,res)=>{
  const r=await q("SELECT w.*,u.first_name,u.last_name FROM ip_whitelist w LEFT JOIN users u ON u.id=w.created_by ORDER BY w.id");
  res.json(r.rows);
});
app.post("/admin/ip-whitelist", requireAuth, requireRole("admin"), checkIpWhitelist, async(req,res)=>{
  const{cidr,label}=req.body??{};
  if(!cidr)return res.status(400).json({error:"CIDR mungon"});
  try{
    const r=await q("INSERT INTO ip_whitelist(cidr,label,created_by) VALUES($1,$2,$3) RETURNING id",[cidr,label||null,req.user.id]);
    await audit(req,"create","ip_whitelist",r.rows[0].id,{cidr,label});
    res.json({id:r.rows[0].id});
  }catch(e){if(e?.code==="23505")return res.status(409).json({error:"CIDR ekziston"});if(e?.message?.includes("invalid"))return res.status(400).json({error:"Format CIDR invalid"});res.status(500).json({error:"server"});}
});
app.delete("/admin/ip-whitelist/:id", requireAuth, requireRole("admin"), async(req,res)=>{
  await q("DELETE FROM ip_whitelist WHERE id=$1",[Number(req.params.id)]);
  await audit(req,"delete","ip_whitelist",Number(req.params.id),{});
  res.json({ok:true});
});

/* ─── Monthly report trigger ─── */
app.post("/admin/reports/run", requireAuth, requireRole("admin","sales_director"), async(req,res)=>{
  const{period}=req.body??{};
  if(!period)return res.status(400).json({error:"Period mungon (format: YYYY-MM)"});
  const{runMonthlyReport}=await import("./cron.js");
  runMonthlyReport(period).catch(()=>{});
  res.json({ok:true,message:`Raporti për ${period} është duke u gjeneruar`});
});

/* ─────────────── COMMENTS ─────────────── */
app.get("/requests/:id/comments", requireAuth, async(req,res)=>{
  try{
    const id=Number(req.params.id);
    if(!id)return res.status(400).json({error:"id"});
    const r=await q(
      `SELECT c.*,u.first_name,u.last_name,u.role FROM request_comments c JOIN users u ON u.id=c.user_id WHERE c.request_id=$1 ORDER BY c.created_at`,[id]);
    res.json(r.rows);
  }catch{res.status(500).json({error:"server"});}
});
app.post("/requests/:id/comments", requireAuth, async(req,res)=>{
  try{
    const reqId=Number(req.params.id);if(!reqId)return res.status(400).json({error:"id"});
    const body=trimLen(req.body?.body,"body");if(!body)return res.status(400).json({error:"Teksti mungon"});
    const r=await q("SELECT id,agent_id,division_id,required_role,assigned_to_user_id FROM requests WHERE id=$1",[reqId]);
    if(!r.rowCount)return res.status(404).json({error:"not_found"});
    const row=r.rows[0];
    // Auth: agent who owns it, or any approver in same division, or admin
    const canComment=req.user.role==="admin"||row.agent_id===req.user.id||(req.user.role!=="agent"&&req.user.role!=="avancues"&&(req.user.role==="sales_director"||row.division_id===req.user.division_id));
    if(!canComment)return res.status(403).json({error:"forbidden"});
    const c=await q("INSERT INTO request_comments(request_id,user_id,body) VALUES($1,$2,$3) RETURNING *",[reqId,req.user.id,body]);
    const newComment={...c.rows[0],first_name:req.user.first_name,last_name:req.user.last_name,role:req.user.role};
    // SSE: notify agent + approver
    sseSend(row.agent_id,"new_comment",{request_id:reqId,comment:newComment});
    if(row.assigned_to_user_id&&row.assigned_to_user_id!==req.user.id)sseSend(row.assigned_to_user_id,"new_comment",{request_id:reqId,comment:newComment});
    res.json(newComment);
  }catch(e){console.error("COMMENT_ERR:",e);res.status(500).json({error:"server"});}
});

/* ─────────────── ADMIN CRUD (unchanged) ─────────────── */
app.get("/admin/divisions",requireAuth,requireRole("admin"),async(_,res)=>{res.json((await q("SELECT id,name,default_team_leader_id FROM divisions ORDER BY id")).rows)});
app.post("/admin/divisions",requireAuth,requireRole("admin"),async(req,res)=>{const name=trimLen(req.body?.name,"name");let dtl=req.body?.default_team_leader_id??null;if(!name)return res.status(400).json({error:"Emri mungon"});if(dtl==="")dtl=null;if(dtl)dtl=Number(dtl);try{const r=await q("INSERT INTO divisions(name,default_team_leader_id) VALUES($1,$2) RETURNING id",[name,dtl||null]);await audit(req,"create","division",r.rows[0].id,{name});res.json({id:r.rows[0].id})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"Emri ekziston"});res.status(500).json({error:"server"})}});
app.put("/admin/divisions/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id);const name=trimLen(req.body?.name,"name");let dtl=req.body?.default_team_leader_id;if(!id||!name)return res.status(400).json({error:"id/emri"});if(dtl==="")dtl=null;if(dtl!=null){dtl=Number(dtl);if(!Number.isFinite(dtl))return res.status(400).json({error:"dtl invalid"});const chk=await q("SELECT 1 FROM users WHERE id=$1 AND role='team_lead' AND division_id=$2",[dtl,id]);if(!chk.rowCount)return res.status(400).json({error:"team lead i kësaj ndarjeje"})}else{const cur=await q("SELECT default_team_leader_id FROM divisions WHERE id=$1",[id]);dtl=cur.rows?.[0]?.default_team_leader_id??null}await q("UPDATE divisions SET name=$1,default_team_leader_id=$2 WHERE id=$3",[name,dtl||null,id]);await audit(req,"update","division",id,{name});res.json({ok:true})});
app.delete("/admin/divisions/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});if((await q("SELECT 1 FROM users WHERE division_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use"});if((await q("SELECT 1 FROM requests WHERE division_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use"});try{await q("DELETE FROM divisions WHERE id=$1",[id]);await audit(req,"delete","division",id,{});res.json({ok:true})}catch(e){if(e?.code==="23503")return res.status(409).json({error:"in_use"});res.status(500).json({error:"server"})}});
app.get("/admin/articles",requireAuth,requireRole("admin"),async(_,res)=>{res.json((await q("SELECT id,sku,name,sell_price FROM articles ORDER BY sku")).rows)});
app.post("/admin/articles",requireAuth,requireRole("admin"),async(req,res)=>{const sku=trimLen(req.body?.sku,"sku"),name=trimLen(req.body?.name,"name"),price=req.body?.sell_price===''||req.body?.sell_price==null?null:Number(req.body.sell_price);if(!sku||!name)return res.status(400).json({error:"SKU/Emri mungon"});if(price===null||!Number.isFinite(price)||price<0)return res.status(400).json({error:"Çmimi invalid"});try{const r=await q("INSERT INTO articles(sku,name,sell_price) VALUES($1,$2,$3) RETURNING id",[sku,name,price]);await audit(req,"create","article",r.rows[0].id,{sku,name,price});res.json({id:r.rows[0].id})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"SKU ekziston"});res.status(500).json({error:"server"})}});
app.put("/admin/articles/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id),sku=trimLen(req.body?.sku,"sku"),name=trimLen(req.body?.name,"name"),price=req.body?.sell_price===''||req.body?.sell_price==null?null:Number(req.body.sell_price);if(!id||!sku||!name)return res.status(400).json({error:"id/SKU/Emri"});if(price===null||!Number.isFinite(price)||price<0)return res.status(400).json({error:"Çmimi invalid"});try{await q("UPDATE articles SET sku=$1,name=$2,sell_price=$3 WHERE id=$4",[sku,name,price,id]);await audit(req,"update","article",id,{sku,name,price});res.json({ok:true})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"SKU ekziston"});res.status(500).json({error:"server"})}});
app.delete("/admin/articles/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});if((await q("SELECT 1 FROM requests WHERE article_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use"});if(await regclassExists("request_items")&&(await q("SELECT 1 FROM request_items WHERE article_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use"});try{await q("DELETE FROM articles WHERE id=$1",[id]);await audit(req,"delete","article",id,{});res.json({ok:true})}catch(e){if(e?.code==="23503")return res.status(409).json({error:"in_use"});res.status(500).json({error:"server"})}});
app.get("/admin/buyers",requireAuth,requireRole("admin"),async(_,res)=>{res.json((await q("SELECT id,code,name FROM buyers ORDER BY id")).rows)});
app.post("/admin/buyers",requireAuth,requireRole("admin"),async(req,res)=>{const code=trimLen(req.body?.code,"sku"),name=trimLen(req.body?.name,"name");if(!code||!name)return res.status(400).json({error:"Kodi/Emri mungon"});try{const r=await q("INSERT INTO buyers(code,name) VALUES($1,$2) RETURNING id",[code,name]);await audit(req,"create","buyer",r.rows[0].id,{code,name});res.json({id:r.rows[0].id})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"Kodi ekziston"});res.status(500).json({error:"server"})}});
app.put("/admin/buyers/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id),code=trimLen(req.body?.code,"sku"),name=trimLen(req.body?.name,"name");if(!id||!code||!name)return res.status(400).json({error:"id/Kodi/Emri"});try{if((await q("SELECT 1 FROM buyers WHERE code=$1 AND id<>$2",[code,id])).rowCount)return res.status(409).json({error:"Kodi ekziston"});await q("UPDATE buyers SET code=$1,name=$2 WHERE id=$3",[code,name,id]);await audit(req,"update","buyer",id,{code,name});res.json({ok:true})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"Kodi ekziston"});res.status(500).json({error:"server"})}});
app.delete("/admin/buyers/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});try{if((await q("SELECT 1 FROM requests WHERE buyer_id=$1 LIMIT 1",[id])).rowCount||(await q("SELECT 1 FROM buyer_sites WHERE buyer_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use"});await q("DELETE FROM buyers WHERE id=$1",[id]);await audit(req,"delete","buyer",id,{});res.json({ok:true})}catch(e){if(e?.code==="23503")return res.status(409).json({error:"in_use"});res.status(500).json({error:"server"})}});
app.get("/admin/buyer-sites",requireAuth,requireRole("admin"),async(req,res)=>{const{buyer_id}=req.query;const r=await q("SELECT id,buyer_id,site_code,site_name FROM buyer_sites "+(buyer_id?"WHERE buyer_id=$1 ":"")+"ORDER BY id",buyer_id?[Number(buyer_id)]:[]);res.json(r.rows)});
app.post("/admin/buyer-sites",requireAuth,requireRole("admin"),async(req,res)=>{const buyer_id=Number(req.body?.buyer_id),site_code=trimLen(req.body?.site_code,"sku"),site_name=trimLen(req.body?.site_name,"name");if(!buyer_id||!site_code||!site_name)return res.status(400).json({error:"parametra mungojnë"});try{const r=await q("INSERT INTO buyer_sites(buyer_id,site_code,site_name) VALUES($1,$2,$3) RETURNING id",[buyer_id,site_code,site_name]);await audit(req,"create","buyer_site",r.rows[0].id,{buyer_id,site_code,site_name});res.json({id:r.rows[0].id})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"Kodi ekziston"});res.status(500).json({error:"server"})}});
app.put("/admin/buyer-sites/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id),buyer_id=Number(req.body?.buyer_id),site_code=trimLen(req.body?.site_code,"sku"),site_name=trimLen(req.body?.site_name,"name");if(!id||!buyer_id||!site_code||!site_name)return res.status(400).json({error:"parametra mungojnë"});try{if((await q("SELECT 1 FROM buyer_sites WHERE buyer_id=$1 AND site_code=$2 AND id<>$3",[buyer_id,site_code,id])).rowCount)return res.status(409).json({error:"Kodi ekziston"});await q("UPDATE buyer_sites SET buyer_id=$1,site_code=$2,site_name=$3 WHERE id=$4",[buyer_id,site_code,site_name,id]);await audit(req,"update","buyer_site",id,{site_code,site_name});res.json({ok:true})}catch(e){if(e?.code==="23505")return res.status(409).json({error:"Kodi ekziston"});res.status(500).json({error:"server"})}});
app.delete("/admin/buyer-sites/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});try{if((await q("SELECT 1 FROM requests WHERE site_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use"});await q("DELETE FROM buyer_sites WHERE id=$1",[id]);await audit(req,"delete","buyer_site",id,{});res.json({ok:true})}catch(e){if(e?.code==="23503")return res.status(409).json({error:"in_use"});res.status(500).json({error:"server"})}});
app.get("/admin/users",requireAuth,requireRole("admin"),async(_,res)=>{
  const r=await q(`SELECT u.id,u.first_name,u.last_name,u.email,u.role,u.division_id,d.name AS division_name,u.pda_number,u.team_leader_id,u.created_at,u.last_login,u.totp_enabled FROM users u LEFT JOIN divisions d ON d.id=u.division_id ORDER BY u.id`);
  const users=r.rows;
  // Shto agent_divisions per secilin agjent
  const adivs=await q("SELECT agent_id, array_agg(division_id) AS division_ids FROM agent_divisions GROUP BY agent_id");
  const adivMap=new Map(adivs.rows.map(r=>[r.agent_id,r.division_ids]));
  for(const u of users){ u.agent_division_ids = adivMap.get(u.id)||[]; }
  res.json(users);
});
app.post("/admin/users",requireAuth,requireRole("admin"),async(req,res)=>{try{
  const{first_name,last_name,email,password,role,division_id,pda_number,team_leader_id,agent_division_ids}=req.body??{};
  if(!email?.trim()||!password?.trim())return res.status(400).json({error:"Email/fjalëkalimi mungon"});
  const ph=await hash(password);
  let tlId=team_leader_id||null;
  if(role!=="agent")tlId=null;
  if(tlId&&!(await q("SELECT 1 FROM users WHERE id=$1 AND role='team_lead' AND division_id=$2",[tlId,division_id||null])).rowCount)return res.status(400).json({error:"team_leader_id invalid"});
  const r=await q("INSERT INTO users(first_name,last_name,email,password_hash,role,division_id,pda_number,team_leader_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[first_name||"",last_name||"",email.trim(),ph,role,division_id||null,pda_number||null,tlId]);
  const userId=r.rows[0].id;
  // Shto agent_divisions nese eshte agjent ose avancues
  if(role==="agent"||role==="avancues"){
    let divIds;
    if(role==="avancues"){
      // Avancues merr te gjitha divizionet automatikisht
      const allDivs=await q("SELECT id FROM divisions ORDER BY id");
      divIds=allDivs.rows.map(r=>r.id);
    } else {
      divIds=Array.isArray(agent_division_ids)&&agent_division_ids.length ? agent_division_ids : (division_id?[division_id]:[]);
    }
    for(const did of divIds){
      await q("INSERT INTO agent_divisions(agent_id,division_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[userId,did]);
    }
  }
  await audit(req,"create","user",userId,{email,role});
  res.json({id:userId});
}catch(e){if(e.code==="23505")return res.status(409).json({error:"Email ekziston"});res.status(500).json({error:"server"})}});
app.put("/admin/users/:id",requireAuth,requireRole("admin"),async(req,res)=>{
  const id=Number(req.params.id);
  const{first_name="",last_name="",email="",password="",role,division_id,pda_number,team_leader_id,agent_division_ids}=req.body||{};
  if(!id)return res.status(400).json({error:"id"});
  try{
    if(email&&(await q("SELECT 1 FROM users WHERE email=$1 AND id<>$2",[email,id])).rowCount)return res.status(409).json({error:"Email ekziston"});
    let tlId=team_leader_id||null;
    if(role!=="agent")tlId=null;
    if(tlId&&!(await q("SELECT 1 FROM users WHERE id=$1 AND role='team_lead' AND division_id=$2",[tlId,division_id||null])).rowCount)return res.status(400).json({error:"team_leader_id invalid"});
    if(password&&password.trim()){
      const ph=await hash(password.trim());
      await q("UPDATE users SET first_name=$1,last_name=$2,email=$3,password_hash=$4,role=$5,division_id=$6,pda_number=$7,team_leader_id=$8 WHERE id=$9",[first_name,last_name,email,ph,role,division_id||null,pda_number||null,tlId,id]);
    }else{
      await q("UPDATE users SET first_name=$1,last_name=$2,email=$3,role=$4,division_id=$5,pda_number=$6,team_leader_id=$7 WHERE id=$8",[first_name,last_name,email,role,division_id||null,pda_number||null,tlId,id]);
    }
    // Update agent_divisions nese eshte agjent ose avancues
    if(role==="agent"||role==="avancues"){
      let divIds;
      if(role==="avancues"){
        // Avancues merr te gjitha divizionet automatikisht
        const allDivs=await q("SELECT id FROM divisions ORDER BY id");
        divIds=allDivs.rows.map(r=>r.id);
      } else {
        divIds=Array.isArray(agent_division_ids)&&agent_division_ids.length ? agent_division_ids : (division_id?[division_id]:[]);
      }
      await q("DELETE FROM agent_divisions WHERE agent_id=$1",[id]);
      for(const did of divIds){
        await q("INSERT INTO agent_divisions(agent_id,division_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,did]);
      }
      // Update division_id kryesor me te parin nga lista
      if(divIds.length>0){
        await q("UPDATE users SET division_id=$1 WHERE id=$2",[divIds[0],id]);
      }
    }
    await audit(req,"update","user",id,{email,role});
    res.json({ok:true});
  }catch(e){console.error("UPDATE_USER:",e);res.status(500).json({error:"server"})}
});
app.delete("/admin/users/:id",requireAuth,requireRole("admin"),async(req,res)=>{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});if((await q("SELECT 1 FROM requests WHERE agent_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use_requests"});if((await q("SELECT 1 FROM approvals WHERE approver_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use_approvals"});if((await q("SELECT 1 FROM requests WHERE assigned_to_user_id=$1 LIMIT 1",[id])).rowCount)return res.status(409).json({error:"in_use_assigned"});try{await q("DELETE FROM users WHERE id=$1",[id]);await audit(req,"delete","user",id,{});res.json({ok:true})}catch(e){if(e?.code==="23503")return res.status(409).json({error:"in_use"});res.status(500).json({error:"server"})}});
app.get("/admin/audit-log",requireAuth,requireRole("admin"),async(req,res)=>{const page=Math.max(1,Number(req.query.page||1)),per=Math.min(100,Number(req.query.per||50));const offset=(page-1)*per;const[rows,total]=await Promise.all([q(`SELECT a.*,u.first_name,u.last_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,[per,offset]),q("SELECT COUNT(*)::int AS c FROM audit_log")]);res.json({rows:rows.rows,total:total.rows[0].c,page,per,pages:Math.ceil(total.rows[0].c/per)})});

/* ─────────────── DASHBOARD STATS (extended) ─────────────── */
app.get("/dashboard/stats", requireAuth, requireRole("sales_director","division_manager","admin"), async(req,res)=>{
  try{
    const divF=req.user.role==="division_manager"?"AND r.division_id=$1":"";
    const params=req.user.role==="division_manager"?[req.user.division_id]:[];
    const[totals,byStatus,byRole,trend,topAgents,totalApproved,aging]=await Promise.all([
      q(`SELECT COUNT(*)::int AS total,COALESCE(SUM(r.amount),0)::numeric AS total_value FROM requests r WHERE 1=1 ${divF}`,params),
      q(`SELECT r.status,COUNT(*)::int AS cnt,COALESCE(SUM(r.amount),0)::numeric AS val FROM requests r WHERE 1=1 ${divF} GROUP BY r.status`,params),
      q(`SELECT r.required_role,COUNT(*)::int AS cnt FROM requests r WHERE r.status='pending' ${divF} GROUP BY r.required_role`,params),
      q(`SELECT DATE(r.created_at) AS day,COUNT(*)::int AS cnt,COALESCE(SUM(r.amount),0)::numeric AS val FROM requests r WHERE r.created_at>=NOW()-INTERVAL '30 days' ${divF} GROUP BY day ORDER BY day`,params),
      q(`SELECT u.first_name,u.last_name,COUNT(r.id)::int AS cnt,COALESCE(SUM(r.amount),0)::numeric AS val FROM requests r JOIN users u ON u.id=r.agent_id WHERE 1=1 ${divF} GROUP BY u.id,u.first_name,u.last_name ORDER BY cnt DESC LIMIT 10`,params),
      q(`SELECT COALESCE(SUM(r.amount),0)::numeric AS val FROM requests r WHERE r.status='approved' ${divF}`,params),
      // Aging: avg hours pending
      q(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW()-r.created_at))/3600),0)::numeric AS avg_hours,
           COUNT(*)::int AS cnt FROM requests r WHERE r.status='pending' ${divF}`,params),
    ]);

    // Heatmap: requests by hour-of-day and day-of-week (last 90 days)
    const heatmap=await q(
      `SELECT EXTRACT(DOW FROM r.created_at)::int AS dow,EXTRACT(HOUR FROM r.created_at)::int AS hour,COUNT(*)::int AS cnt
       FROM requests r WHERE r.created_at>=NOW()-INTERVAL '90 days' ${divF} GROUP BY dow,hour`,params);

    // Period comparison: this month vs last month
    const periodComp=await q(
      `SELECT
         COUNT(*) FILTER(WHERE r.created_at>=DATE_TRUNC('month',NOW()))::int AS this_month_cnt,
         COUNT(*) FILTER(WHERE r.created_at>=DATE_TRUNC('month',NOW()-INTERVAL '1 month') AND r.created_at<DATE_TRUNC('month',NOW()))::int AS last_month_cnt,
         COALESCE(SUM(r.amount) FILTER(WHERE r.created_at>=DATE_TRUNC('month',NOW())),0)::numeric AS this_month_val,
         COALESCE(SUM(r.amount) FILTER(WHERE r.created_at>=DATE_TRUNC('month',NOW()-INTERVAL '1 month') AND r.created_at<DATE_TRUNC('month',NOW())),0)::numeric AS last_month_val
       FROM requests r WHERE 1=1 ${divF}`,params);

    res.json({
      total:totals.rows[0]?.total||0,
      total_value:Number(totals.rows[0]?.total_value||0),
      approved_value:Number(totalApproved.rows[0]?.val||0),
      by_status:byStatus.rows,
      by_role:byRole.rows,
      trend_30d:trend.rows,
      top_agents:topAgents.rows,
      aging:{avg_hours:Number(aging.rows[0]?.avg_hours||0).toFixed(1),pending_cnt:aging.rows[0]?.cnt||0},
      heatmap:heatmap.rows,
      period_comparison:periodComp.rows[0]||{},
    });
  }catch(e){console.error("STATS_ERR:",e);res.status(500).json({error:"server_error"});}
});

app.get("/approvals/export-csv",requireAuth,requireRole("sales_director","division_manager","admin"),async(req,res)=>{
  try{
    const{from,to}=req.query;const divF=req.user.role==="division_manager"?"AND r.division_id=$3":"";
    const params=[from||"2000-01-01",to||"2099-12-31",...(req.user.role==="division_manager"?[req.user.division_id]:[])];
    const r=await q(`SELECT r.id,r.created_at,r.status,r.required_role,r.amount,u.first_name||' '||u.last_name AS agent,u.pda_number,b.code AS buyer_code,b.name AS buyer_name,s.site_name,r.invoice_ref,r.reason,a.first_name||' '||a.last_name AS approver,ap.acted_at,ap.action,ap.comment FROM requests r JOIN users u ON u.id=r.agent_id JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id LEFT JOIN LATERAL(SELECT * FROM approvals WHERE request_id=r.id ORDER BY acted_at DESC LIMIT 1) ap ON TRUE LEFT JOIN users a ON a.id=ap.approver_id WHERE r.created_at>=$1::date AND r.created_at<($2::date+INTERVAL '1 day') ${divF} ORDER BY r.id`,params);
    const esc=v=>{if(v==null)return"";const s=String(v).replace(/"/g,'""');return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s}"`:s};
    const headers=["ID","Data","Statusi","Niveli","Shuma","Agjenti","PDA","Blerësi Kodi","Blerësi Emri","Objekti","Ref Faturë","Arsyeja","Aprovuesi","Data Aprovimit","Veprimi","Koment"];
    const rows=r.rows.map(row=>[row.id,row.created_at?new Date(row.created_at).toLocaleDateString("sq-AL"):"",row.status,row.required_role,Number(row.amount||0).toFixed(2),row.agent,row.pda_number,row.buyer_code,row.buyer_name,row.site_name,row.invoice_ref,row.reason,row.approver,row.acted_at?new Date(row.acted_at).toLocaleDateString("sq-AL"):"",row.action,row.comment].map(esc));
    const csv="\uFEFF"+[headers.map(esc),...rows].map(r=>r.join(",")).join("\n");
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename=aprovime-${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  }catch(e){res.status(500).json({error:"server_error"});}
});

/* ─────────────── REQUESTS ─────────────── */
app.post("/requests",requireAuth,requireRole("agent","avancues","admin"),upload.array("photos",10),async(req,res)=>{
  try{
    const parseMaybeJson=v=>{if(v==null||v==="")return null;if(typeof v==="string"){try{return JSON.parse(v)}catch{return v}}return v};
    const{buyer_id,site_id,article_id,quantity=1,amount,invoice_ref,reason}=req.body;
    let items=parseMaybeJson(req.body.items);
    const buyerIdClean=cleanId(buyer_id);if(!buyerIdClean)return res.status(400).json({error:"Zgjedh blerësin"});
    const siteIdClean=cleanId(site_id);
    const me=await q("SELECT division_id,email,first_name,last_name FROM users WHERE id=$1",[req.user.id]);
    const division_id=me.rows[0].division_id;

    let totalAmount=0,normalizedItems=[];
    if(Array.isArray(items)&&items.length){
      // Upsert artikujt nga PricingBridge në tabelën lokale articles (ON CONFLICT DO UPDATE)
      // Kjo siguron që article_id FK të jetë gjithmonë valid
      const articleIdBySku=new Map();
      for(const i of items){
        const sku=trimLen(i.sku||i.article_id?.toString()||"","sku");
        const name=trimLen(i.name||sku,"name");
        const sellPrice=i.cmimi_baze!=null?Number(i.cmimi_baze):(i.cmimi_pas_rabateve!=null?Number(i.cmimi_pas_rabateve):0);
        if(!sku)continue;
        const upsert=await q(
          `INSERT INTO articles(sku,name,sell_price) VALUES($1,$2,$3)
           ON CONFLICT(sku) DO UPDATE SET name=EXCLUDED.name, sell_price=EXCLUDED.sell_price
           RETURNING id`,
          [sku,name,sellPrice]
        );
        articleIdBySku.set(sku,upsert.rows[0].id);
      }
      normalizedItems=items.map(i=>{
        const sku=trimLen(i.sku||i.article_id?.toString()||"","sku");
        const aid=articleIdBySku.get(sku)||Number(i.article_id)||null;
        const qty=Math.max(1,Number(i.quantity||1));
        const discPct=Math.max(0,Math.min(100,Number(i.discount_percent||0)));
        const unitPrice=i.cmimi_baze!=null?Number(i.cmimi_baze):0;
        const lineAmt=i.cmimi_pas_rabateve!=null?Number((Number(i.cmimi_pas_rabateve)*qty).toFixed(2)):Number((unitPrice*qty*(1-discPct/100)).toFixed(2));
        return{article_id:aid,quantity:qty,line_amount:lineAmt,barkod:i.barkod||null,lot_kod:i.lot_kod||null,cmimi_baze:i.cmimi_baze!=null?Number(i.cmimi_baze):null,rabat_pct:i.rabat_pct!=null?Number(i.rabat_pct):null,lejim_pct:i.lejim_pct!=null?Number(i.lejim_pct):null,ddv_pct:i.ddv_pct!=null?Number(i.ddv_pct):null,cmimi_pas_rabateve:i.cmimi_pas_rabateve!=null?Number(i.cmimi_pas_rabateve):null,price_match_level:i.price_match_level||null,sifra_kup:i.sifra_kup||null,sifra_obj:i.sifra_obj!=null?Number(i.sifra_obj):null};
      });
      totalAmount=normalizedItems.reduce((s,it)=>s+Number(it.line_amount||0),0);
    }else{totalAmount=Number(amount||0)}

    // Check agent limit
    try{
      const limits=await q("SELECT period,max_amount FROM agent_limits WHERE user_id=$1",[req.user.id]);
      for(const lim of limits.rows){
        const intervalDays3=lim.period==="monthly"?30:7;
        const spent=await q(`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM requests WHERE agent_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,[req.user.id,intervalDays3]);
        if(Number(spent.rows[0].s)+totalAmount>Number(lim.max_amount))
          return res.status(400).json({error:`Tejkaluat limitin ${lim.period==="monthly"?"mujor":"javor"} (€${Number(lim.max_amount).toFixed(2)}). Keni shpenzuar €${Number(spent.rows[0].s).toFixed(2)} deri tani.`});
      }
    }catch(e){if(e?.message?.includes("limit"))return res.status(400).json({error:e.message});}

    const photo_urls=Array.isArray(req.files)?req.files.map(f=>`/uploads/${f.filename}`):[];
    const needed=await requiredRoleForAmountAsync(totalAmount);
    let assigned_to_user_id=null,assigned_reason=null,assigned_at=null;
    if(needed==="team_lead"){const asg=await resolveTeamLeadAssignee({agentId:req.user.id,divisionId:division_id});assigned_to_user_id=asg.assigneeId;assigned_reason=asg.reason;assigned_at=asg.assigneeId?new Date():null}

    const r=await q(
      `INSERT INTO requests(agent_id,division_id,buyer_id,site_id,article_id,quantity,amount,invoice_ref,reason,photo_url,required_role,assigned_to_user_id,assigned_reason,assigned_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [req.user.id,division_id,buyerIdClean,siteIdClean,Array.isArray(items)&&items.length?null:article_id||null,Array.isArray(items)&&items.length?null:quantity||1,totalAmount,trimLen(invoice_ref,"invoice_ref")||null,trimLen(reason,"reason")||null,photo_urls[0]||null,needed,assigned_to_user_id,assigned_reason,assigned_at]
    );
    const reqId=r.rows[0].id;
    if(normalizedItems.length){const vals=normalizedItems.flatMap(it=>[reqId,it.article_id,it.quantity,it.line_amount,it.barkod,it.lot_kod,it.cmimi_baze,it.rabat_pct,it.lejim_pct,it.ddv_pct,it.cmimi_pas_rabateve,it.price_match_level,it.sifra_kup,it.sifra_obj]);const ph=normalizedItems.map((_,i)=>`($${i*14+1},$${i*14+2},$${i*14+3},$${i*14+4},$${i*14+5},$${i*14+6},$${i*14+7},$${i*14+8},$${i*14+9},$${i*14+10},$${i*14+11},$${i*14+12},$${i*14+13},$${i*14+14})`).join(",");await q(`INSERT INTO request_items(request_id,article_id,quantity,line_amount,barkod,lot_kod,cmimi_baze,rabat_pct,lejim_pct,ddv_pct,cmimi_pas_rabateve,price_match_level,sifra_kup,sifra_obj) VALUES ${ph}`,vals)}
    if(photo_urls.length){const vals=photo_urls.flatMap(u=>[reqId,u]);const ph=photo_urls.map((_,i)=>`($${i*2+1},$${i*2+2})`).join(",");await q(`INSERT INTO request_photos(request_id,url) VALUES ${ph}`,vals)}
    try{
      const{reqRow,items:its,approvals}=await loadRequestForPdf(reqId);
      const to=await approverEmailsFor(reqRow);
      const pdfBuf=await pdfFromRequestRows({reqRow,items:its,approvals,watermark:null});
      const{subject,html}=emailNewRequest({reqRow,totalAmount,requiredRole:needed,photoCount:photo_urls.length,appUrl:APP_URL});
      await sendMail({to,cc:reqRow.agent_email,subject,html,attachments:[{filename:`kerkes-${reqId}.pdf`,content:pdfBuf,contentType:"application/pdf"}]});
      // For avancues: broadcast to all team leads across all divisions
      if(req.user.role==="avancues"){
        const allDivs=await q("SELECT id FROM divisions");
        for(const d of allDivs.rows) sseBroadcastRole(needed,d.id,"new_request",{id:reqId,amount:totalAmount,buyer:reqRow.buyer_name});
      } else {
        sseBroadcastRole(needed,division_id,"new_request",{id:reqId,amount:totalAmount,buyer:reqRow.buyer_name});
      }
    }catch(e){console.error("EMAIL_CREATE_ERR:",e?.message||e);}
    res.json({id:reqId,photos:photo_urls});
  }catch(e){console.error("REQ_CREATE_ERR:",e);res.status(500).json({error:"server",detail:e?.message||""});}
});

app.get("/requests/my",requireAuth,requireRole("agent","avancues","admin"),async(req,res)=>{
  try{
    const{status,leader,date,from,to,page="1",per="10"}=req.query;
    const _page=Math.max(1,parseInt(page,10)||1),_per=Math.min(50,Math.max(1,parseInt(per,10)||10)),offset=(_page-1)*_per;
    const wh=["r.agent_id=$1"],params=[req.user.id];let p=params.length;
    if(status){wh.push(`r.status=$${++p}`);params.push(String(status))}
    if(leader){wh.push(`r.required_role=$${++p}`);params.push(String(leader))}
    if(date){wh.push(`DATE(r.created_at)=$${++p}`);params.push(String(date))}
    else{if(from){wh.push(`r.created_at>=$${++p}::date`);params.push(String(from))}if(to){wh.push(`r.created_at<($${++p}::date+INTERVAL '1 day')`);params.push(String(to))}}
    const whereSql=`WHERE ${wh.join(" AND ")}`;
    const sqlRows=`SELECT r.*,b.code AS buyer_code,b.name AS buyer_name,s.site_name,a.sku,a.name AS article_name,
      COALESCE((SELECT json_agg(json_build_object('article_id',ri.article_id,'sku',aa.sku,'name',aa.name,'quantity',ri.quantity,'line_amount',ri.line_amount) ORDER BY ri.id) FROM request_items ri JOIN articles aa ON aa.id=ri.article_id WHERE ri.request_id=r.id),'[]'::json) AS items,
      CASE WHEN EXISTS(SELECT 1 FROM request_items x WHERE x.request_id=r.id) THEN(SELECT string_agg(aa.sku||' x'||ri.quantity,', ') FROM request_items ri JOIN articles aa ON aa.id=ri.article_id WHERE ri.request_id=r.id) ELSE a.name END AS article_summary,
      COALESCE((SELECT json_agg(p.url ORDER BY p.id) FROM request_photos p WHERE p.request_id=r.id),'[]'::json) AS photos
      FROM requests r JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id LEFT JOIN articles a ON a.id=r.article_id
      ${whereSql} ORDER BY r.id DESC LIMIT $${++p} OFFSET $${++p};`;
    const[rowsRes,totalRes]=await Promise.all([q(sqlRows,[...params,_per,offset]),q(`SELECT COUNT(*)::int AS c FROM requests r ${whereSql};`,params)]);
    res.json({ok:true,rows:rowsRes.rows||[],page:_page,per:_per,total:totalRes.rows?.[0]?.c||0,pages:Math.max(1,Math.ceil((totalRes.rows?.[0]?.c||0)/_per))});
  }catch(e){console.error("MY_HISTORY_ERR:",e);res.status(500).json({ok:false,error:"server_error"});}
});

app.get("/approvals/pending",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{
  const{buyer,agent,amount_min,amount_max,page="1",per="20"}=req.query;
  const _page=Math.max(1,parseInt(page,10)||1),_per=Math.min(100,parseInt(per,10)||20),offset=(_page-1)*_per;
  const wh=["r.status='pending'","r.required_role=$1"];const params=[req.user.role];let p=1;
  // For team_lead: show assigned requests OR avancues requests (from any division)
  if(req.user.role==="team_lead"){
    wh.push(`(r.assigned_to_user_id=$${++p} OR r.agent_id IN (SELECT id FROM users WHERE role='avancues'))`);
    params.push(req.user.id);
  }
  // For division_manager: show division requests OR avancues requests
  else if(req.user.role==="division_manager"){
    wh.push(`(r.division_id=$${++p} OR r.agent_id IN (SELECT id FROM users WHERE role='avancues'))`);
    params.push(req.user.division_id);
  }
  if(buyer){wh.push(`(b.code ILIKE $${++p} OR b.name ILIKE $${++p})`);params.push(`%${buyer}%`,`%${buyer}%`);p++}
  if(agent){wh.push(`(u.first_name ILIKE $${++p} OR u.last_name ILIKE $${++p})`);params.push(`%${agent}%`,`%${agent}%`);p++}
  if(amount_min){wh.push(`r.amount>=$${++p}`);params.push(Number(amount_min))}
  if(amount_max){wh.push(`r.amount<=$${++p}`);params.push(Number(amount_max))}
  const whereSql=`WHERE ${wh.join(" AND ")}`;
  const sqlRows=`SELECT r.*,u.first_name,u.last_name,a.sku,a.name AS article_name,b.code AS buyer_code,b.name AS buyer_name,s.site_name,
    COALESCE((SELECT json_agg(p.url ORDER BY p.id) FROM request_photos p WHERE p.request_id=r.id),'[]'::json) AS photos,
    COALESCE((SELECT json_agg(json_build_object('article_id',ri.article_id,'sku',aa.sku,'name',aa.name,'quantity',ri.quantity,'line_amount',ri.line_amount) ORDER BY ri.id) FROM request_items ri JOIN articles aa ON aa.id=ri.article_id WHERE ri.request_id=r.id),'[]'::json) AS items,
    CASE WHEN EXISTS(SELECT 1 FROM request_items x WHERE x.request_id=r.id) THEN(SELECT string_agg(aa.sku||' x'||ri.quantity,', ') FROM request_items ri JOIN articles aa ON aa.id=ri.article_id WHERE ri.request_id=r.id) ELSE a.name END AS article_summary
    FROM requests r JOIN users u ON u.id=r.agent_id JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id LEFT JOIN articles a ON a.id=r.article_id
    ${whereSql} ORDER BY r.created_at DESC LIMIT $${++p} OFFSET $${++p}`;
  const[rows,total]=await Promise.all([q(sqlRows,[...params,_per,offset]),q(`SELECT COUNT(*)::int AS c FROM requests r JOIN users u ON u.id=r.agent_id JOIN buyers b ON b.id=r.buyer_id ${whereSql}`,params)]);
  res.json({rows:rows.rows,total:total.rows[0].c,page:_page,per:_per,pages:Math.max(1,Math.ceil(total.rows[0].c/_per))});
});

const histQ=(extra="")=>`SELECT a.request_id AS id,a.action,a.comment,a.acted_at,a.approver_role,r.amount,r.status,r.required_role,r.division_id,u.first_name AS agent_first,u.last_name AS agent_last,b.code AS buyer_code,b.name AS buyer_name,s.site_name,COALESCE((SELECT json_agg(p.url ORDER BY p.id) FROM request_photos p WHERE p.request_id=r.id),'[]'::json) AS photos FROM approvals a JOIN requests r ON r.id=a.request_id JOIN users u ON u.id=r.agent_id JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id ${extra} ORDER BY a.acted_at DESC`;
app.get("/approvals/my-history",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{const r=await q(histQ("WHERE a.approver_id=$1"),[req.user.id]);res.json(r.rows)});
app.get("/approvals/role-history",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{const role=req.user.role,whereDiv=role==="sales_director"?"":"AND r.division_id=$2",params=role==="sales_director"?[role]:[role,req.user.division_id];const r=await q(histQ(`WHERE a.approver_role=$1 ${whereDiv}`),params);res.json(r.rows)});
app.get("/approvals/all-history",requireAuth,requireRole("sales_director"),async(_,res)=>{try{const r=await q(histQ(""));res.json(r.rows)}catch{res.status(500).json({error:"server_error"})}});
app.get("/approvals/teamlead-history",requireAuth,requireRole("division_manager"),async(req,res)=>{try{const r=await q(histQ("WHERE a.approver_role='team_lead' AND r.division_id=$1"),[req.user.division_id]);res.json(r.rows)}catch{res.status(500).json({error:"server_error"})}});

app.get("/requests/:id/photos",requireAuth,async(req,res)=>{
  try{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});const r0=await q("SELECT id,agent_id,division_id,required_role,assigned_to_user_id FROM requests WHERE id=$1",[id]);if(!r0.rowCount)return res.status(404).json({error:"not_found"});const reqRow=r0.rows[0];if((req.user.role==="agent"||req.user.role==="avancues")&&reqRow.agent_id!==req.user.id)return res.status(403).json({error:"forbidden"});if((req.user.role==="team_lead"||req.user.role==="division_manager")&&reqRow.division_id!==req.user.division_id){const agentRole=await q("SELECT role FROM users WHERE id=$1",[reqRow.agent_id]);if(agentRole.rows[0]?.role!=="avancues")return res.status(403).json({error:"forbidden"})}if(req.user.role==="team_lead"){const agentRole2=await q("SELECT role FROM users WHERE id=$1",[reqRow.agent_id]);if(agentRole2.rows[0]?.role!=="avancues"){const assigneeId=reqRow.assigned_to_user_id??(await resolveTeamLeadAssignee({agentId:reqRow.agent_id,divisionId:reqRow.division_id})).assigneeId;if(!assigneeId||assigneeId!==req.user.id)return res.status(403).json({error:"forbidden"})}}const ph=await q("SELECT url FROM request_photos WHERE request_id=$1 ORDER BY id",[id]);res.json((ph.rows||[]).map(x=>x.url))}catch{res.status(500).json({error:"server_error"})}
});

app.get("/requests/:id/pdf",requireAuth,async(req,res)=>{
  try{const id=Number(req.params.id);if(!id)return res.status(400).json({error:"id"});const{reqRow,items,approvals}=await loadRequestForPdf(id);if((req.user.role==="agent"||req.user.role==="avancues")&&reqRow.agent_id!==req.user.id)return res.status(403).json({error:"forbidden"});if((req.user.role==="team_lead"||req.user.role==="division_manager")&&reqRow.division_id!==req.user.division_id){const agentRole=await q("SELECT role FROM users WHERE id=$1",[reqRow.agent_id]);if(agentRole.rows[0]?.role!=="avancues")return res.status(403).json({error:"forbidden"})}if(req.user.role==="team_lead"){const agentRole2=await q("SELECT role FROM users WHERE id=$1",[reqRow.agent_id]);if(agentRole2.rows[0]?.role!=="avancues"){const assigneeId=reqRow.assigned_to_user_id??(await resolveTeamLeadAssignee({agentId:reqRow.agent_id,divisionId:reqRow.division_id})).assigneeId;if(!assigneeId||assigneeId!==req.user.id)return res.status(403).json({error:"forbidden"})}}const watermark=(reqRow.status==="approved"||reqRow.status==="rejected")?reqRow.status:null;const pdf=await pdfFromRequestRows({reqRow,items,approvals,watermark});res.setHeader("Content-Type","application/pdf");if(req.query.download)res.setHeader("Content-Disposition",`attachment; filename=kerkes-${id}.pdf`);return res.send(pdf)}catch(e){console.error("[PDF ERROR]",e?.message,e?.stack?.split("\n")[1]);return res.status(500).json({error:"pdf_error",detail:e?.message})}
});

async function actOnRequest({reqId,action,comment,user}){
  if(!["approved","rejected"].includes(action))throw new Error("bad_action");
  // Transaction + SELECT FOR UPDATE eliminon race condition
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const r=await client.query("SELECT id,status,required_role,division_id,amount,agent_id,assigned_to_user_id FROM requests WHERE id=$1 FOR UPDATE",[reqId]);
    if(!r.rowCount){ await client.query("ROLLBACK"); throw new Error("not_found"); }
    const row=r.rows[0];
    if(row.status!=="pending"){ await client.query("ROLLBACK"); throw new Error("already_decided"); }
    if(row.required_role!==user.role){ await client.query("ROLLBACK"); throw new Error("wrong_role"); }

    // Check if request is from avancues user
    const agentCheck=await client.query("SELECT role FROM users WHERE id=$1",[row.agent_id]);
    const isAvancuesRequest=agentCheck.rows[0]?.role==="avancues";

    if(isAvancuesRequest){
      // For avancues requests: any team_lead/division_manager/sales_director can approve (no division restriction)
      // No division check or assignee check needed
    } else {
      // Original agent logic: division-based restrictions
      if((user.role==="team_lead"||user.role==="division_manager")&&row.division_id!==user.division_id){ await client.query("ROLLBACK"); throw new Error("forbidden"); }
      if(user.role==="team_lead"){const assigneeId=row.assigned_to_user_id??(await resolveTeamLeadAssignee({agentId:row.agent_id,divisionId:row.division_id})).assigneeId;if(!assigneeId||assigneeId!==user.id){ await client.query("ROLLBACK"); throw new Error("forbidden"); }}
    }

    await client.query("INSERT INTO approvals(request_id,approver_id,approver_role,action,comment,acted_at) VALUES($1,$2,$3,$4,$5,NOW())",[reqId,user.id,user.role,action,trimLen(comment,"comment")||null]);
    await client.query("UPDATE requests SET status=$1 WHERE id=$2",[action,reqId]);
    await client.query("COMMIT");
    client.release();
    sseSend(row.agent_id,"request_decided",{id:reqId,action});
    try{
      const{reqRow,items,approvals}=await loadRequestForPdf(reqId);
      const pdfBuf=await pdfFromRequestRows({reqRow,items,approvals,watermark:action});
      const approverName=`${user.first_name||""} ${user.last_name||""}`.trim();
      const{subject,html}=emailApprovalResult({reqRow,action,approverName,approverRole:user.role,comment,appUrl:APP_URL});
      // For avancues: send to lejimet@migros-group.com, CC agent + approver only (no other team leads notified)
      await sendMail({to:process.env.LEJIMET_EMAIL||"lejimet@migros-group.com",cc:[reqRow.agent_email,user.email].filter(Boolean),subject,html,attachments:[{filename:`kerkes-${reqId}.pdf`,content:pdfBuf,contentType:"application/pdf"}]});
    }catch(e){console.error("FINAL_MAIL_ERR:",e?.message||e);}
    return{ok:true};
  } catch(e) {
    try { await client.query("ROLLBACK"); client.release(); } catch {}
    throw e;
  }
}

app.post("/approvals/act",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{
  try{const id=Number(req.body?.id),action=String(req.body?.action||"").toLowerCase(),comment=req.body?.comment||"";if(!id)return res.status(400).json({error:"id"});res.json(await actOnRequest({reqId:id,action,comment,user:req.user}))}
  catch(e){const map={not_found:404,wrong_role:403,forbidden:403,already_decided:409,bad_action:400};res.status(map[e.message]||500).json({error:e.message})}
});
app.post("/approvals/:id/approved",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{try{res.json(await actOnRequest({reqId:Number(req.params.id),action:"approved",comment:req.body?.comment||"",user:req.user}))}catch(e){const map={not_found:404,wrong_role:403,forbidden:403,already_decided:409};res.status(map[e.message]||500).json({error:e.message})}});
app.post("/approvals/:id/rejected",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{try{res.json(await actOnRequest({reqId:Number(req.params.id),action:"rejected",comment:req.body?.comment||"",user:req.user}))}catch(e){const map={not_found:404,wrong_role:403,forbidden:403,already_decided:409};res.status(map[e.message]||500).json({error:e.message})}});

/* ─── Start ─── */
/* ─────────────── ADMIN SYNC ENDPOINT ─────────────── */
app.post("/ocr/lot", requireAuth, async (req, res) => {
  try {
    const { image } = req.body ?? {};
    if (!image) return res.status(400).json({ error: "Mungon imazhi" });

    const response = await fetch("http://ocr:8001/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: "OCR deshtoi", detail: data.error });

    const text = (data.text || "").replace(/\s+/g, " ").trim();
    console.log("[OCR PaddleOCR]", text.slice(0, 80));

    if (!text) return res.json({ text: "", confidence: 0, message: "Nuk u gjet tekst. Provo serish me foto me te qarte." });
    return res.json({ text, confidence: data.confidence || 90 });
  } catch (err) {
    console.error("[OCR PaddleOCR]", err.message);
    res.status(500).json({ error: "OCR deshtoi", detail: err.message });
  }
});


app.post("/admin/pb-sync", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    console.log("[ADMIN] Manual PricingBridge sync triggered");
    const result = await runFullSync();
    await q("INSERT INTO audit_log(user_id,user_email,action,entity,detail,ip) VALUES($1,$2,$3,$4,$5,$6)",
      [req.user.id, req.user.email, "pb_sync", "system", JSON.stringify(result), getIp(req)]);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// KTHIMI PA AFAT — Return Without Term Module
// ════════════════════════════════════════════════════════════════
async function runKthimiMigration() {
  try {
    await q(`CREATE TABLE IF NOT EXISTS return_requests (id BIGSERIAL PRIMARY KEY, financial_approval_id INT NOT NULL REFERENCES requests(id) ON DELETE RESTRICT, agent_id INT NOT NULL REFERENCES users(id), buyer_id INT REFERENCES buyers(id), site_id INT REFERENCES buyer_sites(id), division_id INT REFERENCES divisions(id), status req_status DEFAULT 'pending', required_role user_role NOT NULL, total_value NUMERIC(12,2) NOT NULL DEFAULT 0, comment TEXT, reason TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS return_request_lines (id BIGSERIAL PRIMARY KEY, return_request_id BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE, request_item_id BIGINT REFERENCES request_items(id), article_id INT REFERENCES articles(id), sku TEXT NOT NULL, name TEXT NOT NULL, lot_kod TEXT, final_price NUMERIC(18,6) NOT NULL DEFAULT 0, approved_qty INT NOT NULL DEFAULT 0, already_returned_qty INT NOT NULL DEFAULT 0, remaining_qty INT NOT NULL DEFAULT 0, requested_return_qty INT NOT NULL DEFAULT 0, is_removed BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS return_approvals (id BIGSERIAL PRIMARY KEY, return_id BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE, approver_id INT NOT NULL REFERENCES users(id), approver_role user_role NOT NULL, action req_status NOT NULL, comment TEXT, acted_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS idx_return_requests_agent    ON return_requests(agent_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_return_requests_status   ON return_requests(status)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_return_requests_approval ON return_requests(financial_approval_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_return_lines_return      ON return_request_lines(return_request_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_return_approvals_return  ON return_approvals(return_id)`);
    console.log("[kthimi] Migration OK");
  } catch(e) { console.error("[kthimi] Migration error:", e?.message); }
}
runKthimiMigration();

async function loadFinancialApprovalForReturn(reqId) {
  const r = await q(`SELECT r.id,r.status,r.amount,r.required_role,r.division_id,r.agent_id,r.buyer_id,r.site_id,b.code AS buyer_code,b.name AS buyer_name,s.site_name,u.first_name AS agent_first,u.last_name AS agent_last FROM requests r JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id JOIN users u ON u.id=r.agent_id WHERE r.id=$1 AND r.status='approved'`, [reqId]);
  if (!r.rowCount) return null;
  const req = r.rows[0];
  const items = await q(`SELECT ri.id AS request_item_id,ri.article_id,ri.lot_kod,ri.barkod,ri.quantity AS approved_qty,ri.line_amount,ri.cmimi_pas_rabateve AS final_price,ri.lejim_pct,a.sku,a.name,COALESCE((SELECT SUM(rl.requested_return_qty) FROM return_request_lines rl JOIN return_requests rr ON rr.id=rl.return_request_id WHERE rl.request_item_id=ri.id AND rl.is_removed=FALSE AND rr.status!='rejected'),0)::int AS already_returned_qty FROM request_items ri JOIN articles a ON a.id=ri.article_id WHERE ri.request_id=$1 ORDER BY ri.id`, [reqId]);
  const lines = items.rows.map(row => ({ ...row, final_price: Number(row.final_price || (row.line_amount / Math.max(row.approved_qty,1)) || 0), remaining_qty: Math.max(0, row.approved_qty - row.already_returned_qty) }));
  return { req, lines };
}

app.get("/returns/approvals/search", requireAuth, requireRole("agent","avancues","admin"), async(req,res)=>{
  try {
    const { q: query, id } = req.query;
    if (id) {
      const numId=Number(id); if(!numId) return res.status(400).json({error:"ID invalid"});
      const data=await loadFinancialApprovalForReturn(numId);
      if(!data) return res.status(404).json({error:"Aprovimi financiar nuk u gjet ose nuk është aprovuar"});
      return res.json([data.req]);
    }
    const search=(query||"").trim(); if(!search) return res.json([]);
    const user=req.user;
    const divFilter=user.role==="admin"?"":"AND r.division_id=$2";
    const params=user.role==="admin"?[`%${search}%`]:[`%${search}%`,user.division_id];
    const r=await q(`SELECT r.id,r.amount,r.created_at,b.code AS buyer_code,b.name AS buyer_name,s.site_name,u.first_name AS agent_first,u.last_name AS agent_last,r.required_role FROM requests r JOIN buyers b ON b.id=r.buyer_id LEFT JOIN buyer_sites s ON s.id=r.site_id JOIN users u ON u.id=r.agent_id WHERE r.status='approved' ${divFilter} AND (b.name ILIKE $1 OR b.code ILIKE $1 OR s.site_name ILIKE $1 OR r.id::text ILIKE $1 OR EXISTS(SELECT 1 FROM request_items ri JOIN articles a ON a.id=ri.article_id WHERE ri.request_id=r.id AND (a.sku ILIKE $1 OR a.name ILIKE $1))) AND NOT EXISTS(SELECT 1 FROM return_requests rr WHERE rr.financial_approval_id=r.id AND rr.status!='rejected') ORDER BY r.id DESC LIMIT 20`,params);
    res.json(r.rows);
  } catch(e){console.error("[returns/search]",e?.message);res.status(500).json({error:"server"});}
});

app.get("/returns/approvals/:id", requireAuth, requireRole("agent","avancues","admin"), async(req,res)=>{
  try {
    const numId=Number(req.params.id); if(!numId) return res.status(400).json({error:"ID invalid"});
    const data=await loadFinancialApprovalForReturn(numId);
    if(!data) return res.status(404).json({error:"Aprovimi financiar nuk u gjet ose nuk është aprovuar"});
    res.json(data);
  } catch(e){console.error("[returns/approvals/:id]",e?.message);res.status(500).json({error:"server"});}
});

app.post("/returns", requireAuth, requireRole("agent","avancues","admin"), async(req,res)=>{
  const client=await getClient();
  try {
    const{financial_approval_id,comment,reason,lines}=req.body;
    const faId=cleanId(financial_approval_id); if(!faId) return res.status(400).json({error:"financial_approval_id mungon"});
    if(!Array.isArray(lines)||!lines.length) return res.status(400).json({error:"Linjat mungojnë"});
    const activeLines=lines.filter(l=>!l.is_removed&&Number(l.requested_return_qty)>0);
    if(!activeLines.length) return res.status(400).json({error:"Duhet të ketë të paktën një linjë aktive"});
    const data=await loadFinancialApprovalForReturn(faId);
    if(!data) return res.status(404).json({error:"Aprovimi financiar nuk u gjet"});
    const existing=await q("SELECT id FROM return_requests WHERE financial_approval_id=$1 AND status!='rejected'",[faId]);
    if(existing.rowCount) return res.status(409).json({error:"Ky aprovim financiar tashmë ka një kërkesë kthimi"});
    for(const line of activeLines){
      const srcLine=data.lines.find(l=>Number(l.request_item_id)===Number(line.request_item_id));
      if(!srcLine) return res.status(400).json({error:`Linja ${line.request_item_id} nuk u gjet`});
      const qty=Number(line.requested_return_qty);
      if(!Number.isFinite(qty)||qty<=0) return res.status(400).json({error:`Sasia e pavlefshme për ${srcLine.sku}`});
      if(qty>srcLine.remaining_qty) return res.status(400).json({error:`Sasia e kërkuar (${qty}) tejkalon të mbetur (${srcLine.remaining_qty}) për ${srcLine.sku}`});
    }
    const totalValue=activeLines.reduce((sum,l)=>{const s=data.lines.find(dl=>Number(dl.request_item_id)===Number(l.request_item_id));return sum+(s?.final_price||0)*Number(l.requested_return_qty);},0);
    const requiredRole=data.req.required_role;
    await client.query("BEGIN");
    const rr=await client.query(`INSERT INTO return_requests(financial_approval_id,agent_id,buyer_id,site_id,division_id,status,required_role,total_value,comment,reason) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9) RETURNING id`,[faId,req.user.id,data.req.buyer_id,data.req.site_id,data.req.division_id,requiredRole,totalValue,trimLen(comment,"comment")||null,trimLen(reason,"reason")||null]);
    const returnId=rr.rows[0].id;
    for(const line of lines){
      const srcLine=data.lines.find(l=>Number(l.request_item_id)===Number(line.request_item_id));
      if(!srcLine) continue;
      const isRemoved=!!line.is_removed||Number(line.requested_return_qty)<=0;
      const qty=isRemoved?0:Number(line.requested_return_qty);
      await client.query(`INSERT INTO return_request_lines(return_request_id,request_item_id,article_id,sku,name,lot_kod,final_price,approved_qty,already_returned_qty,remaining_qty,requested_return_qty,is_removed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[returnId,srcLine.request_item_id,srcLine.article_id,srcLine.sku,srcLine.name,srcLine.lot_kod||null,srcLine.final_price,srcLine.approved_qty,srcLine.already_returned_qty,srcLine.remaining_qty,qty,isRemoved]);
    }
    await client.query("COMMIT");
    try {
      const toEmails=await approverEmailsFor({...data.req,id:faId,required_role:requiredRole});
      const{subject,html}=emailNewRequest({reqRow:{...data.req,id:returnId,reason},totalAmount:totalValue,requiredRole,photoCount:0,appUrl:APP_URL});
      await sendMail({to:toEmails,subject:subject.replace("[Fin Approvals]","[Kthim pa Afat]"),html});
    } catch(e){console.warn("[returns] email:",e?.message);}
    await audit(req,"create","return_request",returnId,{financial_approval_id:faId,total_value:totalValue});
    res.json({id:returnId,ok:true});
  } catch(e){await client.query("ROLLBACK").catch(()=>{});console.error("[returns POST]",e?.message);res.status(500).json({error:"server"});}
  finally{client.release();}
});

app.get("/returns/my", requireAuth, requireRole("agent","avancues","admin"), async(req,res)=>{
  try {
    const r=await q(`SELECT rr.id,rr.financial_approval_id,rr.status,rr.required_role,rr.total_value,rr.comment,rr.reason,rr.created_at,b.code AS buyer_code,b.name AS buyer_name,s.site_name,COALESCE((SELECT json_agg(json_build_object('id',rl.id,'sku',rl.sku,'name',rl.name,'lot_kod',rl.lot_kod,'final_price',rl.final_price,'approved_qty',rl.approved_qty,'already_returned_qty',rl.already_returned_qty,'remaining_qty',rl.remaining_qty,'requested_return_qty',rl.requested_return_qty,'is_removed',rl.is_removed) ORDER BY rl.id) FROM return_request_lines rl WHERE rl.return_request_id=rr.id),'[]'::json) AS lines,ra.action AS last_action,ra.comment AS last_comment,u2.first_name||' '||u2.last_name AS last_approver FROM return_requests rr JOIN buyers b ON b.id=rr.buyer_id LEFT JOIN buyer_sites s ON s.id=rr.site_id LEFT JOIN LATERAL(SELECT * FROM return_approvals WHERE return_id=rr.id ORDER BY acted_at DESC LIMIT 1) ra ON TRUE LEFT JOIN users u2 ON u2.id=ra.approver_id WHERE rr.agent_id=$1 ORDER BY rr.id DESC`,[req.user.id]);
    res.json(r.rows);
  } catch(e){console.error("[returns/my]",e?.message);res.status(500).json({error:"server"});}
});

app.get("/returns/pending", requireAuth, requireRole("team_lead","division_manager","sales_director"), async(req,res)=>{
  try {
    const user=req.user;
    const isSd=user.role==="sales_director";
    const divFilter=isSd?"":"AND rr.division_id=$2";
    const approverParam=isSd?"$2":"$3";
    const params=isSd?[user.role,user.id]:[user.role,user.division_id,user.id];
    const r=await q(`SELECT rr.id,rr.financial_approval_id,rr.status,rr.required_role,rr.total_value,rr.comment,rr.reason,rr.created_at,b.code AS buyer_code,b.name AS buyer_name,s.site_name,u.first_name AS agent_first,u.last_name AS agent_last,COALESCE((SELECT json_agg(json_build_object('id',rl.id,'sku',rl.sku,'name',rl.name,'lot_kod',rl.lot_kod,'final_price',rl.final_price,'approved_qty',rl.approved_qty,'remaining_qty',rl.remaining_qty,'requested_return_qty',rl.requested_return_qty,'is_removed',rl.is_removed) ORDER BY rl.id) FROM return_request_lines rl WHERE rl.return_request_id=rr.id AND rl.is_removed=FALSE),'[]'::json) AS lines FROM return_requests rr JOIN buyers b ON b.id=rr.buyer_id LEFT JOIN buyer_sites s ON s.id=rr.site_id JOIN users u ON u.id=rr.agent_id WHERE rr.status='pending' AND rr.required_role=$1 ${divFilter} AND NOT EXISTS(SELECT 1 FROM return_approvals ra WHERE ra.return_id=rr.id AND ra.approver_id=${approverParam}) ORDER BY rr.id ASC`,params);
    res.json(r.rows);
  } catch(e){console.error("[returns/pending]",e?.message);res.status(500).json({error:"server"});}
});

app.get("/returns/history", requireAuth, requireRole("team_lead","division_manager","sales_director","admin"), async(req,res)=>{
  try {
    const user=req.user;
    const divFilter=(user.role==="sales_director"||user.role==="admin")?"":"AND rr.division_id=$1";
    const params=(user.role==="sales_director"||user.role==="admin")?[]:[user.division_id];
    const r=await q(`SELECT rr.id,rr.financial_approval_id,rr.status,rr.required_role,rr.total_value,rr.comment,rr.reason,rr.created_at,b.code AS buyer_code,b.name AS buyer_name,s.site_name,u.first_name AS agent_first,u.last_name AS agent_last,ra.action AS last_action,ra.comment AS last_comment,ra.acted_at,u2.first_name||' '||u2.last_name AS last_approver FROM return_requests rr JOIN buyers b ON b.id=rr.buyer_id LEFT JOIN buyer_sites s ON s.id=rr.site_id JOIN users u ON u.id=rr.agent_id LEFT JOIN LATERAL(SELECT * FROM return_approvals WHERE return_id=rr.id ORDER BY acted_at DESC LIMIT 1) ra ON TRUE LEFT JOIN users u2 ON u2.id=ra.approver_id WHERE rr.status!='pending' ${divFilter} ORDER BY rr.id DESC LIMIT 100`,params);
    res.json(r.rows);
  } catch(e){console.error("[returns/history]",e?.message);res.status(500).json({error:"server"});}
});

async function actOnReturn({returnId,action,comment,user}){
  if(!["approved","rejected"].includes(action)) throw new Error("bad_action");
  const rr=await q("SELECT * FROM return_requests WHERE id=$1",[returnId]);
  if(!rr.rowCount) throw new Error("not_found");
  const ret=rr.rows[0];
  if(ret.status!=="pending") throw new Error("already_decided");
  if(ret.required_role!==user.role) throw new Error("wrong_role");
  const client=await getClient();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE return_requests SET status=$1 WHERE id=$2",[action,returnId]);
    await client.query("INSERT INTO return_approvals(return_id,approver_id,approver_role,action,comment,acted_at) VALUES($1,$2,$3,$4,$5,NOW())",[returnId,user.id,user.role,action,trimLen(comment,"comment")||null]);
    await client.query("COMMIT");
    try {
      const agentR=await q("SELECT email FROM users WHERE id=$1",[ret.agent_id]);
      const buyerR=await q("SELECT code,name FROM buyers WHERE id=$1",[ret.buyer_id]);
      const buyer=buyerR.rows[0];
      const approverName=`${user.first_name||""} ${user.last_name||""}`.trim();
      const{subject,html}=emailApprovalResult({reqRow:{id:returnId,amount:ret.total_value,buyer_code:buyer?.code,buyer_name:buyer?.name},action,approverName,approverRole:user.role,comment,appUrl:APP_URL});
      // Generate PDF and attach to email
      let attachments=[];
      try {
        const{retRow,lines,approvals:retApprovals}=await loadReturnForPdf(returnId);
        const pdfBuf=await pdfFromReturnRows({retRow,lines,approvals:retApprovals,watermark:action});
        attachments=[{filename:`kthim-${returnId}.pdf`,content:pdfBuf,contentType:"application/pdf"}];
      } catch(pe){console.warn("[returns/act] pdf gen:",pe?.message);}
      await sendMail({to:[agentR.rows[0]?.email,process.env.LEJIMET_EMAIL].filter(Boolean),subject:subject.replace("[Fin Approvals]","[Kthim pa Afat]"),html,attachments});
    } catch(e){console.warn("[returns/act] email:",e?.message);}
    return{ok:true,action};
  } catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}
  finally{client.release();}
}

app.post("/returns/:id/approved",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{
  try{res.json(await actOnReturn({returnId:Number(req.params.id),action:"approved",comment:req.body?.comment||"",user:req.user}));}
  catch(e){const map={not_found:404,wrong_role:403,forbidden:403,already_decided:409};res.status(map[e.message]||500).json({error:e.message});}
});
app.post("/returns/:id/rejected",requireAuth,requireRole("team_lead","division_manager","sales_director"),async(req,res)=>{
  try{res.json(await actOnReturn({returnId:Number(req.params.id),action:"rejected",comment:req.body?.comment||"",user:req.user}));}
  catch(e){const map={not_found:404,wrong_role:403,forbidden:403,already_decided:409};res.status(map[e.message]||500).json({error:e.message});}
});

// Startup security checks
const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET || JWT_SECRET.includes("ndrysho") || JWT_SECRET.length < 32) {
  console.error("[SECURITY] CRITICAL: JWT_SECRET is weak or default! Change it in server/.env");
  if (process.env.NODE_ENV === "production") process.exit(1);
}
const DB_PASS = process.env.DATABASE_URL || "";
if (DB_PASS.includes("postgres:postgres")) {
  console.warn("[SECURITY] WARNING: Using default PostgreSQL password. Change POSTGRES_PASSWORD in docker-compose.yml");
}

const PORT=Number(process.env.PORT||8080);
app.listen(PORT,()=>{
  console.log(`API on ${PORT}`);
  startCronJobs();
  // Sync automatik gjatë startit (pas 3 sekondash për të lënë DB të jetë gati)
  setTimeout(async () => {
    try { await runFullSync(); } catch(e) { console.error("[STARTUP] pbSync error:", e.message); }
  }, 3000);
  // Warm threshold cache
  getThresholds().catch(()=>{});
});
