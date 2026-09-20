'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    verifySuperAdmin();
  }, []);

  const verifySuperAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    // 1. If not logged in at all, kick them out
    if (!user) {
      return router.push('/'); 
    }

    // 2. Check their God Mode status
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (profile?.is_super_admin === true) {
      setIsAuthorized(true); // Let them through!
    } else {
      router.push('/'); // Kick out normal users, cashiers, and regular admins
    }
  };

  // Prevent UI flashing while checking the database
  if (!isAuthorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 z-50">
        <div className="text-slate-500 animate-pulse font-medium">Verifying God Mode clearance...</div>
      </div>
    );
  }

  return <>{children}</>;
}