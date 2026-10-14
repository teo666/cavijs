/**
 * One-line, human-readable summary of an event's `detail`, for
 * <cavi-debug>'s event log: elements as `<tag#id>`, Wire handles as
 * `wire#index`, numbers rounded, nested objects one level deep.
 */
export function describeDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return '';
  if (typeof detail !== 'object') return describeValue(detail, 0);
  return Object.entries(detail as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${describeValue(value, 0)}`)
    .join('  ');
}

function describeValue(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return 'ƒ';
  if (typeof Element !== 'undefined' && value instanceof Element) {
    const tag = value.tagName.toLowerCase();
    return value.id ? `<${tag}#${value.id}>` : `<${tag}>`;
  }
  if (isWireLike(value)) return `wire#${value.getIndex()}`;
  if (Array.isArray(value)) return `[${value.length}]`;
  const name = (value as object).constructor?.name;
  if (name && name !== 'Object') return name;
  if (depth > 0) return '{…}';
  const inner = Object.entries(value as Record<string, unknown>)
    .map(([key, v]) => `${key}: ${describeValue(v, depth + 1)}`)
    .join(', ');
  return `{${inner}}`;
}

function isWireLike(value: unknown): value is { getIndex(): number } {
  return (
    typeof (value as { getIndex?: unknown }).getIndex === 'function' &&
    typeof (value as { getNodeCount?: unknown }).getNodeCount === 'function'
  );
}

export function formatNumber(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(decimals);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** `HH:MM:SS.mmm` wall-clock time, for event log entries. */
export function formatTime(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
