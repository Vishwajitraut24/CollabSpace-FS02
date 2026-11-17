'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Sparkles, Workflow } from 'lucide-react';
import { API_URL } from '@/lib/config';

type AuthUser = { id: string; name: string; email: string; avatarUrl?: string | null };
type AuthSession = { token: string; user: AuthUser };
type Props = {
  onAuthenticated: (session: AuthSession) => void;
  notice?: string;
};

export default function AuthPage({ onAuthenticated, notice }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (registering && password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registering ? { name, email, password } : { email, password }),
      });
      const result = await response.json() as AuthSession & {
        error?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      };
      if (!response.ok) {
        const validationMessage = Object.values(result.details?.fieldErrors ?? {}).flat()[0];
        throw new Error(validationMessage || result.error || 'Could not authenticate your account.');
      }
      if (!result.token || !result.user?.id) throw new Error('The server returned an incomplete sign-in response.');
      onAuthenticated(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reach CollabSpace. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError('');
    setPassword('');
    setConfirmation('');
  }

  return (
    <main className="auth-screen">
      <div className="auth-shell">
        <aside className="auth-hero">
          <div className="auth-brand"><span className="brand-mark"><Workflow size={19} /></span><b>collabspace</b></div>
          <div className="auth-hero-copy">
            <span className="auth-eyebrow"><Sparkles size={14} /> ONE SPACE. BETTER WORK.</span>
            <h1>Make great work happen, together.</h1>
            <p>Bring your team, plans, conversations and ideas into one calm, connected workspace.</p>
            <div className="auth-benefits">
              <span><i>01</i> Projects and tasks that stay in sync</span>
              <span><i>02</i> Live collaborative documents</span>
              <span><i>03</i> A clearer view of your team’s work</span>
            </div>
          </div>
          <small className="auth-hero-foot">A focused workspace for teams that build together.</small>
        </aside>

        <section className="auth-panel" aria-labelledby="auth-heading">
          <div className="auth-panel-top"><LockKeyhole size={15} /> Secure workspace access</div>
          <div className="auth-heading">
            <span className="auth-eyebrow">{registering ? 'GET STARTED' : 'WELCOME BACK'}</span>
            <h2 id="auth-heading">{registering ? 'Create your account' : 'Sign in to CollabSpace'}</h2>
            <p>{registering ? 'Your account and personal workspace are created together.' : 'Enter your details to continue to your workspace.'}</p>
          </div>

          <div className="auth-mode-switch" role="tablist" aria-label="Account action">
            <button type="button" role="tab" aria-selected={!registering} className={!registering ? 'active' : ''} onClick={() => changeMode('login')}>Sign in</button>
            <button type="button" role="tab" aria-selected={registering} className={registering ? 'active' : ''} onClick={() => changeMode('register')}>Create account</button>
          </div>

          {(notice || error) && <div className={`auth-alert ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

          <form className="auth-form" onSubmit={submit}>
            {registering && <label>
              <span>Full name</span>
              <input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Your name" />
            </label>}
            <label>
              <span>Email address</span>
              <input autoComplete="email" required type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" />
            </label>
            <label>
              <span>Password</span>
              <span className="auth-password-field">
                <input autoComplete={registering ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={registering ? 'At least 8 characters' : 'Enter your password'} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </span>
            </label>
            {registering && <label>
              <span>Confirm password</span>
              <input autoComplete="new-password" required minLength={8} maxLength={128} type={showPassword ? 'text' : 'password'} value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="Enter your password again" />
            </label>}
            <button className="primary-btn full auth-submit" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'} {!busy && <ArrowRight size={16} />}</button>
          </form>

          <p className="auth-switch-copy">
            {registering ? 'Already have an account?' : 'New to CollabSpace?'}{' '}
            <button type="button" onClick={() => changeMode(registering ? 'login' : 'register')}>{registering ? 'Sign in' : 'Create an account'}</button>
          </p>
        </section>
      </div>
      <footer className="auth-footer"><span>© {new Date().getFullYear()} CollabSpace</span><span>Keep your team’s work connected.</span></footer>
    </main>
  );
}
