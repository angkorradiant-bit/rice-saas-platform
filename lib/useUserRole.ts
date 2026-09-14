'use client' // 🔥 NEXT.JS FIX: Explicitly marks this hook as client-side logic

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// 🚀 FIXED: Changed to completely lowercase to match the database perfectly
export type UserRole = 'admin' | 'manager' | 'cashier' | null;

export function useUserRole() {
  const [role, setRole] = useState<UserRole>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data, error } = await supabase
     .from('profiles')
     .select('role')
     .eq('id', user.id)
     .maybeSingle(); // 🌟 Fixed!
        
        if (data && data.role) {
          // Force it to lowercase just in case the database has weird casing
          setRole(String(data.role).toLowerCase() as UserRole);
        }
      }
      setLoadingRole(false);
    }
    
    fetchRole();
  }, []);

  return { role, loadingRole };
}