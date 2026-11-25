// Display helpers shared by server components.
export function formatMoney(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${currency} ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const AVATAR_COLORS = [
  "bg-teal-600", "bg-emerald-600", "bg-cyan-600", "bg-sky-600",
  "bg-indigo-500", "bg-violet-500", "bg-rose-500", "bg-amber-600",
  "bg-lime-600", "bg-orange-500",
];

/** Deterministic avatar background class from a name/email string. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
