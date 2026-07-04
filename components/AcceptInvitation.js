'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../lib/supabase';

function invitationInUrl() {
  if (typeof window === 'undefined') return false;
  const query = new URLSearchParams(window.location.search || '');
  const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  return (hash.get('type') || query.get('type')) === 'invite';
}

function removeAuthFragment() {
  if (typeof window === 'undefined') return;
  // The invite token is no longer needed after Supabase has exchanged it for a session.
  window.history.replaceState({}, document.title, window.location.pathname);
}

export default function AcceptInvitation() {
  const router = useRouter();
  const supabase = getSupabase();
  const [session, setSession] = useState(null);
  const [stage, setStage] = useState('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inviteWasDetected = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setStage('configuration');
      return undefined;
    }

    inviteWasDetected.current = invitationInUrl();
    if (!inviteWasDetected.current) {
      setStage('invalid');
      return undefined;
    }

    let mounted = true;
    let fallbackTimer;

    const acceptSession = (nextSession) => {
      if (!mounted || !nextSession?.user) return;
      setSession(nextSession);
      setStage('ready');
      removeAuthFragment();
    };

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        acceptSession(data.session);
        return;
      }
      fallbackTimer = window.setTimeout(() => {
        if (mounted) setStage('expired');
      }, 1800);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.user && inviteWasDetected.current) acceptSession(nextSession);
    });

    return () => {
      mounted = false;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const setAccountPassword = async () => {
    setError('');
    if (!session?.user) {
      setError('Your invitation session is not ready. Open the invitation link again.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for the password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (updateError) {
      setError(updateError.message || 'Unable to set your password. Open a fresh invitation link and try again.');
      return;
    }

    setStage('complete');
    window.setTimeout(() => router.replace('/'), 850);
  };

  const backToSignIn = () => router.replace('/');

  return (
    <div className="login-wrap">
      <div className="card login-card invitation-card">
        <img className="login-logo" src="/assets/halwani-logo.png" alt="Halwani Bros" />
        {stage === 'loading' && <><h1>Preparing your account</h1><p>Checking your invitation securely…</p></>}
        {stage === 'ready' && <>
          <h1>Set your password</h1>
          <p>Welcome to Halwani Food Service. Choose a password to activate your account.</p>
          <div className="invite-email">{session?.user?.email}</div>
          {error && <div className="notice error">{error}</div>}
          <label className="label">New password</label>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 8 characters" />
          <label className="label">Confirm password</label>
          <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" onKeyDown={(event) => event.key === 'Enter' && setAccountPassword()} />
          <button className="button" style={{ width: '100%', marginTop: 18, minHeight: 54 }} disabled={busy || !password || !confirmPassword} onClick={setAccountPassword}>
            {busy ? 'Activating account…' : 'Activate account'}
          </button>
          <p className="muted invite-note">Your password is private. Your manager can create and manage your access, but cannot see this password.</p>
        </>}
        {stage === 'complete' && <>
          <h1>Account activated</h1>
          <p>Your password has been saved. Opening Halwani Food Service…</p>
          <div className="notice success">You are ready to start using the app.</div>
        </>}
        {stage === 'expired' && <>
          <h1>Invitation expired</h1>
          <p>This invitation link is no longer valid or has already been used.</p>
          <div className="notice error">Ask your Food Service administrator to resend the invitation.</div>
          <button className="button" style={{ width: '100%', marginTop: 18 }} onClick={backToSignIn}>Back to sign in</button>
        </>}
        {stage === 'invalid' && <>
          <h1>Invitation link required</h1>
          <p>Open the invitation email and tap its Accept Invitation link to create your password.</p>
          <button className="button" style={{ width: '100%', marginTop: 18 }} onClick={backToSignIn}>Back to sign in</button>
        </>}
        {stage === 'configuration' && <>
          <h1>Cloud setup required</h1>
          <p>The Supabase connection is not configured for this deployment.</p>
          <div className="notice error">Ask the administrator to check the Vercel environment variables.</div>
        </>}
      </div>
    </div>
  );
}
