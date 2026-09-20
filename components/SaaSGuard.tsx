'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function SaaSGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    checkSubscription();
  }, []);

  const checkSubscription = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setIsChecking(false);

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile?.tenant_id) return setIsChecking(false);

    const { data: tenant } = await supabase.from('tenants').select('*').eq('id', profile.tenant_id).single();
    if (!tenant) return setIsChecking(false);

    // Master and Pending skip the expiration math
    if (tenant.subscription_status === 'Master' || tenant.subscription_status === 'Pending') {
      setIsChecking(false);
      return;
    }

    // Calculate if the current date is past the expiration date
    const endDateStr = tenant.subscription_status === 'Monthly' 
      ? tenant.subscription_end_date 
      : tenant.trial_end_date;

    if (endDateStr) {
      const end = new Date(endDateStr);
      const now = new Date();
      end.setHours(0, 0, 0, 0);
      now.setHours(0, 0, 0, 0);
      
      const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysLeft <= 0) {
        setIsExpired(true);
      }
    }
    
    setIsChecking(false);
  };

  if (isChecking) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">Verifying license...</div>;
  }

  if (isExpired) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-slate-50 p-8 text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-2">Subscription Expired</h1>
        <p className="text-slate-600 mb-6 max-w-md">Your workspace access has expired. Please contact the administrator to renew your plan.</p>
        <button onClick={() => supabase.auth.signOut().then(() => router.push('/'))} className="bg-slate-900 text-white px-6 py-2 rounded-lg font-medium">
          Sign Out
        </button>
      </div>
    );
  }

  return <>{children}</>;
}