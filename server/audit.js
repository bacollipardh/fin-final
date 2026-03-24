import { q } from "./db.js";

export async function audit(req, action, entity, entityId, detail = {}) {
  try {
    await q(
      "INSERT INTO audit_log(user_id,user_email,action,entity,entity_id,detail,ip) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        req?.user?.id || null,
        req?.user?.email || null,
        action,
        entity || null,
        entityId || null,
        JSON.stringify(detail),
        req?.ip || req?.headers?.["x-forwarded-for"] || null,
      ]
    );
  } catch (e) {
    console.error("audit log error:", e.message);
  }
}
