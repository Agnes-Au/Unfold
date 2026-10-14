import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const DEMO_EMAIL = 'demo.worker@unfold.local';
const DEMO_PASSWORD = 'demo1234';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  // The seeded demo account only exists when the server runs in demo mode.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((health) => {
        if (!cancelled && health?.demoMode) setDemoMode(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(
        err.code === 'invalid_credentials'
          ? 'Invalid email or password.'
          : 'Could not sign in. Is the server running?'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        <p className="muted">Unfold Social Worker Console</p>

        {demoMode && (
          <div className="alert alert-info">
            <strong>Demo account</strong>
            <br />
            Email: <code>{DEMO_EMAIL}</code>
            <br />
            Password: <code>{DEMO_PASSWORD}</code>
            <button
              type="button"
              className="btn btn-secondary demo-fill"
              onClick={() => {
                setEmail(DEMO_EMAIL);
                setPassword(DEMO_PASSWORD);
              }}
            >
              Fill in demo account
            </button>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="muted small">
          No account yet? <Link to="/register">Register as a social worker</Link>
        </p>
      </form>
    </div>
  );
}
