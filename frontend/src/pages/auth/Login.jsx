import { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Loader2, KeyRound, X, ShieldCheck, ShieldAlert } from 'lucide-react';
import { LogoDockContext } from '../../components/loading/LogoDockContext';
import { submitPasswordResetRequest } from '../../api/passwordResetRequests';

/* ---------------------------------------------------------------------------
 * Post-dock UI reveal (added on top of the already-approved logo dock).
 *
 * Once the loading animation's logo has landed in `logoSlotRef` below
 * (signalled by `dock.revealed`), the overlay's parked logo instance is
 * still the visible logo (this page's own `<img>` stays hidden - see
 * `dock.logoVisible`, flipped only at retirement) and everything else on
 * this page - heading, subtitle, the card/form, the "Forgot password"
 * link, the footer - stays invisible for one short beat, then cascades
 * in. This is purely a presentation-timing layer: no layout, structure
 * or class changes to the elements it applies to (all still render, in
 * their normal flow position, the whole time - only their `opacity` /
 * `transform` are toggled), so nothing about the page can jump or shift
 * when it reveals.
 * ------------------------------------------------------------------------- */
const UI_REVEAL_DELAY_MS = 180;
const UI_REVEAL_STEP_MS  = 60;
const UI_REVEAL_DUR_MS   = 280;
const UI_REVEAL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const GENERIC_RESET_CONFIRMATION =
  'If your account is eligible, your password reset request has been submitted to an administrator.';

/* ─── Client-side brute-force guard ────────────────────────────────────────
 * Stored in localStorage so a page-refresh cannot bypass the lockout.
 * The server's verify_login RPC is the authoritative gate; this guard
 * prevents high-frequency automated attempts and gives immediate UI feedback.
 *
 * Progressive back-off (count never resets until a successful login):
 *   3 fails  →  10 s
 *   5 fails  →  30 s
 *   8 fails  →   2 min
 *  10 fails  →  15 min
 *
 * LOGIN_MIN_ERROR_MS: minimum wall-clock ms before a failed login error is
 * surfaced. The "username not found" DB path returns immediately (no bcrypt);
 * the "wrong password" path runs bcrypt and takes ~200–400 ms. Without this
 * floor an attacker can enumerate valid usernames purely by measuring response
 * time. Equalising both paths to ≥800 ms closes that timing oracle.
 */
const RL_KEY             = 'jtc_login_rl';
const RL_TIERS           = [
  { at: 3,  secs: 10  },
  { at: 5,  secs: 30  },
  { at: 8,  secs: 120 },
  { at: 10, secs: 900 },
];
const LOGIN_MIN_ERROR_MS = 800;

function rlLoad() {
  try { return JSON.parse(localStorage.getItem(RL_KEY) || 'null') ?? { n: 0, until: 0 }; }
  catch { return { n: 0, until: 0 }; }
}
function rlSave(s) { try { localStorage.setItem(RL_KEY, JSON.stringify(s)); } catch {} }
function rlClear()  { try { localStorage.removeItem(RL_KEY); } catch {} }

function useLoginRateLimit() {
  const [rl, setRl] = useState(rlLoad);
  const [secsLeft, setSecsLeft] = useState(0);

  // Countdown ticker while locked
  useEffect(() => {
    if (!rl.until) { setSecsLeft(0); return; }
    const tick = () => {
      const s = Math.ceil((rl.until - Date.now()) / 1000);
      setSecsLeft(s > 0 ? s : 0);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [rl.until]);

  const isLocked = Boolean(rl.until && Date.now() < rl.until);

  const recordFail = useCallback(() => {
    setRl(prev => {
      const n = prev.n + 1;
      // Find the highest applicable tier (tiers are in ascending `at` order)
      let secs = 0;
      for (const tier of RL_TIERS) { if (n >= tier.at) secs = tier.secs; }
      const next = { n, until: secs ? Date.now() + secs * 1000 : 0 };
      rlSave(next);
      return next;
    });
  }, []);

  const recordSuccess = useCallback(() => {
    rlClear();
    setRl({ n: 0, until: 0 });
    setSecsLeft(0);
  }, []);

  return { isLocked, secsLeft, failCount: rl.n, recordFail, recordSuccess };
}

/* ─── Forgot-password per-session cooldown ──────────────────────────────────
 * Module-level: survives dialog open/close cycles (component remounts) but
 * is cleared on page reload. 60 s between submissions prevents request flooding
 * of the admin queue.
 */
let fpwLastSubmit = 0;
const FPW_COOLDOWN_S = 60;

// ─── Forgot Password Confirmation Modal ──────────────────────────────────────
function ForgotPasswordDialog({ defaultUsername, onClose }) {
  const [username,    setUsername]    = useState(defaultUsername || '');
  const [step,        setStep]        = useState('confirm');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  const [cooldownSec, setCooldownSec] = useState(0);

  // Sync cooldown countdown if a submission was made earlier this session
  useEffect(() => {
    if (!fpwLastSubmit) return;
    const tick = () => {
      const s = Math.ceil((fpwLastSubmit + FPW_COOLDOWN_S * 1000 - Date.now()) / 1000);
      setCooldownSec(s > 0 ? s : 0);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Per-session cooldown: one submission every FPW_COOLDOWN_S seconds
    if (fpwLastSubmit) {
      const sinceS = Math.floor((Date.now() - fpwLastSubmit) / 1000);
      if (sinceS < FPW_COOLDOWN_S) {
        setError(`Please wait ${FPW_COOLDOWN_S - sinceS}s before submitting another request.`);
        return;
      }
    }

    const trimmed = username.trim();
    if (!trimmed) {
      setError('Please enter your username.');
      return;
    }
    setSubmitting(true);
    try {
      // Fire-and-forget. Whatever happens on the server, we present the
      // same generic confirmation — never reveal whether the account exists.
      await submitPasswordResetRequest(trimmed);
    } catch (_) {
      // Intentionally swallowed; do not surface backend errors here.
    } finally {
      fpwLastSubmit = Date.now();
      setSubmitting(false);
      setStep('done');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step === 'done'
              ? <ShieldCheck size={18} className="text-jtc" />
              : <KeyRound size={18} className="text-jtc" />}
            <h2 className="font-semibold text-gray-900">
              {step === 'done' ? 'Request Submitted' : 'Forgot Password?'}
            </h2>
          </div>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {step === 'confirm' && (
          <>
            <p className="text-sm text-gray-600 leading-relaxed">
              Would you like to submit a password reset request to the system administrator?
            </p>

            {cooldownSec > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
                <ShieldAlert size={15} className="shrink-0 text-amber-500" />
                <span>Another request can be submitted in{' '}
                  <span className="font-semibold tabular-nums">{cooldownSec}s</span>.
                </span>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  className="input focus:ring-jtc focus:border-jtc"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  maxLength={64}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onClose}
                  className="btn-secondary text-sm">Cancel</button>
                <button
                  type="submit"
                  disabled={submitting || cooldownSec > 0}
                  className="btn-primary text-sm flex items-center gap-2 bg-jtc hover:bg-jtc-dark disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="text-sm text-gray-600 leading-relaxed">
              {GENERIC_RESET_CONFIRMATION}
            </p>
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onClose}
                className="btn-primary text-sm bg-jtc hover:bg-jtc-dark">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Login Page ───────────────────────────────────────────────────────────────
export default function Login() {
  const { login }   = useAuth();
  const navigate    = useNavigate();

  // Bridges to AppLoadingGate (src/components/loading), which drives the
  // loading animation's already-assembled logo into this exact box the
  // moment it finishes. That overlay instance then PARKS here and remains
  // the one visible logo; this static image stays hidden (`logoVisible`
  // false) until the gate retires the overlay at an imperceptible moment
  // (this page unmounting after sign-in, or a resize/scroll). Outside the
  // wrapper (dock === null) the logo just shows.
  const dock = useContext(LogoDockContext);
  const registerSlot = dock?.registerSlot;
  const logoSlotRef = useRef(null);
  // Depends on the gate's stable registerSlot callback - NOT on the whole
  // context value - so `revealed`/`logoVisible` flips can never churn an
  // unregister/re-register here. The slot is registered exactly once and
  // unregistered only when this page truly unmounts, which is the signal
  // the gate uses to retire its parked overlay logo.
  useEffect(() => {
    if (!registerSlot) return undefined;
    registerSlot(logoSlotRef.current);
    return () => registerSlot(null);
  }, [registerSlot]);

  // Rest of the UI (heading/subtitle/card/link/footer): revealed a short
  // beat after the logo lands. With no AppLoadingGate present at all (dock
  // === null - e.g. an isolated render), there is no dock signal to wait
  // for, so it shows immediately rather than staying hidden forever.
  const dockRevealed = !!dock?.revealed;
  const [uiRevealed, setUiRevealed] = useState(() => !dock);
  useEffect(() => {
    if (!dockRevealed) return;
    const id = window.setTimeout(() => setUiRevealed(true), UI_REVEAL_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [dockRevealed]);

  const revealStyle = (step) => ({
    opacity: uiRevealed ? 1 : 0,
    transform: uiRevealed ? 'translateY(0)' : 'translateY(10px)',
    transition: uiRevealed
      ? `opacity ${UI_REVEAL_DUR_MS}ms ${UI_REVEAL_EASE} ${step * UI_REVEAL_STEP_MS}ms, ` +
        `transform ${UI_REVEAL_DUR_MS}ms ${UI_REVEAL_EASE} ${step * UI_REVEAL_STEP_MS}ms`
      : 'none',
    pointerEvents: uiRevealed ? 'auto' : 'none',
  });

  const [username,     setUsername]     = useState('');
  const [password,     setPassword]     = useState('');
  const [showPw,       setShowPw]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [showForgotPw, setShowForgotPw] = useState(false);

  const { isLocked, secsLeft, failCount, recordFail, recordSuccess } = useLoginRateLimit();

  // How many more failures before the first tier kicks in
  const attemptsBeforeLock = Math.max(0, RL_TIERS[0].at - failCount);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (isLocked) return;

    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }

    setLoading(true);
    const t0 = Date.now();
    try {
      await login(username.trim(), password);
      recordSuccess();
      navigate('/dashboard');
    } catch (err) {
      // Enforce minimum error latency. "Username not found" returns from the DB
      // immediately (no hash work); "wrong password" runs bcrypt (~200-400 ms).
      // Without this floor, an attacker can enumerate valid usernames by timing
      // the response. Holding to LOGIN_MIN_ERROR_MS makes both paths identical.
      const elapsed = Date.now() - t0;
      if (elapsed < LOGIN_MIN_ERROR_MS) {
        await new Promise(r => window.setTimeout(r, LOGIN_MIN_ERROR_MS - elapsed));
      }
      recordFail();
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <div
            ref={logoSlotRef}
            className="mx-auto mb-4"
            style={{ width: 180, aspectRatio: '427 / 138' }}
          >
            <img
              src="/logo/jtc-full-logo.svg"
              alt="JTC"
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                // Hidden while the gate's parked overlay logo (the same
                // instance the user watched assemble and glide in) is the
                // visible logo; takes over only at the gate's atomic,
                // imperceptible retirement swap.
                opacity: dock ? (dock.logoVisible ? 1 : 0) : 1,
              }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-1" style={revealStyle(0)}>Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="card p-6" style={revealStyle(1)}>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Lockout banner — shown instead of the error banner when locked */}
            {isLocked && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
                <ShieldAlert size={16} className="shrink-0 text-amber-500" />
                <span>
                  Too many failed attempts. Try again in{' '}
                  <span className="font-semibold tabular-nums">{secsLeft}s</span>.
                </span>
              </div>
            )}

            {/* Login error (only while not locked) */}
            {!isLocked && error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg px-4 py-3">
                {error}
                {/* Warn on the 1st and 2nd failure only — before the first lockout tier */}
                {failCount > 0 && attemptsBeforeLock > 0 && (
                  <span className="block mt-1 text-xs text-red-400">
                    {attemptsBeforeLock} more failed attempt{attemptsBeforeLock !== 1 ? 's' : ''} before a temporary lockout.
                  </span>
                )}
              </div>
            )}

            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                className="input focus:ring-jtc focus:border-jtc disabled:opacity-50"
                placeholder="Enter your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                maxLength={64}
                disabled={loading || isLocked}
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input pr-10 focus:ring-jtc focus:border-jtc disabled:opacity-50"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={loading || isLocked}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || isLocked}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 bg-jtc hover:bg-jtc-dark disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Signing in…</>
              ) : isLocked ? (
                <><ShieldAlert size={16} /> Locked ({secsLeft}s)</>
              ) : (
                'Sign in'
              )}
            </button>

          </form>
        </div>

        {/* Forgot password link */}
        <div className="text-center mt-4" style={revealStyle(2)}>
          <button
            type="button"
            onClick={() => setShowForgotPw(true)}
            className="text-xs text-jtc hover:text-jtc-dark underline underline-offset-2"
          >
            Forgot Password?
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4" style={revealStyle(3)}>
          JTC Operations — Internal Portal
        </p>
      </div>

      {/* Forgot password confirmation dialog */}
      {showForgotPw && (
        <ForgotPasswordDialog
          defaultUsername={username}
          onClose={() => setShowForgotPw(false)}
        />
      )}
    </div>
  );
}
