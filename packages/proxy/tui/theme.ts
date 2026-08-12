/** SuperCompress paper brand — same tokens as supercompress.dev */
export const BRAND = "#2563eb"
export const BRAND_SOFT = "#dbeafe"
export const BRAND_INK = "#1e40af"
export const INK = "#0a0a0a"
export const MUTED = "#6b6b6b"
export const PANEL = "#f2f1ee"
export const BG = "#fbfbf8"
export const OK = "#059669"
export const WARN = "#d97706"
export const ERR = "#dc2626"
export const RULE = "#edede9"
export const MARK = "#ffffff"

export function fmt(n: number) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`
  return String(Math.round(v))
}

export function meterBar(pct: number, width = 28) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}
