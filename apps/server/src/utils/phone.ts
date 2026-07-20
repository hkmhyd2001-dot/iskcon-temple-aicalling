// E.164 helpers. A dialed number must look like +<8..15 digits>.
const E164 = /^\+\d{8,15}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

// Normalize loose input into E.164. Empty / placeholder ("+91XXXX") → "".
export function normalizePhone(raw: string | undefined | null): string {
  const s = (raw ?? "").trim();
  if (!s || /X/i.test(s)) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (hasPlus) return "+" + digits;
  if (digits.length === 10) return "+91" + digits; // bare Indian mobile
  return "+" + digits;
}
