// Friendly, translated label for a harvest warning code; falls back to the raw code.
export default function warningLabel(t, code) {
  if (!code) return "";
  return t(`harvest.warning.${code}`, code);
}
