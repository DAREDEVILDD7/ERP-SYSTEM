// Analytics — chat-style assistant.
//
// The page presents a conversational surface with a fixed catalogue of
// predefined prompts (chips). Selecting a prompt appends a user-message
// bubble and an assistant-message bubble; the assistant bubble renders
// the matching analytics section from components/analytics/sections.jsx.
//
// The chat is stateful only within the current session — no persistence,
// no server calls beyond the analytics queries the section components
// already make. Every section is fail-safe (see SectionCard) so a failing
// query, an empty result, or a template that throws only affects its own
// bubble; the rest of the conversation is unaffected.

import { useState, useRef, useEffect, useCallback, useMemo, Component } from 'react';
import {
  BarChart3, Calendar, RefreshCw, Sparkles, User as UserIcon,
  RotateCcw, ChevronDown,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import {
  MostRentedSection, MostProcuredSection, RecentLeasesSection,
  MaintenanceFrequencySection, DispatchTrendsSection, ReturnTrendsSection,
  UtilizationSection, RevenueByCategorySection, ProcurementVsLeaseSection,
  IdleVsActiveSection, TopCustomersSection, MaintenanceCostSection,
  MonthlyKPIsSection,
} from '../../components/analytics/sections';
import ClaudeTypingLoader, {
  useMinDurationGate,
} from '../../components/analytics/ClaudeTypingLoader';

// ── Prompt catalogue ─────────────────────────────────────────────────────
// Each entry: an id (stable), a chip label, a "user says" phrasing, the
// section component to render, and a short reply the assistant leads with.
// Categories drive grouping in the picker; icons are optional decoration.

const PROMPTS = [
  {
    id: 'monthly_kpis',
    category: 'Overview',
    chip: 'Executive scorecard',
    userSays: 'Give me an executive scorecard for the current month.',
    reply: 'Here is this month\'s scorecard compared with the previous month.',
    render: () => <MonthlyKPIsSection />,
  },
  {
    id: 'utilization',
    category: 'Fleet',
    chip: 'Fleet utilisation',
    userSays: 'How well is the fleet utilised right now?',
    reply: 'This is live utilisation across the fleet, split by equipment type.',
    render: () => <UtilizationSection />,
  },
  {
    id: 'idle_vs_active',
    category: 'Fleet',
    chip: 'Idle vs active',
    userSays: 'Which units are sitting idle in the yard?',
    reply: 'Live warehouse state — idle units, longest idle streaks, and the shape of the fleet right now.',
    render: () => <IdleVsActiveSection />,
  },
  {
    id: 'most_rented',
    category: 'Rentals',
    chip: 'Most rented equipment',
    userSays: 'Which equipment types generate the most rentals?',
    reply: 'Top rented equipment types with concentration signals.',
    render: (ctx) => <MostRentedSection params={{ days: Math.min(ctx.windowDays, 30) }} />,
  },
  {
    id: 'dispatch_trends',
    category: 'Operations',
    chip: 'Dispatch trends',
    userSays: 'How are dispatches trending?',
    reply: 'Dispatch volume, backlog, and average turnaround over the window.',
    render: (ctx) => <DispatchTrendsSection params={{ days: ctx.windowDays }} />,
  },
  {
    id: 'return_trends',
    category: 'Operations',
    chip: 'Return trends & overdue',
    userSays: 'Are returns coming back on time?',
    reply: 'Return cadence for rentals and leases, plus any overdue returns.',
    render: (ctx) => <ReturnTrendsSection params={{ days: ctx.windowDays }} />,
  },
  {
    id: 'recent_leases',
    category: 'Rentals',
    chip: 'Recent lease activity',
    userSays: 'What new leases have started in the last 30 days?',
    reply: 'Recently signed leases and upcoming expiries you should renew.',
    render: () => <RecentLeasesSection params={{ days: 30 }} />,
  },
  {
    id: 'revenue_by_category',
    category: 'Finance',
    chip: 'Revenue by category',
    userSays: 'Which equipment categories drive the most revenue?',
    reply: 'Revenue attributed to equipment categories, rental vs lease split.',
    render: (ctx) => <RevenueByCategorySection params={{ days: ctx.windowDays }} />,
  },
  {
    id: 'top_customers',
    category: 'Finance',
    chip: 'Top customers',
    userSays: 'Who are our top customers by billing?',
    reply: 'Top accounts by billed KWD, plus concentration and collections signals.',
    render: (ctx) => <TopCustomersSection params={{ days: Math.max(ctx.windowDays, 365) }} />,
  },
  {
    id: 'most_procured',
    category: 'Procurement',
    chip: 'Most procured equipment',
    userSays: 'What are we procuring the most?',
    reply: 'Procurement mix and monthly momentum across Buy and Lease.',
    render: (ctx) => <MostProcuredSection params={{ days: ctx.windowDays }} />,
  },
  {
    id: 'procurement_vs_lease',
    category: 'Procurement',
    chip: 'Buy vs lease',
    userSays: 'Should we buy or lease the next unit?',
    reply: 'Buy vs lease comparison with an average break-even estimate.',
    render: (ctx) => <ProcurementVsLeaseSection params={{ days: Math.max(ctx.windowDays, 365) }} />,
  },
  {
    id: 'maintenance_cost',
    category: 'Maintenance',
    chip: 'Maintenance cost trends',
    userSays: 'How is maintenance spend trending?',
    reply: 'Monthly maintenance spend and dominant failure modes.',
    render: (ctx) => <MaintenanceCostSection params={{ days: Math.max(ctx.windowDays, 365) }} />,
  },
  {
    id: 'maintenance_frequency',
    category: 'Maintenance',
    chip: 'Highest maintenance load',
    userSays: 'Which units are consuming the most maintenance effort?',
    reply: 'Highest-frequency maintenance offenders and any retire candidates.',
    render: (ctx) => <MaintenanceFrequencySection params={{ days: Math.max(ctx.windowDays, 180) }} />,
  },
];

const CATEGORIES = ['Overview', 'Fleet', 'Rentals', 'Operations', 'Finance', 'Procurement', 'Maintenance'];

const WINDOW_PRESETS = [
  { label: 'Last 30 days',  days: 30  },
  { label: 'Last 90 days',  days: 90  },
  { label: 'Last 180 days', days: 180 },
  { label: 'Last 365 days', days: 365 },
];

const GREETING_ID = 'greeting';

// ── Message components ───────────────────────────────────────────────────

function UserBubble({ text, timestamp }) {
  return (
    <div className="flex items-start gap-3 justify-end animate-[chatIn_0.24s_ease-out_both]">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary-600 text-white px-4 py-2.5 shadow-sm">
        <p className="text-sm leading-snug whitespace-pre-wrap">{text}</p>
        {timestamp && (
          <p className="text-[10px] text-white/70 mt-1 text-right">{timestamp}</p>
        )}
      </div>
      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
        <UserIcon size={14} className="text-primary-600" />
      </div>
    </div>
  );
}

function AssistantBubble({ reply, children, timestamp }) {
  return (
    <div className="flex items-start gap-3 animate-[chatIn_0.24s_ease-out_both]">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shrink-0 shadow-sm">
        <Sparkles size={14} className="text-white" />
      </div>
      <div className="max-w-full flex-1 min-w-0 space-y-2">
        {reply && (
          <div className="inline-block rounded-2xl rounded-tl-sm bg-white border border-slate-100 px-4 py-2.5 shadow-sm">
            <p className="text-sm text-slate-700 leading-snug">{reply}</p>
          </div>
        )}
        {children && (
          <div className="w-full">
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

// ── Page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [windowDays, setWindowDays] = useState(90);
  const [messages, setMessages] = useState(() => [{
    id: GREETING_ID,
    role: 'assistant',
    reply: 'Hi! I can surface deterministic insights from your rentals, procurement, maintenance, revenue and fleet data. Pick a prompt below to get started — I only answer from the questions I know.',
    timestamp: stamp(),
  }]);
  const [activeCategory, setActiveCategory] = useState('Overview');

  const scrollerRef = useRef(null);
  const scrollAnchorRef = useRef(null);

  // Entering the workspace (sidebar → /analytics) mounts this page, so a
  // mount-scoped gate is exactly "animate on entry". Nothing is being
  // fetched at this point — the greeting is static — so this resolves to
  // the minimum duration. Navigating away and back re-mounts and replays.
  const enteringWorkspace = useMinDurationGate();

  // Auto-scroll to the newest message. Uses requestAnimationFrame so the
  // scroll happens AFTER the new bubble has laid out, otherwise the anchor
  // is still at its old position when we scroll.
  // `enteringWorkspace` is a dependency because the transcript (and with it
  // the scroll anchor) only mounts once the entry animation finishes — the
  // anchor ref is still null on the mount pass, so without this the first
  // scroll would silently no-op.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => cancelAnimationFrame(raf);
  }, [messages.length, enteringWorkspace]);

  const ctx = useMemo(() => ({ windowDays }), [windowDays]);

  const askPrompt = useCallback((prompt) => {
    if (!prompt) return;
    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now() + 1}`;
    setMessages(prev => [
      ...prev,
      { id: uid, role: 'user', text: prompt.userSays, timestamp: stamp() },
      {
        id: aid,
        role: 'assistant',
        promptId: prompt.id,
        reply: prompt.reply,
        renderFn: prompt.render,
        timestamp: stamp(),
      },
    ]);
  }, []);

  const handleReset = useCallback(() => {
    setMessages([{
      id: GREETING_ID,
      role: 'assistant',
      reply: 'Cleared. Pick a prompt below to start a fresh conversation.',
      timestamp: stamp(),
    }]);
  }, []);

  const handleRefreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['analytics'] });
  }, [qc]);

  const visiblePrompts = useMemo(
    () => PROMPTS.filter(p => p.category === activeCategory),
    [activeCategory]
  );

  return (
    <div className="flex flex-col h-full min-h-[600px] gap-4">
      {/* Keyframes for message entry — kept inline so the page ships as one
          drop-in file with no global CSS additions. */}
      <style>{`
        @keyframes chatIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-700 via-primary-600 to-gray-900 p-5 text-white shadow-lg shrink-0">
        <div className="absolute -top-14 -right-14 w-64 h-64 rounded-full bg-white/10 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <BarChart3 size={20} className="text-white" />
            </div>
            <div>
              <p className="text-white/70 text-xs">Chat with your data</p>
              <h1 className="text-xl font-bold leading-tight">Analytics Assistant</h1>
              {profile?.name && (
                <p className="text-white/70 text-xs mt-0.5">Signed in as {profile.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-2">
              <Calendar size={13} />
              <select
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="bg-transparent text-sm text-white outline-none [&>option]:text-slate-800"
                aria-label="Analytics window"
              >
                {WINDOW_PRESETS.map(p => (
                  <option key={p.days} value={p.days}>{p.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleRefreshAll}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs transition-colors"
              title="Re-fetch every analytics query"
            >
              <RefreshCw size={13} />
              Refresh
            </button>
            <button
              onClick={handleReset}
              className="bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs transition-colors"
              title="Clear the conversation"
            >
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* ── Chat surface ───────────────────────────────────────────────── */}
      {/* `relative` is load-bearing: the entry animation positions itself
          absolutely over this card, so it cannot shift any layout and the
          page header above stays visible and interactive throughout. The
          transcript and prompt picker are held back until it finishes, so
          nothing shows through the artwork; they then mount and cross-fade
          in underneath the departing loader. */}
      <div className="flex-1 min-h-0 neo-card p-0 overflow-hidden flex flex-col relative">
        {!enteringWorkspace && (
        <>
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-5 bg-gradient-to-b from-slate-50/50 to-white"
        >
          {messages.map(m => (
            m.role === 'user' ? (
              <UserBubble key={m.id} text={m.text} timestamp={m.timestamp} />
            ) : (
              <AssistantBubble key={m.id} reply={m.reply} timestamp={m.timestamp}>
                {m.renderFn ? (
                  <ChatSection renderFn={m.renderFn} ctx={ctx} />
                ) : null}
              </AssistantBubble>
            )
          ))}
          {/* Scroll anchor — an invisible sentinel we scrollIntoView on. */}
          <div ref={scrollAnchorRef} />
        </div>

        {/* ── Prompt picker ─────────────────────────────────────────── */}
        <div className="border-t border-slate-100 bg-white/80 backdrop-blur px-3 md:px-5 py-3 space-y-2 shrink-0">
          {/* Category tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
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

        {/* Same component, same asset, same timings as the per-prompt
            animation — only the message differs. */}
        <ClaudeTypingLoader
          visible={enteringWorkspace}
          message="Preparing your analytics workspace"
        />
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
