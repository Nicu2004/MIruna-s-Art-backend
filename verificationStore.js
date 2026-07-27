const codes = new Map(); // email -> { code, expiresAt }

const CODE_TTL_MS = 10 * 60 * 1000;

export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function storeCode(email) {
  const code = generateCode();
  codes.set(email, { code, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export function verifyCode(email, code) {
  const entry = codes.get(email);

  if (!entry) return { valid: false, reason: "not_found" };
  if (entry.code !== code) return { valid: false, reason: "wrong_code" };
  if (Date.now() > entry.expiresAt) {
    codes.delete(email);
    return { valid: false, reason: "expired" };
  }

  return { valid: true };
}

export function consumeCode(email) {
  codes.delete(email);
}
