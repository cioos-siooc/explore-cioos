// Friendly, translated label for a harvest reason_code; falls back to the raw code.
export default function reasonLabel(t, code) {
  if (!code) return ''
  return t(`harvest.reason.${code}`, code)
}
