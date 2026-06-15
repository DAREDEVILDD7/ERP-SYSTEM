import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Loader2, KeyRound, X } from 'lucide-react';

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ onClose, onSuccess }) {
  const { changePassword } = useAuth();
  const [form, setForm]     = useState({ old: '', new: '', confirm: '' });
  const [show, setShow]     = useState({ old: false, new: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const toggle = (field) => setShow(s => ({ ...s, [field]: !s[field] }));
  const set    = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.old || !form.new || !form.confirm) {
      setError('All fields are required.'); return;
    }
    if (form.new.length < 6) {
      setError('New password must be at least 6 characters.'); return;
    }
    if (form.new !== form.confirm) {
      setError('New passwords do not match.'); return;
    }

    setLoading(true);
    try {
      await changePassword(form.old, form.new);
      onSuccess?.();
    } catch (err) {
      setError(err.message || 'Password change failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-primary-500" />
            <h2 className="font-semibold text-gray-900">Change Password</h2>
          </div>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {[
            { key: 'old',     label: 'Current Password' },
            { key: 'new',     label: 'New Password' },
            { key: 'confirm', label: 'Confirm New Password' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <div className="relative">
                <input
                  type={show[key] ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                  required
                />
                <button type="button" onClick={() => toggle(key)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {show[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={loading}
              className="btn-primary text-sm flex items-center gap-2">
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Login Page ───────────────────────────────────────────────────────────────
export default function Login() {
  const { login }   = useAuth();
  const navigate    = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showChangePw, setShowChangePw] = useState(false);

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
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500 mb-4">
            <span className="text-white text-xl font-bold">KW</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">KW Ops Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to continue</p>
        </div>

        {/* Card */}
        <div className="card p-6">
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
                className="input"
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
                  className="input pr-10"
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
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

          </form>
        </div>

        {/* Forgot / Change password link */}
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => setShowChangePw(true)}
            className="text-xs text-primary-500 hover:text-primary-700 underline underline-offset-2"
          >
            Change password
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          KW Operations — Internal Portal
        </p>
      </div>

      {/* Change password modal — user must know their current password */}
      {showChangePw && (
        <ChangePasswordModal
          onClose={() => setShowChangePw(false)}
          onSuccess={() => {
            setShowChangePw(false);
            setError('');
            alert('Password updated. Please sign in with your new password.');
          }}
        />
      )}
    </div>
  );
}