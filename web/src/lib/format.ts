export function formatEur(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function ago(iso: string | null): string {
  if (!iso) return "nie";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 0) return "gerade";
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)}h`;
  return `vor ${Math.floor(sec / 86400)}d`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}
