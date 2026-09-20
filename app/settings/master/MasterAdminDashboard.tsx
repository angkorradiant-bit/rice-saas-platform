'use client';

import { useEffect, useState } from 'react';
import { Building2, Calendar, Clock, ShieldCheck, Timer } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Tenant = {
  id: string;
  name: string;
  subscription_status: 'Pending' | 'Trial-7' | 'Trial' | 'Monthly' | 'Master';
  trial_start_date: string | null;
  trial_end_date: string | null;
  subscription_end_date: string | null;
  created_at: string;
};

export default function MasterAdminDashboard() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    verifyMasterAccess();
  }, []);

  const verifyMasterAccess = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return router.push('/');

    // 1. Get the user's workspace AND their God Mode status
    const { data: profile } = await supabase.from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).single();
    
    // 🔥 2. GOD MODE CHECK: Unlock instantly if true
    if (profile?.is_super_admin === true) {
      setIsAuthorized(true);
      fetchTenants();
      return;
    }
    
    // 3. Normal check: Are they in the Master workspace?
    if (profile?.tenant_id) {
      const { data: tenant } = await supabase.from('tenants').select('subscription_status').eq('id', profile.tenant_id).single();
      
      if (tenant?.subscription_status === 'Master') {
        setIsAuthorized(true);
        fetchTenants();
        return;
      }
    }
    
    // 4. The Kick-Out Mechanism
    router.push('/');
  };

  const fetchTenants = async () => {
    // 1. Get the current user's session token
    const { data: { session } } = await supabase.auth.getSession();
    
    // 2. Attach the token to the fetch request
    const res = await fetch('/api/admin/tenants', {
      headers: {
        'Authorization': `Bearer ${session?.access_token}`
      }
    });
    
    const data = await res.json();
    if (data.tenants) setTenants(data.tenants);
    setLoading(false);
  };

  const updateTenant = async (tenantId: string, updates: Partial<Tenant>) => {
    // Optimistic UI update
    setTenants(tenants.map(t => t.id === tenantId ? { ...t, ...updates } : t));
    
    // 1. Get the current user's session token
    const { data: { session } } = await supabase.auth.getSession();
    
    // 2. Attach the token to the PATCH request
    await fetch('/api/admin/tenants', {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}` // 🔥 Secure Ticket added here
      },
      body: JSON.stringify({ tenantId, updates }),
    });
    
    fetchTenants();
  };

  // 🔥 1. Calculate live countdown (Current Date vs Expiration Date)
  const getDaysRemaining = (endDateStr: string | null) => {
    if (!endDateStr) return '';
    const end = new Date(endDateStr);
    const now = new Date();
    // Zero out the hours to get perfect day intervals
    end.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  // 🔥 2. Handle manual number editing (Updates the Expiration Date in the DB)
  const handleDaysChange = (tenantId: string, daysStr: string, status: string) => {
    const numDays = parseInt(daysStr, 10);
    if (isNaN(numDays)) return;
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Add the typed days to TODAY to get the new exact expiration date
    const newEndDate = new Date(now.getTime() + (numDays * 24 * 60 * 60 * 1000));
    newEndDate.setMinutes(newEndDate.getMinutes() - newEndDate.getTimezoneOffset()); // Timezone fix
    const newEndDateStr = newEndDate.toISOString().split('T')[0];

    if (status === 'Trial') updateTenant(tenantId, { trial_end_date: newEndDateStr });
    if (status === 'Monthly') updateTenant(tenantId, { subscription_end_date: newEndDateStr });
  };

  // 🔥 3. Auto-calculate dates when changing dropdown status
  const handleStatusChange = (tenantId: string, newStatus: string) => {
    const updates: Partial<Tenant> = { subscription_status: newStatus as any };
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (newStatus === 'Trial') {
      const end = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
      end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
      updates.trial_end_date = end.toISOString().split('T')[0];
      updates.trial_start_date = new Date().toISOString(); 
    } else if (newStatus === 'Trial-7') {
      const end = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
      end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
      updates.trial_end_date = end.toISOString().split('T')[0];
      updates.trial_start_date = new Date().toISOString(); 
    } else if (newStatus === 'Monthly') {
      const end = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
      end.setMinutes(end.getMinutes() - end.getTimezoneOffset());
      updates.subscription_end_date = end.toISOString().split('T')[0];
    }

    updateTenant(tenantId, updates);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'Trial-7': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'Trial': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Monthly': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Master': return 'bg-purple-50 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  // Prevent the UI from flashing on the screen if an unauthorized user tries to load it
  if (!isAuthorized || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500 animate-pulse font-medium">Verifying Command Center access...</div>
      </div>
    );
  }

  return (
    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: '#f8fafc', paddingTop: '20px', boxSizing: 'border-box' }}>
      
      <div className="header-container" style={{ flexShrink: 0, marginLeft: '60px', display: 'flex', alignItems: 'center', minHeight: '44px', marginBottom: '24px' }}>
        <div className="header-left" style={{ display: 'flex', alignItems: 'center' }}>
          <h1 className="saas-page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '24px', fontWeight: 'bold', lineHeight: '1' }}>
            <ShieldCheck className="w-7 h-7 text-purple-600" />
            <span style={{ display: 'inline-block', transform: 'translateY(1px)' }}>SaaS Command Center</span>
          </h1>
        </div>
      </div>
      
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingBottom: '60px', marginLeft: '60px', paddingRight: '24px' }}>
        <p className="text-slate-500 mb-6">Manage all registered businesses, billing states, and access limits.</p>
        
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden max-w-7xl">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-6 py-4 font-semibold"><Building2 className="w-4 h-4 inline mr-2" /> Workspace</th>
                <th className="px-6 py-4 font-semibold"><Clock className="w-4 h-4 inline mr-2" /> Start Date</th>
                <th className="px-6 py-4 font-semibold"><Timer className="w-4 h-4 inline mr-2" /> Days Left</th>
                <th className="px-6 py-4 font-semibold"><Calendar className="w-4 h-4 inline mr-2" /> Expiration Date</th>
                <th className="px-6 py-4 font-semibold">Billing Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((tenant) => {
                const isTrial = tenant.subscription_status === 'Trial' || tenant.subscription_status === 'Trial-7';
                const isMonthly = tenant.subscription_status === 'Monthly';
                const isExempt = tenant.subscription_status === 'Pending' || tenant.subscription_status === 'Master';
                
                const startDate = tenant.trial_start_date ? tenant.trial_start_date.split('T')[0] : '—';
                const endDate = isTrial ? tenant.trial_end_date : (isMonthly ? tenant.subscription_end_date : null);
                
                const daysLeft = getDaysRemaining(endDate);
                const isExpired = typeof daysLeft === 'number' && daysLeft <= 0;

                return (
                  <tr key={tenant.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{tenant.name}</td>
                    
                    <td className="px-6 py-4 text-slate-500">{startDate}</td>
                    
                    {/* 🔥 EDITABLE NUMBER FIELD */}
                    <td className="px-6 py-4">
                      {isExempt ? (
                        <span className="text-slate-400 italic">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={daysLeft}
                            onChange={(e) => handleDaysChange(tenant.id, e.target.value, tenant.subscription_status)}
                            className={`w-20 border rounded-md px-3 py-1.5 text-sm font-bold text-center focus:ring-2 outline-none transition-all ${
                              isExpired 
                                ? 'bg-red-50 border-red-300 text-red-700 focus:ring-red-500' 
                                : 'border-slate-200 text-slate-900 focus:border-purple-500 focus:ring-purple-500'
                            }`}
                          />
                          <span className={`text-xs font-bold ${isExpired ? 'text-red-600' : 'text-slate-400'}`}>
                            {isExpired ? 'EXPIRED' : 'days'}
                          </span>
                        </div>
                      )}
                    </td>
                    
                    {/* CALENDAR FIELD (Two-way synced) */}
                    <td className="px-6 py-4">
                      {isExempt ? (
                        <span className="text-slate-400 italic">No expiration</span>
                      ) : (
                        <input
                          type="date"
                          value={endDate ? endDate.split('T')[0] : ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (isTrial) updateTenant(tenant.id, { trial_end_date: val });
                            if (isMonthly) updateTenant(tenant.id, { subscription_end_date: val });
                          }}
                          className={`border rounded-md px-3 py-1.5 text-sm outline-none transition-all ${
                            isExpired 
                              ? 'bg-red-50 border-red-300 text-red-700' 
                              : 'border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        />
                      )}
                    </td>
                    
                    <td className="px-6 py-4">
                      <select
                        value={tenant.subscription_status}
                        onChange={(e) => handleStatusChange(tenant.id, e.target.value)}
                        className={`border rounded-full px-3 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-purple-500 appearance-none cursor-pointer ${getStatusBadge(tenant.subscription_status)}`}
                      >
                        <option value="Pending">Pending (Locked)</option>
                        <option value="Trial-7">7-Day Trial</option>
                        <option value="Trial">14-Day Trial</option>
                        <option value="Monthly">Monthly Active</option>
                        <option value="Master">Master Admin</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}