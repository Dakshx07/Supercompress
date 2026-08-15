/**
 * SuperCompress TUI colors — follow the terminal (dark/light).
 * Override: SUPERCOMPRESS_THEME=dark|light
 */
import { execFileSync } from "node:child_process"

function detectDark(): boolean {
  const forced = String(process.env.SUPERCOMPRESS_THEME || "").trim().toLowerCase()
  if (forced === "light") return false
  if (forced === "dark") return true

  // COLORFGBG=fg;bg — bg 0–7 are dark ANSI colors (common dark terminals)
  const cfg = String(process.env.COLORFGBG || "").trim()
  if (cfg) {
    const parts = cfg.split(";")
    const bg = Number(parts[parts.length - 1])
    if (Number.isFinite(bg)) return bg >= 0 && bg < 8
  }

  // macOS system appearance (Terminal / iTerm often omit COLORFGBG)
  if (process.platform === "darwin") {
    try {
      const style = execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      if (style === "Dark") return true
      return false
    } catch {
      /* Light or unset */
    }
  }

  // Coding CLIs default dark when we can't tell
  return true
}

const DARK = detectDark()

/** Brand blue stays constant; surfaces/ink flip with terminal. */
export const BRAND = "#3b82f6"
export const BRAND_SOFT = DARK ? "#1e3a5f" : "#dbeafe"
export const BRAND_INK = DARK ? "#93c5fd" : "#1e40af"
export const INK = DARK ? "#f4f4ef" : "#0a0a0a"
export const MUTED = DARK ? "#9a9790" : "#6b6b6b"
export const PANEL = DARK ? "#161614" : "#f2f1ee"
export const BG = DARK ? "#0c0c0b" : "#fbfbf8"
export const OK = DARK ? "#34d399" : "#059669"
export const WARN = DARK ? "#fbbf24" : "#d97706"
export const ERR = DARK ? "#f87171" : "#dc2626"
export const RULE = DARK ? "#2a2926" : "#edede9"
export const MARK = DARK ? "#0c0c0b" : "#ffffff"
export const THEME = DARK ? "dark" : "light"

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
