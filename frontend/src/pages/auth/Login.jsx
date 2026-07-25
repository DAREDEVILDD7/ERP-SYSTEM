import { useState, useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Loader2, KeyRound, X, ShieldCheck } from 'lucide-react';
import { LogoDockContext } from '../../components/loading/LogoDockContext';
import { submitPasswordResetRequest } from '../../api/passwordResetRequests';

/* ---------------------------------------------------------------------------
 * Post-dock UI reveal (added on top of the already-approved logo dock).
 *
 * Once the loading animation's logo lands in `logoSlotRef` below (signaled
 * by `dock.revealed`), the JTC logo shows immediately but everything else on
 * this page - heading, subtitle, the card/form, the "Forgot password" link,
 * the footer - stays invisible for one short beat, then cascades in. This is
 * purely a presentation-timing layer: no layout, structure, or class changes
 * to the elements it applies to (all still render, in their normal flow
 * position, the whole time - only their `opacity`/`transform` are toggled),
 * so nothing about the page can jump or shift when it reveals.
 * ------------------------------------------------------------------------- */
const UI_REVEAL_DELAY_MS = 180; // pause after the logo lands, logo-alone
const UI_REVEAL_STEP_MS  = 60;  // stagger between each successive element
const UI_REVEAL_DUR_MS   = 280;
// Same family of curve as the logo's own dock easing (JTCLogoAnimation's
// DOCK_EASE), reused here only so the hand-off reads as one continuous
// motion language - this file never touches that constant or the animation.
const UI_REVEAL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const GENERIC_RESET_CONFIRMATION =
  'If your account is eligible, your password reset request has been submitted to an administrator.';

// ─── Forgot Password Confirmation Modal ───────────────────────────────────────
// Two-step: (1) ask the user whether to submit a reset request, capturing
// the username; (2) show the generic confirmation regardless of outcome.
function ForgotPasswordDialog({ defaultUsername, onClose }) {
  const [username, setUsername] = useState(defaultUsername || '');
  const [step, setStep]         = useState('confirm'); // 'confirm' | 'done'
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
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

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  className="input focus:ring-jtc focus:border-jtc"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  maxLength={100}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onClose}
                  className="btn-secondary text-sm">Cancel</button>
                <button type="submit" disabled={submitting}
                  className="btn-primary text-sm flex items-center gap-2 bg-jtc hover:bg-jtc-dark">
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
  // moment it finishes, then flips this static image to visible in the
  // same spot. Outside that wrapper (dock === null) the logo just shows.
  const dock = useContext(LogoDockContext);
  const logoSlotRef = useRef(null);
  useEffect(() => {
    dock?.registerSlot(logoSlotRef.current);
    return () => dock?.registerSlot(null);
  }, [dock]);

  // Rest of the UI (heading/subtitle/card/link/footer): revealed a short
  // beat after the logo lands. With no AppLoadingGate present at all (dock
  // === null - e.g. an isolated render), there is no dock signal to wait
  // for, so it shows immediately rather than staying hidden forever.
  const [uiRevealed, setUiRevealed] = useState(() => !dock);
  useEffect(() => {
    if (!dock?.revealed) return;
    const id = window.setTimeout(() => setUiRevealed(true), UI_REVEAL_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [dock]);

  const revealStyle = (step) => ({
    opacity: uiRevealed ? 1 : 0,
    transform: uiRevealed ? 'translateY(0)' : 'translateY(10px)',
    transition: uiRevealed
      ? `opacity ${UI_REVEAL_DUR_MS}ms ${UI_REVEAL_EASE} ${step * UI_REVEAL_STEP_MS}ms, ` +
        `transform ${UI_REVEAL_DUR_MS}ms ${UI_REVEAL_EASE} ${step * UI_REVEAL_STEP_MS}ms`
      : 'none',
    pointerEvents: uiRevealed ? 'auto' : 'none',
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showForgotPw, setShowForgotPw] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/dashboard');
    } catch (err) {
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
                opacity: dock ? (dock.revealed ? 1 : 0) : 1,
              }}
            />
          </div>
          {/* <h1 className="text-2xl font-semibold text-black" style={revealStyle(0)}>JTC Ops Portal</h1> */}
          <p className="text-sm text-gray-500 mt-1" style={revealStyle(0)}>Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="card p-6" style={revealStyle(1)}>
          <form onSubmit={handleSubmit} className="space-y-4">

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                className="input focus:ring-jtc focus:border-jtc"
                placeholder="Enter your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
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
                  className="input pr-10 focus:ring-jtc focus:border-jtc"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 bg-jtc hover:bg-jtc-dark"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
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
