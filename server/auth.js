import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import * as OTPLib from "otplib";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const ACCESS_TTL  = "8h";
const REFRESH_TTL = "30d";

export const signJWT = (user) =>
  jwt.sign({ id: user.id, role: user.role, division_id: user.division_id, email: user.email, first_name: user.first_name, last_name: user.last_name },
    process.env.JWT_SECRET, { expiresIn: ACCESS_TTL, issuer: "fin-approvals" });

export const signRefresh = (userId) =>
  jwt.sign({ id: userId, type: "refresh" }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "_refresh", { expiresIn: REFRESH_TTL });

export const verifyRefresh = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "_refresh");

export const hash    = (p) => bcrypt.hash(p, 10);
export const compare = (p, h) => bcrypt.compare(p, h);

export const requireAuth = (req, res, next) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch (e) {
    if (e.name === "TokenExpiredError") return res.status(401).json({ error: "token_expired" });
    return res.status(401).json({ error: "Invalid token" });
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  next();
};

// TOTP
export const totpLib = OTPLib.authenticator;
export const generateTotpSecret = () => totpLib.generateSecret();
export const verifyTotp = (token, secret) => { try { return totpLib.verify({ token, secret }); } catch { return false; } };

// Device fingerprint for session/suspicious-login detection
export const deviceFingerprint = (req) => {
  const raw = `${req.headers["user-agent"]||""}|${req.headers["accept-language"]||""}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
};
