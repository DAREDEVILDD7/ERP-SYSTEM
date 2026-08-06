// Shared helpers used across every insight template.
// Kept pure and side-effect free so the templates themselves are trivially
// unit-testable and can be reasoned about in isolation.

export function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return '0%';
  return `${Math.round((numerator * 100) / denominator)}%`;
}

export function kwd(amount) {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return 'KWD 0';
  return `KWD ${Math.round(n).toLocaleString('en-KW')}`;
}


// Build a single insight object with sensible defaults.
export function insight(severity, headline, body, cta) {
  return { severity, headline, body, cta };
}

export const SEVERITY_TOKENS = {
  positive: { border: 'border-emerald-200', bg: 'bg-emerald-50',  text: 'text-emerald-800',  dot: 'bg-emerald-500' },
  neutral:  { border: 'border-slate-200',   bg: 'bg-slate-50',    text: 'text-slate-700',    dot: 'bg-slate-400'   },
  warning:  { border: 'border-amber-200',   bg: 'bg-amber-50',    text: 'text-amber-800',    dot: 'bg-amber-500'   },
  critical: { border: 'border-primary-200', bg: 'bg-primary-50',  text: 'text-primary-700',  dot: 'bg-primary-500' },
};
