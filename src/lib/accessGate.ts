export const ACCESS_COOKIE_NAME = "qmk_gate_access";
export const SHARE_ACCESS_COOKIE_NAME = "qmk_share_gate_access";

export function getAccessGateCode() {
  const code = process.env.ACCESS_GATE_CODE?.trim();
  return code && code.length > 0 ? code : null;
}

export function getShareGateCode() {
  const code = process.env.SHARE_GATE_CODE?.trim();
  if (code && code.length > 0) {
    return code;
  }
  return getAccessGateCode();
}

export function getAccessGateTtlDays() {
  const raw = process.env.ACCESS_GATE_TTL_DAYS?.trim();
  const parsed = raw ? Number(raw) : 30;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.floor(parsed);
}

export function getShareGateTtlDays() {
  const raw = process.env.SHARE_GATE_TTL_DAYS?.trim();
  const parsed = raw ? Number(raw) : getAccessGateTtlDays();
  if (!Number.isFinite(parsed) || parsed <= 0) return getAccessGateTtlDays();
  return Math.floor(parsed);
}
