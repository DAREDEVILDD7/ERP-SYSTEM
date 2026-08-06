// Renders the `{ severity, headline, body }` array returned by a template
// as a colour-coded, screen-reader-friendly bullet list. Kept intentionally
// small — every analytics section renders one of these underneath its
// chart(s).

import clsx from 'clsx';
import { Lightbulb, AlertTriangle, AlertOctagon, CircleDot } from 'lucide-react';
import { SEVERITY_TOKENS } from '../../lib/insightHelpers';

const ICONS = {
  positive: Lightbulb,
  neutral:  CircleDot,
  warning:  AlertTriangle,
  critical: AlertOctagon,
};

export default function InsightList({ insights }) {
  if (!insights?.length) {
    return (
      <p className="text-xs text-slate-400 italic">
        No template insights fired for this window.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {insights.map((i, idx) => {
        const t = SEVERITY_TOKENS[i.severity] ?? SEVERITY_TOKENS.neutral;
        const Icon = ICONS[i.severity] ?? CircleDot;
        return (
          <li
            key={idx}
            className={clsx('rounded-lg border p-3 flex gap-3', t.border, t.bg)}
          >
            <div className={clsx('shrink-0 w-6 h-6 rounded-full flex items-center justify-center', t.dot)}>
              <Icon size={13} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className={clsx('text-sm font-semibold leading-snug', t.text)}>{i.headline}</p>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{i.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
