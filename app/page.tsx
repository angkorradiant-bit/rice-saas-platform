'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const router = useRouter()
  const [checkingAuth, setCheckingAuth] = useState(true)
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  
  // State for toggling password visibility
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    // 1. Initial check: Unblock the screen immediately if there is no session (e.g., Incognito Mode)
    const checkInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setCheckingAuth(false);
      }
    };
    checkInitialSession();

    // 2. The Listener: Handle background logins and auto-redirects
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        // 🔥 FIX: Stop the auto-redirect if we are trying to reset a password!
        if (window.location.pathname === '/update-password') {
          setCheckingAuth(false); // Unblock the screen but stay on the page
          return; 
        }
        
        router.push('/pos');
      } else {
        // If the user logs out or the session dies, ensure the login form is visible
        setCheckingAuth(false);
      }
    });

    // Cleanup the listener when the component unmounts
    return () => {
      subscription.unsubscribe();
    };
  }, [router])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); // 🔥 Fixed
    setErrorMsg('');

    try {
      // 1. Attempt standard login
      const { data: authData, error: loginErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginErr) throw loginErr;

      // 2. 🔥 SaaS BILLING GATEKEEPER
      if (authData.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', authData.user.id)
          .single();

        if (profile?.tenant_id) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('subscription_status, trial_end_date, subscription_end_date')
            .eq('id', profile.tenant_id)
            .single();

          const status = tenant?.subscription_status;

          // Mode 1: PENDING
          if (status === 'Pending') {
            await supabase.auth.signOut();
            throw new Error('Your workspace is still pending approval. We will email you when it is ready.');
          }

          // Mode 2: TRIAL
          if (status === 'Trial') {
            if (tenant?.trial_end_date && new Date(tenant.trial_end_date) < new Date()) {
              await supabase.auth.signOut();
              throw new Error('Your 14-day trial has expired. Please contact support to upgrade to a Monthly plan.');
            }
          }

          // Mode 3: MONTHLY ACTIVE
          if (status === 'Monthly') {
            if (tenant?.subscription_end_date && new Date(tenant.subscription_end_date) < new Date()) {
              await supabase.auth.signOut();
              throw new Error('Your monthly subscription has expired. Please renew to regain access to your POS.');
            }
          }

          // Mode 4: MASTER 
          // If status is 'Master', the code naturally skips all the IF statements above and lets you straight in!
        }
      }

      // 3. If they are Active or Trial, let them in!
      router.push('/dashboard');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false); // 🔥 Fixed
    }
  }

  // Prevents the login screen from flashing if the user is already logged in
  if (checkingAuth) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Arial, sans-serif', color: '#64748b' }}>
        Authenticating...
      </div>
    )
  }

  return (
    // Fixed positioning locks the container so it doesn't bounce or move around on mobile browsers
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f8fafc', padding: '20px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ background: '#ffffff', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', width: '100%', maxWidth: '380px' }}>
        <h2 style={{ textAlign: 'center', margin: '0 0 8px 0', color: '#111827', fontSize: '24px', fontWeight: 'bold' }}>🌾 Angkor Radiant</h2>
        <p style={{ textAlign: 'center', color: '#64748b', margin: '0 0 30px 0', fontSize: '14px' }}>Sign in to the POS System</p>

        {errorMsg && (
          <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '6px', marginBottom: '20px', fontSize: '13px', textAlign: 'center', fontWeight: 'bold' }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', fontSize: '12px', color: '#475569', textTransform: 'uppercase' }}>Email Address</label>
            <input 
              type="email" 
              required 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '14px', color: '#333' }} 
              onFocus={e => e.target.style.borderColor = '#b58a3d'} 
              onBlur={e => e.target.style.borderColor = '#cbd5e1'} 
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '12px', color: '#475569', textTransform: 'uppercase' }}>Password</label>
              <button 
                type="button" 
                onClick={() => router.push('/forgot-password')} 
                style={{ background: 'none', border: 'none', color: '#b58a3d', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}
              >
                Forgot password?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                style={{ width: '100%', padding: '12px', paddingRight: '40px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '14px', color: '#333' }} 
                onFocus={e => e.target.style.borderColor = '#b58a3d'} 
                onBlur={e => e.target.style.borderColor = '#cbd5e1'} 
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            style={{ width: '100%', padding: '14px', background: '#b58a3d', color: 'white', border: 'none', borderRadius: '6px', fontSize: '15px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '10px', transition: 'background 0.2s' }}
            onMouseOver={e => e.currentTarget.style.background = '#a17a36'}
            onMouseOut={e => e.currentTarget.style.background = '#b58a3d'}
          >
            {loading ? 'Authenticating...' : 'Secure Login'}
          </button>
        </form>
      </div>
    </div>
  )
}