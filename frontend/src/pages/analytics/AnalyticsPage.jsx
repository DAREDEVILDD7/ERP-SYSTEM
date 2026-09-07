// Analytics — chat-style assistant.
//
// The page presents a conversational surface with a fixed catalogue of
// predefined prompts (chips). Selecting a prompt appends a user-message
// bubble and an assistant-message bubble; the assistant bubble renders
// the matching analytics section from components/analytics/sections.jsx.
//
// The transcript, filter, tab and ribbon-collapse state are additionally
// persisted to localStorage (see lib/analyticsSession.js) on a sliding
// 30-minute window scoped to the signed-in user, so leaving Analytics to
// look at something else and coming back resumes the same conversation.
// This is a resume point, not chat history — no server calls beyond the
// analytics queries the section components already make. Every section is
// fail-safe (see SectionCard) so a failing query, an empty result, or a
// template that throws only affects its own bubble; the rest of the
// conversation is unaffected.

import { useState, useRef, useEffect, useCallback, useMemo, Component } from 'react';
import {
  BarChart3, RefreshCw, Sparkles, User as UserIcon,
  RotateCcw, ChevronDown, Filter,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import {
  MostRentedSection, MostProcuredSection, RecentLeasesSection,
  MaintenanceFrequencySection, DispatchTrendsSection, ReturnTrendsSection,
  UtilizationSection, RevenueByCategorySection, ProcurementVsLeaseSection,
  IdleVsActiveSection, TopCustomersSection, MaintenanceCostSection,
  MonthlyKPIsSection, UnitPnLSection, FleetActionQueueSection,
} from '../../components/analytics/sections';
import ClaudeTypingLoader, {
  useMinDurationGate,
} from '../../components/analytics/ClaudeTypingLoader';
import DateRangeFilter from '../../components/analytics/DateRangeFilter';
import AnomalyRibbon from '../../components/analytics/AnomalyRibbon';
import OverviewPanel from '../../components/analytics/OverviewPanel';
import SignalDetail from '../../components/analytics/SignalDetail';
import { winParams, paramsFor } from '../../lib/analyticsWindow';
import { DEFAULT_RANGE, resolveRange } from '../../lib/dateRange';
import { useAnalytics } from '../../hooks/useAnalytics';
import {
  loadAnalyticsSession, saveAnalyticsSession, clearAnalyticsSession,
} from '../../lib/analyticsSession';

// ── Prompt catalogue ─────────────────────────────────────────────────────
// Each entry: an id (stable), a chip label, a "user says" phrasing, the
// section component to render, and a short reply the assistant leads with.
// Categories drive grouping in the picker; icons are optional decoration.
//
// `followUps` is what turns a one-shot answer into a conversation: after each
// reply the assistant offers the questions an analyst would ask next. Every
// entry must reference a real prompt id — this assistant only answers from a
// fixed catalogue, and offering a question it would then have to decline is
// worse than offering none. A `days` override re-asks the SAME prompt over a
// different window, which is how "compare with last year" works without a
// second section.
//
// `windowed: false` marks the prompts a FOLLOW-UP `days` override must not be
// offered on, because the override would change the transcript's wording
// without changing a single number — `assertCatalogue` rejects it at module
// load. It is not the same question as "does the date filter apply".
//
// Utilisation and idle-vs-active are live snapshots of `equipment_units`,
// whose `status` column holds only the CURRENT state — there is no history to
// filter, so no date range can mean anything to them and both say so in their
// own subtitles. The executive scorecard is different: it aggregates dated
// invoice / dispatch / maintenance rows, so it does follow the page range and
// falls back to the calendar month only when no range is chosen.

// Window resolution moved to lib/analyticsWindow.js so the Ribbon and the
// Overview panel resolve params through the same code as this page. That
// keeps their React Query cache keys aligned with the chat sections, so
// the ribbon chip that fires from a 365-day top_customers query cannot
// contradict the section chart that renders the exact same query.

const PROMPTS = [
  {
    id: 'fleet_action_queue',
    category: 'Overview',
    chip: 'Fleet Action Queue',
    userSays: 'What does the fleet need from me today?',
    reply: 'Here are the live actions across idle units, units in the workshop, and outstanding collections — sorted by priority.',
    windowed: false,
    render: () => <FleetActionQueueSection />,
    followUps: [
      { label: 'Which units are sitting idle?',        promptId: 'idle_vs_active' },
      { label: 'What is maintenance costing us?',      promptId: 'maintenance_cost' },
      { label: 'Who owes us the most?',                promptId: 'top_customers' },
      { label: 'This month at a glance',               promptId: 'monthly_kpis' },
    ],
  },
  {
    id: 'monthly_kpis',
    category: 'Overview',
    chip: 'Executive scorecard',
    userSays: 'Give me an executive scorecard for the current month.',
    reply: 'Here is this month\'s scorecard compared with the previous month.',
    windowed: false,
    render: (ctx) => <MonthlyKPIsSection params={winParams(ctx)} />,
    followUps: [
      { label: 'Which units earn their keep?', promptId: 'unit_pnl' },
      { label: 'How is the fleet utilised?', promptId: 'utilization' },
      { label: 'Where is revenue coming from?', promptId: 'revenue_by_category' },
      { label: 'How is maintenance spend trending?', promptId: 'maintenance_cost' },
      { label: 'Any overdue returns?', promptId: 'return_trends' },
    ],
  },
  {
    id: 'unit_pnl',
    category: 'Overview',
    chip: 'Unit P&L (estimate)',
    userSays: 'Which units are earning their keep and which are losing money?',
    reply: 'Per-unit net contribution over the window — top earners and worst losers, with the assumption stack disclosed.',
    render: (ctx) => <UnitPnLSection params={winParams(ctx, { min: 60 })} />,
    followUps: [
      { label: 'Compare with a full year', promptId: 'unit_pnl', days: 365 },
      { label: 'Which units eat the most maintenance?', promptId: 'maintenance_frequency' },
      { label: 'Which are sitting idle?', promptId: 'idle_vs_active' },
      { label: 'This month at a glance', promptId: 'monthly_kpis' },
    ],
  },
  {
    id: 'utilization',
    category: 'Fleet',
    chip: 'Fleet utilisation',
    userSays: 'How well is the fleet utilised right now?',
    reply: 'This is live utilisation across the fleet, split by equipment type.',
    windowed: false,
    render: () => <UtilizationSection />,
    followUps: [
      { label: 'Which units are sitting idle?', promptId: 'idle_vs_active' },
      { label: 'Which equipment rents the most?', promptId: 'most_rented' },
      { label: 'Should we buy or lease more?', promptId: 'procurement_vs_lease' },
      { label: 'Which units eat the most maintenance?', promptId: 'maintenance_frequency' },
    ],
  },
  {
    id: 'idle_vs_active',
    category: 'Fleet',
    chip: 'Idle vs active',
    userSays: 'Which units are sitting idle in the yard?',
    reply: 'Live warehouse state — idle units, longest idle streaks, and the shape of the fleet right now.',
    windowed: false,
    render: (ctx) => <IdleVsActiveSection params={winParams(ctx)} />,
    followUps: [
      { label: 'How well is the fleet utilised?', promptId: 'utilization' },
      { label: 'Which equipment rents the most?', promptId: 'most_rented' },
      { label: 'Are returns coming back on time?', promptId: 'return_trends' },
    ],
  },
  {
    id: 'most_rented',
    category: 'Rentals',
    chip: 'Most rented equipment',
    userSays: 'Which equipment types generate the most rentals?',
    reply: 'Top rented equipment types with concentration signals.',
    render: (ctx) => <MostRentedSection params={winParams(ctx, { max: 30 })} />,
    followUps: [
      { label: 'Compare with the last 90 days', promptId: 'most_rented', days: 90 },
      { label: 'Which categories earn the most?', promptId: 'revenue_by_category' },
      { label: 'Do we have the stock to meet this?', promptId: 'utilization' },
      { label: 'What are we procuring the most?', promptId: 'most_procured' },
    ],
  },
  {
    id: 'recent_leases',
    category: 'Rentals',
    chip: 'Recent lease activity',
    // Deliberately no "in the last 30 days" here: a windowed follow-up
    // appends its own period to this line, and a hard-coded one would
    // contradict it.
    userSays: 'What new leases have started recently?',
    reply: 'Recently signed leases and upcoming expiries you should renew.',
    render: (ctx) => <RecentLeasesSection params={winParams(ctx, { max: 30 })} />,
    followUps: [
      { label: 'Compare with the last 90 days', promptId: 'recent_leases', days: 90 },
      { label: 'Which categories earn the most?', promptId: 'revenue_by_category' },
      { label: 'Should we buy or lease?', promptId: 'procurement_vs_lease' },
      { label: 'Who are our top customers?', promptId: 'top_customers' },
    ],
  },
  {
    id: 'return_trends',
    category: 'Operations',
    chip: 'Return trends & overdue',
    userSays: 'Are returns coming back on time?',
    reply: 'Return cadence for rentals and leases, plus any overdue returns.',
    render: (ctx) => <ReturnTrendsSection params={winParams(ctx)} />,
    followUps: [
      { label: 'Compare with the last 180 days', promptId: 'return_trends', days: 180 },
      { label: 'How are dispatches trending?', promptId: 'dispatch_trends' },
      { label: 'Which customers are behind?', promptId: 'top_customers' },
      { label: 'What is sitting idle in the yard?', promptId: 'idle_vs_active' },
    ],
  },
  {
    id: 'dispatch_trends',
    category: 'Operations',
    chip: 'Dispatch trends',
    userSays: 'How are dispatches trending?',
    reply: 'Dispatch volume, backlog, and average turnaround over the window.',
    render: (ctx) => <DispatchTrendsSection params={winParams(ctx)} />,
    followUps: [
      { label: 'Compare with the last 180 days', promptId: 'dispatch_trends', days: 180 },
      { label: 'Are returns coming back on time?', promptId: 'return_trends' },
      { label: 'Is idle stock holding us back?', promptId: 'idle_vs_active' },
    ],
  },
  {
    id: 'revenue_by_category',
    category: 'Finance',
    chip: 'Revenue by category',
    userSays: 'Which equipment categories drive the most revenue?',
    reply: 'Revenue attributed to equipment categories, rental vs lease split.',
    render: (ctx) => <RevenueByCategorySection params={winParams(ctx)} />,
    followUps: [
      { label: 'Compare with a full year', promptId: 'revenue_by_category', days: 365 },
      { label: 'Who are our top customers?', promptId: 'top_customers' },
      { label: 'Which equipment rents the most?', promptId: 'most_rented' },
      { label: 'What is maintenance costing us?', promptId: 'maintenance_cost' },
      { label: 'How is the lease book holding up?', promptId: 'recent_leases' },
    ],
  },
  {
    id: 'top_customers',
    category: 'Finance',
    chip: 'Top customers',
    userSays: 'Who are our top customers by billing?',
    reply: 'Top accounts by billed KWD, plus concentration and collections signals.',
    render: (ctx) => <TopCustomersSection params={winParams(ctx, { min: 365 })} />,
    followUps: [
      { label: 'Compare with the last 90 days', promptId: 'top_customers', days: 90 },
      { label: 'Which categories drive that revenue?', promptId: 'revenue_by_category' },
      { label: 'Any overdue returns to chase?', promptId: 'return_trends' },
      { label: 'This month at a glance', promptId: 'monthly_kpis' },
    ],
  },
  {
    id: 'most_procured',
    category: 'Procurement',
    chip: 'Most procured equipment',
    userSays: 'What are we procuring the most?',
    reply: 'Procurement mix and monthly momentum across Buy and Lease.',
    render: (ctx) => <MostProcuredSection params={winParams(ctx)} />,
    followUps: [
      { label: 'Compare with a full year', promptId: 'most_procured', days: 365 },
      { label: 'Should we buy or lease these?', promptId: 'procurement_vs_lease' },
      { label: 'Do these earn their keep?', promptId: 'revenue_by_category' },
      { label: 'Which units eat the most maintenance?', promptId: 'maintenance_frequency' },
    ],
  },
  {
    id: 'procurement_vs_lease',
    category: 'Procurement',
    chip: 'Buy vs lease',
    userSays: 'Should we buy or lease the next unit?',
    reply: 'Buy vs lease comparison with an average break-even estimate.',
    render: (ctx) => <ProcurementVsLeaseSection params={winParams(ctx, { min: 365 })} />,
    followUps: [
      { label: 'Compare with the last 180 days', promptId: 'procurement_vs_lease', days: 180 },
      { label: 'What are we procuring the most?', promptId: 'most_procured' },
      { label: 'How well is the fleet utilised?', promptId: 'utilization' },
      { label: 'What does upkeep cost us?', promptId: 'maintenance_cost' },
      { label: 'What is on lease right now?', promptId: 'recent_leases' },
    ],
  },
  {
    id: 'maintenance_frequency',
    category: 'Maintenance',
    chip: 'Highest maintenance load',
    userSays: 'Which units are consuming the most maintenance effort?',
    reply: 'Highest-frequency maintenance offenders and any retire candidates.',
    render: (ctx) => <MaintenanceFrequencySection params={winParams(ctx, { min: 180 })} />,
    followUps: [
      { label: 'Which units earn their keep?', promptId: 'unit_pnl' },
      { label: 'Show the monthly spend trend', promptId: 'maintenance_cost' },
      { label: 'Compare with a full year', promptId: 'maintenance_frequency', days: 365 },
      { label: 'Is this hurting utilisation?', promptId: 'utilization' },
      { label: 'What are we procuring to replace it?', promptId: 'most_procured' },
    ],
  },
  {
    id: 'maintenance_cost',
    category: 'Maintenance',
    chip: 'Maintenance cost trends',
    userSays: 'How is maintenance spend trending?',
    reply: 'Monthly maintenance spend and dominant failure modes.',
    render: (ctx) => <MaintenanceCostSection params={winParams(ctx, { min: 365 })} />,
    followUps: [
      { label: 'Which units drive that cost?', promptId: 'maintenance_frequency' },
      { label: 'Compare with the last 180 days', promptId: 'maintenance_cost', days: 180 },
      { label: 'How does it compare to revenue?', promptId: 'revenue_by_category' },
    ],
  },
];

const CATEGORIES = ['Overview', 'Fleet', 'Rentals', 'Operations', 'Finance', 'Procurement', 'Maintenance'];

const PROMPTS_BY_ID = new Map(PROMPTS.map(p => [p.id, p]));

// ── Catalogue self-check ────────────────────────────────────────────────
// Every follow-up chip must resolve to an answer this assistant can actually
// produce. `askFollowUp` already fails safe at click time (it does nothing on
// an unknown id), but a chip that silently does nothing is indistinguishable
// from a broken page, and the failure only shows up if someone happens to
// click that one chip. This runs once at module load instead, so a bad
// reference surfaces the first time the page is opened in development.
//
// Three ways a suggestion can be wrong, all of which have a plausible route
// into the catalogue during an edit:
//   1. it names a prompt id that does not exist (renamed or removed);
//   2. it carries a `days` override for a prompt that has no window, so the
//      transcript would print a period the answer does not honour;
//   3. it offers a window identical to the one the section would already
//      use, which reads to the user as a comparison and renders as a repeat.
// Stripped from production builds — it is a development guard rail, not a
// runtime feature, and there is nothing an end user could do about a finding.
function assertCatalogue() {
  const problems = [];
  for (const p of PROMPTS) {
    for (const f of p.followUps ?? []) {
      const target = PROMPTS_BY_ID.get(f.promptId);
      if (!target) {
        problems.push(`"${p.id}" → unknown prompt "${f.promptId}" (${f.label})`);
        continue;
      }
      if (f.days != null && target.windowed === false) {
        problems.push(`"${p.id}" → "${f.promptId}" passes days=${f.days} but that prompt has no window`);
      }
      if (f.days != null && !WINDOW_PRESETS.some(w => w.days === f.days)) {
        problems.push(`"${p.id}" → "${f.promptId}" uses days=${f.days}, which is not a window preset`);
      }
    }
  }
  for (const f of STARTER_FOLLOWUPS) {
    if (!PROMPTS_BY_ID.has(f.promptId)) {
      problems.push(`starter → unknown prompt "${f.promptId}" (${f.label})`);
    }
  }
  if (problems.length) {
    console.error('[Analytics] follow-up catalogue is inconsistent:\n  ' + problems.join('\n  '));
  }
}

const WINDOW_PRESETS = [
  { label: 'Last 30 days',  days: 30  },
  { label: 'Last 90 days',  days: 90  },
  { label: 'Last 180 days', days: 180 },
  { label: 'Last 365 days', days: 365 },
];

// Openers offered on the greeting and after a reset, so the conversation has
// somewhere to go before the user has touched the category picker.
const STARTER_FOLLOWUPS = [
  { label: 'What does the fleet need from me today?', promptId: 'fleet_action_queue' },
  { label: 'This month at a glance', promptId: 'monthly_kpis' },
  { label: 'Which units are earning their keep?', promptId: 'unit_pnl' },
  { label: 'How well is the fleet utilised?', promptId: 'utilization' },
];

const GREETING_ID = 'greeting';

// Runs after WINDOW_PRESETS / STARTER_FOLLOWUPS are initialised — the
// function is hoisted, the const bindings it reads are not.
if (process.env.NODE_ENV !== 'production') assertCatalogue();

// ── Message components ───────────────────────────────────────────────────

function UserBubble({ text, timestamp, innerRef, msgId }) {
  return (
    <div
      ref={innerRef}
      data-msg-id={msgId}
      className="flex items-start gap-3 justify-end animate-[chatIn_0.24s_ease-out_both]"
    >
      <div className="max-w-[85%] sm:max-w-[80%] min-w-0 rounded-2xl rounded-tr-sm bg-primary-600 text-white px-3 py-2 sm:px-4 sm:py-2.5 shadow-sm">
        <p className="text-sm leading-snug whitespace-pre-wrap break-words">{text}</p>
        {timestamp && (
          <p className="text-[10px] text-white/70 mt-1 text-right">{timestamp}</p>
        )}
      </div>
      <div className="hidden sm:flex w-8 h-8 rounded-full bg-primary-100 items-center justify-center shrink-0">
        <UserIcon size={14} className="text-primary-600" />
      </div>
    </div>
  );
}

// How long the whole sentence should take to appear.
//
// Not a fixed per-character rate: at a constant 22ms the 19-character replies
// finish before the eye reaches them while the 189-character opener drags past
// four seconds. Scaling the RATE by length instead keeps every reply inside one
// comfortable reading beat — short ones stay unhurried, long ones accelerate —
// which is what "adapts to the response length" has to mean when the catalogue
// spans a 10x range.
//
// The ceiling matters for a second reason: the section behind this sentence
// shows its loading animation for ANALYTICS_LOADER_MIN_MS (3000ms), so a
// duration under that is fully concurrent with work that was happening anyway
// and adds nothing to how long the answer actually takes.
// Per-frame fraction of the remaining distance the follow loop closes, and the
// breathing room it leaves below the newest line so the text never sits flush
// against the bottom edge.
// Per-frame fraction of the remaining distance the follow loop closes, hard
// capped in pixels so a large jump (a chart-heavy card mounting all at once)
// is travelled at a readable speed instead of teleporting in two frames.
const FOLLOW_EASE = 0.14;
const MAX_FOLLOW_PX_PER_FRAME = 26;   // ~1.5k px/s at 60fps
// ...and a floor, because a pure exponential ease has a very long tail: the
// last few pixels would otherwise crawl for a second after the motion has
// visually stopped, leaving the anchor "almost there" for far longer than it
// spent travelling.
const MIN_FOLLOW_PX_PER_FRAME = 1.5;
// Where the start of a new exchange is parked: just below the top edge, so the
// question and the first words of the answer are the first things read.
const EXCHANGE_TOP_PX = 14;

// Frame scheduling, with a timer fallback.
//
// Every scroll and typing path here is frame-driven, so a scheduling primitive
// that is missing or throws would otherwise take the whole page down rather
// than merely degrading its animation. The flag latches on first failure so
// scheduling and cancelling can never disagree about which mechanism is in
// use — mixing the two would leak frames that cancel silently does nothing to.
let useTimerFallback = false;
function schedule(fn) {
  if (!useTimerFallback) {
    try {
      return requestAnimationFrame(fn);
    } catch {
      useTimerFallback = true;
    }
  }
  return setTimeout(fn, 16);
}
function unschedule(id) {
  if (!id) return;
  try {
    if (useTimerFallback) clearTimeout(id);
    else cancelAnimationFrame(id);
  } catch { /* already gone — nothing to release */ }
}

const TYPING_MIN_MS = 420;
const TYPING_MAX_MS = 2400;
const TYPING_MS_PER_CHAR = 26;

export function typingDurationFor(length) {
  const n = Number.isFinite(length) && length > 0 ? length : 0;
  if (!n) return 0;
  return Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, n * TYPING_MS_PER_CHAR));
}

function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

// The reply sentence, revealed at a reading pace.
//
// A LEAF component on purpose, and this is the load-bearing part: the shown
// substring is its own state, so a character tick re-renders this one <p> and
// nothing else. Holding it in the page would re-render the whole transcript —
// and therefore re-run all 13 section renders, charts included — sixty times a
// second.
//
// Driven by rAF against elapsed time rather than a per-character timer: it
// stays frame-locked, cannot drift, and a slow frame catches up by advancing
// several characters instead of falling behind.
function StreamedText({ text, animate, onStart, onEnd }) {
  const full = typeof text === 'string' ? text : '';
  // Decided ONCE, at mount. A bubble the user has already read must not retype
  // itself when a later message arrives and re-renders the list.
  const animateRef = useRef(animate && !prefersReducedMotion());
  const [shown, setShown] = useState(() => (animateRef.current ? '' : full));
  const shownCountRef = useRef(animateRef.current ? 0 : full.length);

  useEffect(() => {
    if (!animateRef.current || !full) {
      setShown(full);
      return undefined;
    }
    const total = typingDurationFor(full.length);
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let raf = 0;
    let started = false;

    const tick = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const p = total > 0 ? Math.min(1, (now - start) / total) : 1;
      const n = Math.max(1, Math.round(p * full.length));
      // Only touch state when the visible substring actually changes, so a
      // 60fps loop over a short sentence does not re-render per frame.
      if (n !== shownCountRef.current) {
        shownCountRef.current = n;
        setShown(full.slice(0, n));
      }
      if (p < 1) {
        raf = schedule(tick);
      } else {
        started = false;
        onEnd?.();
      }
    };

    try {
      onStart?.();
      started = true;
      raf = schedule(tick);
    } catch (err) {
      // Never let a presentation detail cost the reader the sentence.
      console.warn('[Analytics] reply streaming unavailable:', err?.message ?? err);
      setShown(full);
      if (started) onEnd?.();
      return undefined;
    }

    return () => {
      if (raf) unschedule(raf);
      // Unmounting mid-sentence must not leave the follow loop believing a
      // stream is still running.
      if (started) onEnd?.();
    };
    // `full` only — deliberately not `animate`, which flips to false the moment
    // a newer message arrives and would otherwise restart a finished sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  return <>{shown}</>;
}

function AssistantBubble({ reply, children, timestamp, animate, onStreamStart, onStreamEnd }) {
  return (
    <div className="flex items-start gap-2 sm:gap-3 animate-[chatIn_0.24s_ease-out_both]">
      <div className="hidden sm:flex w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 items-center justify-center shrink-0 shadow-sm">
        <Sparkles size={14} className="text-white" />
      </div>
      <div className="max-w-full flex-1 min-w-0 space-y-2">
        {reply && (
          <div className="inline-block max-w-full rounded-2xl rounded-tl-sm bg-white border border-slate-100 px-3 py-2 sm:px-4 sm:py-2.5 shadow-sm">
            {/* Same element, same classes — only the text arrives over time.
                `break-words` guards against long unbreakable tokens (URLs, ids
                surfaced verbatim) forcing horizontal overflow on narrow phones. */}
            <p className="text-sm text-slate-700 leading-snug break-words">
              <StreamedText
                text={reply}
                animate={animate}
                onStart={onStreamStart}
                onEnd={onStreamEnd}
              />
            </p>
          </div>
        )}
        {children && (
          <div className="w-full min-w-0">
            {children}
          </div>
        )}
        {timestamp && (
          <p className="text-[10px] text-slate-400 pl-1">{timestamp}</p>
        )}
      </div>
    </div>
  );
}

function stamp() {
  const d = new Date();
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// A restored assistant bubble carries only `promptId` (its `renderFn` is a
// function reference and cannot survive JSON.stringify — it is dropped by
// design when saving, see saveTranscript below). Re-derive it from the
// catalogue on load, same fail-safe posture as askFollowUp: if the id no
// longer resolves (a prompt renamed or removed since the session was
// saved) the bubble still renders its text reply, just without the chart.
// Malformed entries (no id/role — a corrupted or foreign localStorage
// value) are dropped rather than rendered.
function hydrateMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cleaned = raw
    .filter(m => m && typeof m.id === 'string' && typeof m.role === 'string')
    .map(m => {
      // A priority-signal bubble carries the whole anomaly rather than a
      // promptId, because there is no catalogue entry to look up — the
      // explanation IS the payload. It is plain data, so it round-trips
      // through storage and the renderer can simply be rebuilt over it.
      if (m.role === 'assistant' && m.signal) {
        return { ...m, renderFn: () => <SignalDetail anomaly={m.signal} /> };
      }
      if (m.role === 'assistant' && m.promptId) {
        return { ...m, renderFn: PROMPTS_BY_ID.get(m.promptId)?.render };
      }
      return m;
    });
  return cleaned.length > 0 ? cleaned : null;
}

// Strips the non-serializable `renderFn` before a transcript is written to
// storage. `JSON.stringify` would silently drop function-valued properties
// on its own, but doing it explicitly keeps the save shape self-documenting
// rather than depending on that behaviour.
function serializeMessages(messages) {
  return messages.map(({ renderFn, ...rest }) => rest);
}

// Suggested next questions, rendered under the answer they follow. Only the
// most recent answer offers them: leaving them live on every historical
// bubble turns the transcript into a wall of buttons and makes it ambiguous
// which answer a suggestion refers to.
function FollowUps({ suggestions, onPick }) {
  if (!suggestions?.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
      <span className="text-[10px] text-slate-400 pr-0.5">You might also ask</span>
      {suggestions.map((s, i) => (
        <button
          key={`${s.promptId}-${s.days ?? 'default'}-${i}`}
          type="button"
          onClick={() => onPick(s)}
          className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/60 transition-colors"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  // Loaded once, synchronously, on mount — `profile` is already populated by
  // now (AuthContext seeds it from sessionStorage at its own construction,
  // and this page sits behind ProtectedRoute) so there is no flash of
  // default state before a restore applies. `null` (nothing stored, or it
  // expired/failed to parse) falls through to the same defaults this page
  // always had.
  const [restoredSession] = useState(() => loadAnalyticsSession(profile?.user_id));

  const [range, setRange] = useState(() => restoredSession?.range ?? DEFAULT_RANGE);
  const [messages, setMessages] = useState(() => hydrateMessages(restoredSession?.messages) ?? [{
    id: GREETING_ID,
    role: 'assistant',
    reply: 'Hi! I can surface deterministic insights from your rentals, procurement, maintenance, revenue and fleet data. Pick a prompt below to get started — I only answer from the questions I know.',
    followUps: STARTER_FOLLOWUPS,
    timestamp: stamp(),
  }]);
  const [activeCategory, setActiveCategory] = useState(() => restoredSession?.activeCategory ?? 'Overview');
  const [ribbonCollapsed, setRibbonCollapsed] = useState(() => restoredSession?.ribbonCollapsed ?? false);


  const scrollerRef = useRef(null);
  const scrollAnchorRef = useRef(null);

  // The resolved date range every section reads. Computed early so the
  // primary-queries prime block below can key its useAnalytics calls on
  // exactly the same params the Ribbon and OverviewPanel will use — no
  // params drift, one React Query cache entry per (key, params).
  const resolvedRange = useMemo(() => resolveRange(range), [range]);
  const ctx = useMemo(() => ({
    windowDays: resolvedRange.days,
    from: resolvedRange.from,
    to: resolvedRange.to,
    allTime: resolvedRange.allTime,
    explicit: resolvedRange.explicit,
  }), [resolvedRange]);

  // Prime the queries the Overview surfaces will read. React Query
  // dedupes by (key, params) so these calls do NOT double-fetch — the
  // Ribbon and OverviewPanel below hit the exact same cache entries.
  // The purpose is purely to expose `isLoading` at the page level so the
  // entry mascot can hold until data is actually ready, instead of
  // fading after the 3-second floor and revealing empty skeletons.
  const primaryMonthly   = useAnalytics('monthly_kpis',    paramsFor('monthly_kpis',    ctx));
  const primaryLeases    = useAnalytics('recent_leases',   paramsFor('recent_leases',   ctx));
  const primaryCustomers = useAnalytics('top_customers',   paramsFor('top_customers',   ctx));
  const primaryUtil      = useAnalytics('utilization',     paramsFor('utilization',     ctx));
  const primaryIdle      = useAnalytics('idle_vs_active',  paramsFor('idle_vs_active',  ctx));
  const primaryMaint     = useAnalytics('maintenance_cost',paramsFor('maintenance_cost',ctx));
  const primaryForecast  = useAnalytics('forward_forecast');
  const primaryQueue     = useAnalytics('fleet_action_queue');

  const primaryLoading =
    primaryMonthly.isLoading   || primaryLeases.isLoading  ||
    primaryCustomers.isLoading || primaryUtil.isLoading    ||
    primaryIdle.isLoading      || primaryMaint.isLoading   ||
    primaryForecast.isLoading  || primaryQueue.isLoading;

  // Entering the workspace (sidebar → /analytics) mounts this page, so a
  // mount-scoped gate is exactly "animate on entry". The mascot holds
  // for AT LEAST `ANALYTICS_LOADER_MIN_MS` (its floor) AND until every
  // primary query has resolved for the first time — whichever is
  // longer. That way when the mascot fades, the ribbon + Overview mount
  // with data already in hand instead of flashing skeletons.
  const withinMinDuration = useMinDurationGate();
  const enteringWorkspace = withinMinDuration || primaryLoading;

  // ── Reading anchor ─────────────────────────────────────────────────────
  //
  // ONE behaviour, and it is not "follow the tail". When a new exchange is
  // appended the question is brought to just below the top edge and HELD
  // there while the answer grows underneath it. Nothing here ever scrolls to
  // the bottom.
  //
  // Why the anchor has to be MAINTAINED rather than fired once: at the moment
  // a question is appended the only thing below it is the answer card at its
  // ~240px loading height, so there is not yet enough scrollable content to
  // lift the question to the top. A one-shot scroll therefore clamps to the
  // maximum scroll — the bottom — which is exactly the "it jumps to the end
  // and I miss the charts" behaviour this replaces. The target is re-applied
  // as content arrives, so the question rises to the top as the answer fills
  // in beneath it, and stops the moment it gets there.
  //
  // Everything lives in refs: anchoring must never re-render the transcript,
  // which would re-run all 13 sections' renders for a viewport concern.
  // The DOM node of the newest exchange's question bubble, set by a ref
  // callback in the transcript below.
  const exchangeStartRef = useRef(null);
  const anchorNodeRef = useRef(null);
  const anchorActiveRef = useRef(false);
  const anchorRafRef = useRef(0);
  // The scrollTop this loop last wrote. Anything else there means a human
  // moved it — the only reliable way to tell our own motion from theirs,
  // because our own easing fires scroll events every frame too.
  const selfScrollTopRef = useRef(null);
  const lastHeightRef = useRef(0);

  const stopAnchor = useCallback(() => {
    anchorActiveRef.current = false;
    if (anchorRafRef.current) unschedule(anchorRafRef.current);
    anchorRafRef.current = 0;
    selfScrollTopRef.current = null;
  }, []);

  // Runs a frame of the anchor. Returns having either scheduled another frame,
  // parked (waiting for more content), or stopped for good.
  const anchorStep = useCallback(() => {
    anchorRafRef.current = 0;
    const el = scrollerRef.current;
    const node = anchorNodeRef.current;
    if (!el || !node || !anchorActiveRef.current) return;

    const cur = el.scrollTop;
    // A human touched the scrollbar — hand the viewport straight back.
    if (selfScrollTopRef.current !== null
        && Math.abs(cur - selfScrollTopRef.current) > 2) {
      stopAnchor();
      return;
    }

    let delta;
    try {
      delta = node.getBoundingClientRect().top
        - el.getBoundingClientRect().top
        - EXCHANGE_TOP_PX;
    } catch {
      // No usable geometry: leave the viewport alone rather than guess.
      stopAnchor();
      return;
    }

    // Achieved. The question sits where it should; content added BELOW it
    // cannot move it, so there is nothing left to maintain.
    if (Math.abs(delta) <= 1) {
      stopAnchor();
      return;
    }

    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const desired = Math.max(0, Math.min(max, cur + delta));
    const remaining = desired - cur;

    // Clamped: as close as the current amount of content allows. Park — do
    // NOT stop — so the observers can resume this the moment the answer grows
    // and makes more room. This is the state a fresh answer starts in.
    if (Math.abs(remaining) < 0.5) {
      selfScrollTopRef.current = cur;
      return;
    }

    if (prefersReducedMotion()) {
      el.scrollTop = desired;
    } else {
      // Eased and speed-capped: easing alone puts 14% of the distance into
      // the first frame, which on a card that just added 900px is a blur.
      const eased = Math.abs(remaining) * FOLLOW_EASE;
      const stepPx = Math.min(
        Math.max(eased, MIN_FOLLOW_PX_PER_FRAME),
        MAX_FOLLOW_PX_PER_FRAME,
        Math.abs(remaining),
      );
      el.scrollTop = cur + Math.sign(remaining) * stepPx;
    }
    selfScrollTopRef.current = el.scrollTop;
    anchorRafRef.current = schedule(anchorStep);
  }, [stopAnchor]);

  // Re-arm a parked anchor. Cheap and idempotent, so observers can call it on
  // every mutation without coalescing logic of their own.
  const kickAnchor = useCallback(() => {
    if (!anchorActiveRef.current) return;
    if (anchorRafRef.current) return;
    anchorRafRef.current = schedule(anchorStep);
  }, [anchorStep]);

  // A new exchange: aim at its question and start maintaining.
  //
  // `enteringWorkspace` is a dependency because the transcript only mounts
  // once the entry animation finishes — the ref is still null on the mount
  // pass, so without it the first anchor would silently no-op.
  useEffect(() => {
    const node = exchangeStartRef.current;
    // No user bubble means the greeting is the only thing here: nothing to
    // anchor, and a single short line needs no scrolling.
    if (!node) return undefined;
    anchorNodeRef.current = node;
    anchorActiveRef.current = true;
    selfScrollTopRef.current = null;
    const el = scrollerRef.current;
    if (el) lastHeightRef.current = el.scrollHeight;
    const id = schedule(anchorStep);
    anchorRafRef.current = id;
    return () => {
      if (anchorRafRef.current) unschedule(anchorRafRef.current);
      anchorRafRef.current = 0;
    };
  }, [messages.length, enteringWorkspace, anchorStep]);

  // Manual scrolling wins, immediately.
  //
  // Two detectors, because neither alone is enough: the input events fire
  // before any scrolling happens and so stop the anchor on the first notch of
  // a wheel, while the scroll comparison catches the ways a viewport can be
  // moved without them (dragging the scrollbar, a flung touch, find-in-page).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;

    const onIntent = () => stopAnchor();
    const onScroll = () => {
      if (!anchorActiveRef.current) return;
      if (selfScrollTopRef.current === null) return;
      if (Math.abs(el.scrollTop - selfScrollTopRef.current) > 2) stopAnchor();
    };

    const opts = { passive: true };
    el.addEventListener('wheel', onIntent, opts);
    el.addEventListener('touchstart', onIntent, opts);
    el.addEventListener('scroll', onScroll, opts);
    // Keys that move a scroller. Anything else (typing in a field) must not
    // count as an intent to take over the viewport.
    const NAV_KEYS = new Set([
      'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
    ]);
    const onKey = (e) => { if (NAV_KEYS.has(e.key)) stopAnchor(); };
    el.addEventListener('keydown', onKey);

    return () => {
      el.removeEventListener('wheel', onIntent);
      el.removeEventListener('touchstart', onIntent);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('keydown', onKey);
    };
  }, [stopAnchor, enteringWorkspace]);

  // Content arriving is what un-parks the anchor.
  //
  // A MutationObserver on the transcript is what keeps this out of
  // `SectionCard` and every section: the transcript reports that its subtree
  // changed and the page decides what to do, so no component needs to know a
  // scroller exists. Attribute mutations are deliberately NOT observed —
  // Recharts animates attributes every frame and would fire this continuously.
  //
  // Note what is NOT here any more: there is no tail-follow, no "pinned to the
  // bottom" state and no settle scroll when generation finishes. Content
  // growing past the fold is simply allowed to extend below, which is what
  // lets the reader keep reading from the top and scroll on at their own pace.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof MutationObserver === 'undefined') return undefined;

    const onGrow = () => {
      const node = scrollerRef.current;
      if (!node) return;
      const h = node.scrollHeight;
      if (h === lastHeightRef.current) return;
      const grew = h > lastHeightRef.current;
      lastHeightRef.current = h;
      // Only growth can create the room a clamped anchor was waiting for.
      if (grew) kickAnchor();
    };

    let observer;
    try {
      observer = new MutationObserver(onGrow);
      observer.observe(el, { childList: true, subtree: true, characterData: true });
    } catch (err) {
      console.warn('[Analytics] reading anchor unavailable:', err?.message ?? err);
      return undefined;
    }

    // The container itself changing size (window resize, sidebar collapse, the
    // picker wrapping to a second row) moves the anchor without mutating
    // anything, so it needs its own trigger.
    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        resizeObserver = new ResizeObserver(() => kickAnchor());
        resizeObserver.observe(el);
      } catch { /* non-fatal: mutations still drive the common case */ }
    }

    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  }, [kickAnchor, enteringWorkspace]);

  // The streaming sentence grows the bubble; that is content arriving too.
  // `handleStreamEnd` deliberately does nothing: a finished answer must not be
  // chased to its end.
  const handleStreamStart = useCallback(() => { kickAnchor(); }, [kickAnchor]);
  const handleStreamEnd = useCallback(() => {}, []);

  // Monotonic message ids. `Date.now()` alone collided when two chips were
  // clicked inside the same millisecond, and duplicate React keys make the
  // transcript drop or reorder bubbles. Restored from the saved session so
  // a prompt asked after a restore never collides with a restored id.
  const seqRef = useRef(restoredSession?.seq ?? 0);

  // Ref mirror of messages so callbacks (askPrompt) can read the current
  // transcript without re-creating themselves on every message push.
  // Idempotency needs to look at the transcript BEFORE deciding to append;
  // reading through this ref keeps that lookup O(1) closure-wise.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // When a re-click is absorbed (see idempotency in askPrompt), we set
  // this to the existing bubble's id so the effect below scrolls the
  // reader back to it. Cleared immediately after firing so a subsequent
  // set with the same id still triggers.
  const [scrollTargetId, setScrollTargetId] = useState(null);
  useEffect(() => {
    if (!scrollTargetId) return;
    const scroller = scrollerRef.current;
    if (!scroller) { setScrollTargetId(null); return; }
    const escape = (s) => (
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(s)
        : String(s).replace(/["\\]/g, '\\$&')
    );
    try {
      const el = scroller.querySelector(`[data-msg-id="${escape(scrollTargetId)}"]`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.warn('[Analytics] scroll-to-existing failed', err?.message ?? err);
    }
    setScrollTargetId(null);
  }, [scrollTargetId]);

  // `overrideDays` lets a follow-up re-ask the same question over a different
  // window ("compare with a full year") without touching the page-level
  // selector — the two answers then sit side by side in the transcript, which
  // is the whole point of a comparison.
  //
  // A non-windowed prompt ignores the override entirely (see `windowed` in
  // the catalogue), so the user bubble must not claim a period either — the
  // label is only appended when the section will genuinely honour it.
  const askPrompt = useCallback((prompt, overrideDays) => {
    if (!prompt) return;
    const requested = Number.isFinite(overrideDays) ? overrideDays : null;
    const days = prompt.windowed === false ? null : requested;
    const label = WINDOW_PRESETS.find(w => w.days === days)?.label
      ?? (days ? `the last ${days} days` : null);

    // Idempotency. If this exact question — same promptId AND same
    // window override — already sits in the transcript, do NOT append
    // a duplicate bubble. Instead scroll the reader to the existing
    // answer. Rationale:
    //   * Repeat clicks on the same chip are noise, not a request for
    //     fresh data — that's what the header Refresh button is for
    //     (and React Query already keeps section data live via stale
    //     time).
    //   * Duplicating bubbles bloats the transcript and confuses the
    //     reading-anchor logic, which assumes the newest exchange is
    //     the one the user is looking at.
    //   * The lookup reads through messagesRef so this useCallback
    //     keeps its empty dep array (askFollowUp identity stays stable
    //     for the tab-switching callback chain).
    // Idempotency also checks ctxSnapshot so the same prompt asked under a
    // different filter is treated as a new question, not a duplicate.
    const existing = messagesRef.current.find(m =>
      m.role === 'assistant' &&
      m.promptId === prompt.id &&
      (m.windowOverride ?? null) === days &&
      m.ctxSnapshot?.windowDays === ctx.windowDays &&
      m.ctxSnapshot?.from === ctx.from &&
      m.ctxSnapshot?.to === ctx.to
    );
    if (existing) {
      // Assistant bubble ids are `a-${seq}`; the paired user bubble is
      // `u-${seq}` — scroll to the QUESTION, which is what the anchor
      // logic uses for a fresh exchange too, so re-clicks feel
      // consistent with new clicks.
      const userId = existing.id.replace(/^a-/, 'u-');
      setScrollTargetId(userId);
      return;
    }

    const seq = (seqRef.current += 1);
    setMessages(prev => [
      ...prev,
      {
        id: `u-${seq}`,
        role: 'user',
        text: days ? `${prompt.userSays} (${label})` : prompt.userSays,
        timestamp: stamp(),
      },
      {
        id: `a-${seq}`,
        role: 'assistant',
        promptId: prompt.id,
        reply: prompt.reply,
        renderFn: prompt.render,
        windowOverride: days,
        // Freeze the page-level filter at the moment this prompt is fired.
        // Sections render against this snapshot; changing the filter later
        // updates the Overview and ribbon but leaves existing chat bubbles
        // exactly as the user saw them when they asked.
        ctxSnapshot: { ...ctx },
        followUps: prompt.followUps ?? [],
        timestamp: stamp(),
      },
    ]);
  }, [ctx]);

  // A follow-up chip resolves to a real catalogue entry. If an id ever stops
  // matching (a prompt renamed, a chip left behind), do nothing rather than
  // append an empty assistant bubble. `assertCatalogue` catches this at
  // module load in development; this is the production fail-safe.
  const askFollowUp = useCallback((suggestion) => {
    const target = PROMPTS_BY_ID.get(suggestion?.promptId);
    if (!target) {
      console.warn('[Analytics] follow-up references unknown prompt:', suggestion?.promptId);
      return;
    }
    askPrompt(target, suggestion.days);
  }, [askPrompt]);

  // Open a priority signal as an explanation rather than a redirect.
  //
  // Every anomaly carries a `promptId` naming a related section, and the old
  // drill-in simply opened it. That was the wrong answer for most of the
  // ribbon: eight of the fifteen rules point at `top_customers` (the four
  // data-quality rules among them, because they are computed inside
  // `getTopCustomers`), so clicking "2 anomalous quotes detected" asked "who
  // are our top customers by billing?" — a question nobody had asked, and one
  // that says nothing about the anomalous quotes.
  //
  // Now the click appends a real exchange: the user bubble states the signal,
  // the assistant bubble renders `SignalDetail`, and `explain.related` becomes
  // the follow-up chips, so the section that used to be the whole response is
  // one click further on. The anomaly is snapshotted into the message, so the
  // bubble keeps saying what it said when it was opened even after the
  // underlying numbers move — the same contract `ctxSnapshot` gives sections.
  const askSignal = useCallback((anomaly) => {
    if (!anomaly || typeof anomaly !== 'object') return;
    const key = anomaly.id ?? anomaly.headline;
    if (!key) return;

    // Idempotent like askPrompt: re-clicking a chip already in the transcript
    // scrolls to it rather than stacking a duplicate. Keyed on the signal id
    // AND the filter, so the same signal under a different date range is a
    // genuinely new question.
    const existing = messagesRef.current.find(m =>
      m.role === 'assistant' &&
      m.signalKey === key &&
      m.ctxSnapshot?.windowDays === ctx.windowDays &&
      m.ctxSnapshot?.from === ctx.from &&
      m.ctxSnapshot?.to === ctx.to
    );
    if (existing) {
      setScrollTargetId(existing.id.replace(/^a-/, 'u-'));
      return;
    }

    // Only offer follow-ups that resolve against the catalogue. A renamed
    // prompt should drop the chip, never append a bubble that does nothing.
    const related = Array.isArray(anomaly.explain?.related)
      ? anomaly.explain.related.filter(f => f && PROMPTS_BY_ID.has(f.promptId))
      : [];
    // Fall back to the rule's own promptId so a signal with no `explain`
    // still offers the destination it always had.
    const followUps = related.length
      ? related
      : (anomaly.promptId && PROMPTS_BY_ID.has(anomaly.promptId)
        ? [{ label: 'Open the related section', promptId: anomaly.promptId, days: anomaly.days }]
        : []);

    const seq = (seqRef.current += 1);
    const snapshot = anomaly;
    setMessages(prev => [
      ...prev,
      {
        id: `u-${seq}`,
        role: 'user',
        text: `Explain this signal: ${anomaly.headline ?? 'priority signal'}`,
        timestamp: stamp(),
      },
      {
        id: `a-${seq}`,
        role: 'assistant',
        signalKey: key,
        // The anomaly is plain data (strings, numbers, arrays), so unlike a
        // section's `renderFn` it survives JSON.stringify and can be replayed
        // verbatim by hydrateMessages after a reload.
        signal: snapshot,
        reply: 'Here is what that signal means, how it is measured, and what sits behind the number.',
        renderFn: () => <SignalDetail anomaly={snapshot} />,
        ctxSnapshot: { ...ctx },
        followUps,
        timestamp: stamp(),
      },
    ]);
  }, [ctx]);

  // Drill-in from Overview or the Ribbon. A suggestion carrying `signal` is a
  // priority-signal chip and gets the explainer; anything else is a plain
  // prompt reference and keeps the original behaviour, so OverviewPanel and
  // every follow-up chip are untouched by this.
  const drillIn = useCallback((suggestion) => {
    if (suggestion?.signal) {
      askSignal(suggestion.signal);
      return;
    }
    askFollowUp(suggestion);
  }, [askFollowUp, askSignal]);

  const handleReset = useCallback(() => {
    setMessages([{
      id: GREETING_ID,
      role: 'assistant',
      reply: 'Cleared. Pick a prompt below to start a fresh conversation.',
      followUps: STARTER_FOLLOWUPS,
      timestamp: stamp(),
    }]);
    // This IS the app's existing "new session" action — a persisted
    // session is resumption of a live conversation, and there is no
    // conversation left to resume once the user has explicitly cleared it.
    clearAnalyticsSession(profile?.user_id);
  }, [profile?.user_id]);

  const handleRefreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['analytics'] });
  }, [qc]);

  // Inject a divider into the transcript when the date filter changes so the
  // reader knows which prompts above and below it used different ranges.
  // Skips the initial mount — ctx is set for the first time then, not changed.
  const filterInitRef = useRef(false);
  useEffect(() => {
    if (!filterInitRef.current) { filterInitRef.current = true; return; }
    const label =
      WINDOW_PRESETS.find(w => w.days === ctx.windowDays && !ctx.explicit && !ctx.allTime)?.label
      ?? (ctx.allTime ? 'All time' : `${ctx.from?.slice(5)} → ${ctx.to?.slice(5)}`);
    setMessages(prev => [
      ...prev,
      { id: `filter-${Date.now()}`, role: 'system', text: label, timestamp: stamp() },
    ]);
  }, [ctx]);

  // ── Session persistence ────────────────────────────────────────────────
  // Three independent, cheap saves — each fires only when the piece of
  // state it covers actually changes (asking a prompt, resetting,
  // switching the date filter or the category tab). None of this is
  // debounced: these are discrete user actions, not a high-frequency
  // stream like scroll or drag, so there is nothing to coalesce. Together
  // they also refresh `lastActivityAt` on every meaningful interaction,
  // which is what implements the sliding 30-minute expiration.
  //
  // Restoring the transcript at mount is enough to restore scroll position
  // too — the reading-anchor effect above already fires on first render
  // and, given a restored multi-message transcript, anchors to the newest
  // question exactly as it would for a freshly-asked one. No separate
  // scrollTop save/restore is needed, and adding one would risk fighting
  // the anchor loop for control of the same scrollTop.
  useEffect(() => {
    saveAnalyticsSession(profile?.user_id, {
      messages: serializeMessages(messages),
      seq: seqRef.current,
    });
  }, [messages, profile?.user_id]);

  useEffect(() => {
    saveAnalyticsSession(profile?.user_id, { range });
  }, [range, profile?.user_id]);

  useEffect(() => {
    saveAnalyticsSession(profile?.user_id, { activeCategory });
  }, [activeCategory, profile?.user_id]);

  useEffect(() => {
    saveAnalyticsSession(profile?.user_id, { ribbonCollapsed });
  }, [ribbonCollapsed, profile?.user_id]);

  // Which bubble is the start of the newest exchange — the question the
  // freshest answer belongs to. Anchoring on the QUESTION rather than on the
  // answer is what puts the reader at the top of the whole exchange.
  const exchangeStartId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') return messages[i].id;
    }
    return null;
  }, [messages]);

  const visiblePrompts = useMemo(
    () => PROMPTS.filter(p => p.category === activeCategory),
    [activeCategory]
  );

  return (
    <div className="flex flex-col min-h-[600px] lg:h-full gap-2 min-w-0 max-w-full">
      {/* Keyframes for message entry — kept inline so the page ships as one
          drop-in file with no global CSS additions. */}
      <style>{`
        @keyframes chatIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      {/* `overflow-hidden` deliberately does NOT sit on this element. It used
          to, purely to clip the two decorative circles below to the rounded
          corners — but it also clipped the date filter's popover, which is a
          child, so only its first row was visible and the rest was cut off at
          the header's bottom edge. The clipping now wraps just the
          decorations, which is all it was ever for.

          `z-20` is the other half of the same fix: the chat card underneath is
          a LATER sibling that is itself `relative`, so at equal z-index it
          paints over anything escaping this header. */}
      {/* Compact single-row header — reclaims ~40 px of vertical space
          that used to belong to the "Chat with your data" subtitle and
          the "Signed in as" line. Icon + title stay on one line, the
          controls sit to the right, and only wraps on mobile. */}
      <div className="relative z-20 rounded-2xl bg-gradient-to-r from-primary-700 via-primary-600 to-gray-900 px-3 py-2 md:px-4 md:py-2.5 text-white shadow-lg shrink-0">
        <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
          <div className="absolute -top-14 -right-14 w-64 h-64 rounded-full bg-white/10" />
          <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5" />
        </div>
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <BarChart3 size={15} className="text-white" />
            </div>
            <div className="min-w-0 flex items-baseline gap-2">
              <h1 className="text-sm md:text-base font-bold leading-tight truncate">Analytics Assistant</h1>
              {profile?.name && (
                <p className="hidden md:inline text-white/60 text-[10px] truncate">· {profile.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
            <DateRangeFilter
              range={range}
              onChange={setRange}
              triggerClassName="bg-white/15 hover:bg-white/25 backdrop-blur-sm border-transparent text-white"
            />
            <button
              onClick={handleRefreshAll}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1 text-[11px] transition-colors"
              title="Re-fetch every analytics query"
              aria-label="Refresh"
            >
              <RefreshCw size={12} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={handleReset}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1 text-[11px] transition-colors"
              title="Clear the conversation"
              aria-label="Reset conversation"
            >
              <RotateCcw size={12} />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Priority signals — full width above both columns ─────────── */}
      {!enteringWorkspace && (
        <AnomalyRibbon
          ctx={ctx}
          onDrillIn={drillIn}
          collapsed={ribbonCollapsed}
          onToggleCollapsed={setRibbonCollapsed}
        />
      )}

      {/* ── Two-column body ───────────────────────────────────────────────
          Mobile/tablet: columns stack (flex-col). lg+: side-by-side.
          Left column: Overview/Money Map. Right column: Ask/chat.
          During the entry animation neither column renders — the loader
          in the right card fills the full body width. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 min-w-0">

        {/* ── Left column: Overview panel ────────────────────────────── */}
        {/* Mobile: bounded height so the Overview doesn't push Ask off-screen.
            lg+: full column height with internal scroll. */}
        {!enteringWorkspace && (
          <div className="shrink-0 lg:w-[38%] lg:min-h-0 overflow-y-auto max-h-[300px] lg:max-h-none min-w-0">
            <OverviewPanel ctx={ctx} onDrillIn={drillIn} />
          </div>
        )}

        {/* ── Right column: Ask / chat ──────────────────────────────────
            Always mounted — refs, MutationObservers, and transcript
            survive focus changes between columns. `relative` is
            load-bearing: the entry loader positions itself absolutely
            inside this card. On mobile a min-h ensures the chat is
            usable when the left column is stacked above it. */}
        <div className="flex-1 min-h-[400px] lg:min-h-0 neo-card p-0 overflow-hidden flex flex-col relative">
          {!enteringWorkspace && (
          <>
          <div
            ref={scrollerRef}
            className="flex-1 overflow-x-hidden overflow-y-auto px-3 md:px-6 py-4 md:py-5 pb-10 md:pb-10 space-y-4 md:space-y-5 bg-gradient-to-b from-slate-50/50 to-white"
          >
            {messages.map((m, idx) => (
              m.role === 'system' ? (
                // Filter-change divider — marks the boundary between prompts
                // that used different date ranges.
                <div key={m.id} className="flex items-center gap-3 py-1.5 select-none">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-400 shrink-0">
                    <Filter size={10} />
                    Filter changed to{' '}
                    <span className="font-medium text-slate-500">{m.text}</span>
                    {' '}· new prompts use this range
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
              ) : m.role === 'user' ? (
                <UserBubble
                  key={m.id}
                  msgId={m.id}
                  text={m.text}
                  timestamp={m.timestamp}
                  innerRef={m.id === exchangeStartId ? exchangeStartRef : undefined}
                />
              ) : (
                <AssistantBubble
                  key={m.id}
                  reply={m.reply}
                  timestamp={m.timestamp}
                  /* Only the newest answer types itself out; everything above it
                     is already-read history and appears in full. */
                  animate={idx === messages.length - 1}
                  onStreamStart={handleStreamStart}
                  onStreamEnd={handleStreamEnd}
                >
                  {m.renderFn ? (
                    <ChatSection
                      renderFn={m.renderFn}
                      ctx={m.windowOverride
                        ? { windowDays: m.windowOverride, explicit: true }
                        : (m.ctxSnapshot ?? ctx)}
                    />
                  ) : null}
                  {idx === messages.length - 1 && (
                    <FollowUps suggestions={m.followUps} onPick={askFollowUp} />
                  )}
                </AssistantBubble>
              )
            ))}
            {/* Scroll anchor — an invisible sentinel we scrollIntoView on. */}
            <div ref={scrollAnchorRef} />
          </div>

          {/* ── Prompt picker ─────────────────────────────────────────── */}
          <div className="border-t border-slate-100 bg-white/80 backdrop-blur px-3 md:px-5 py-3 space-y-2 shrink-0 overflow-hidden">
            {/* Category tabs — horizontally scrollable on mobile. overscroll-x-contain
                prevents the swipe from leaking to the parent. tabs-scroll hides the
                thin scrollbar without disabling the gesture. */}
            <div className="tabs-scroll flex items-center gap-1 overflow-x-auto pb-1 overscroll-x-contain min-w-0">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={
                    'text-[11px] font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ' +
                    (activeCategory === cat
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100')
                  }
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-slate-400 pr-1">
                <ChevronDown size={11} /> Ask
              </span>
              {visiblePrompts.map(p => (
                <button
                  key={p.id}
                  onClick={() => askPrompt(p)}
                  className="text-xs px-3 py-2 rounded-xl bg-slate-50 hover:bg-primary-50 text-slate-700 hover:text-primary-700 border border-slate-100 hover:border-primary-200 transition-colors"
                  title={p.userSays}
                >
                  {p.chip}
                </button>
              ))}
            </div>
          </div>
          </>
          )}

          <ClaudeTypingLoader
            visible={enteringWorkspace}
            message="Preparing your analytics workspace"
          />
        </div>
      </div>
    </div>
  );
}

// Isolated boundary so an unexpected render failure inside one section
// never poisons the whole chat. Every section already handles its own
// query loading/error/empty states inside SectionCard, so this is a
// belt-and-braces for React-render exceptions (a template that unexpectedly
// throws, a Recharts child that dislikes a shape) rather than for data
// errors, which are already covered.
class ChatSectionBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[AnalyticsChat] section render failed:', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="neo-card p-4 border border-amber-200 bg-amber-50/60 text-xs text-amber-800">
          Could not render this insight. {String(this.state.error?.message ?? this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

function ChatSection({ renderFn, ctx }) {
  return (
    <ChatSectionBoundary>
      {renderFn(ctx)}
    </ChatSectionBoundary>
  );
}
