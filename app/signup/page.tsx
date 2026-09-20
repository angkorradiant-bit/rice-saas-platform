'use client'

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState({ company_name: '', full_name: '', email: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    try {
      // 1. Call our secure provisioning API
      const res = await fetch('/api/auth/register-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // 2. STOP HERE. Do not log them in. Show the success screen instead.
      setIsSubmitted(true);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  // === SUCCESS SCREEN ===
  if (isSubmitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ background: '#fff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '100%', maxWidth: '450px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <h1 style={{ margin: '0 0 12px 0', color: '#0f172a', fontSize: '24px' }}>Request Received</h1>
          <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
            Thank you for applying to use our platform. Your workspace for <strong>{form.company_name}</strong> has been created and is currently awaiting administrator approval.
          </p>
          <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
            We will contact you at <strong>{form.email}</strong> once your account is activated.
          </p>
          <button onClick={() => router.push('/')} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s' }}>
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  // === APPLICATION FORM ===
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ background: '#fff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '100%', maxWidth: '450px' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '24px' }}>Request a Workspace</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>Submit your details to request access to the platform.</p>
        </div>

        {errorMsg && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', border: '1px solid #fecaca' }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>DEPOT / COMPANY NAME</label>
            <input 
              required 
              type="text" 
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              placeholder="e.g. Sok Chea Rice Co." 
              value={form.company_name} 
              onChange={e => setForm({ ...form, company_name: e.target.value })} 
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>YOUR FULL NAME</label>
            <input 
              required 
              type="text" 
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              placeholder="e.g. Sok Chea" 
              value={form.full_name} 
              onChange={e => setForm({ ...form, full_name: e.target.value })} 
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>EMAIL ADDRESS</label>
            <input 
              required 
              type="email" 
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              placeholder="owner@example.com" 
              value={form.email} 
              onChange={e => setForm({ ...form, email: e.target.value })} 
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>PASSWORD</label>
            <input 
              required 
              type="password" 
              minLength={6} 
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              placeholder="••••••••" 
              value={form.password} 
              onChange={e => setForm({ ...form, password: e.target.value })} 
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoading} 
            style={{ 
              background: '#10b981', color: 'white', border: 'none', padding: '14px', borderRadius: '8px', 
              fontSize: '15px', fontWeight: 'bold', cursor: isLoading ? 'not-allowed' : 'pointer', marginTop: '10px',
              transition: 'background 0.2s'
            }}
          >
            {isLoading ? 'Submitting Request...' : 'Request Workspace'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: '#64748b' }}>
          Already have an account? <a href="/" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 'bold' }}>Log in here</a>
        </div>
      </div>
    </div>
  );
}