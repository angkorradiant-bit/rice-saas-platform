'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useUserRole } from '@/lib/useUserRole'

// Define the shape of our context
interface Branch {
  id: number;
  name: string;
}

interface BranchContextType {
  branches: Branch[];
  activeBranchId: number;
  setActiveBranchId: (id: number) => void;
  isLoadingBranches: boolean;
  addBranch: (newBranch: Branch) => void; // 🔥 ADDED THIS
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number>(1); // Default to SMC
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  
  const { role, loadingRole } = useUserRole();

  useEffect(() => {
    async function loadBranchData() {
      // 1. Fetch user session and profile data
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoadingBranches(false); // 🔥 BUG FIX: Release the loading lock if no session
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('branch_id, role') 
        .eq('id', session.user.id)
        .single();

      // 2. Fetch all available branches
      const { data: allBranches } = await supabase.from('branches').select('*');
      if (allBranches) setBranches(allBranches);

      if (profile) {
        // 🔥 THE ROLE BARRIER
        const isAdmin = profile.role === 'admin' || profile.role === 'owner'; 

        if (isAdmin) {
          // 👑 ADMIN: Allow localStorage override to roam between branches
          const locallySavedBranch = localStorage.getItem('pos_active_branch_id');
          if (locallySavedBranch) {
            setActiveBranchId(Number(locallySavedBranch));
          } else {
            setActiveBranchId(profile.branch_id);
            localStorage.setItem('pos_active_branch_id', String(profile.branch_id));
          }
        } else {
          // 🔒 REGULAR STAFF: Strictly lock to their database branch
          setActiveBranchId(profile.branch_id);
          
          // Safety wipe: Clear any lingering admin overrides off this device
          localStorage.removeItem('pos_active_branch_id'); 
        }
      }
      
      setIsLoadingBranches(false); // 🔥 BUG FIX: Release the loading lock successfully!
    }

    loadBranchData();
  }, []);

  // 🔥 CLOSURE FIX: Wrap in useCallback to prevent infinite render cycles across the app
  const handleSetBranch = useCallback((newBranchId: number) => {
    if (newBranchId !== activeBranchId) {
      setActiveBranchId(newBranchId);
      localStorage.setItem('pos_active_branch_id', String(newBranchId));
      
      // 💣 THE SECURITY WIPE: Clears legacy keys (Branch-specific keys are handled in their own components)
      localStorage.removeItem('pos_cart');
      localStorage.removeItem('pos_customer');
      localStorage.removeItem('pos_override');
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('branch_changed'));
      }
    }
  }, [activeBranchId]);

  return (
    <BranchContext.Provider value={{ 
      activeBranchId, 
      branches, 
      setActiveBranchId: handleSetBranch,
      isLoadingBranches,
      addBranch: (newBranch: Branch) => setBranches(prev => [...prev, newBranch]) // 🔥 INSTANT UI UPDATE
    }}>
      {children}
    </BranchContext.Provider>
  );
} // 🔥 FIX 2: Added this closing bracket for the BranchProvider function!

// Hook to use the branch context anywhere in the app
export const useBranch = () => {
  const context = useContext(BranchContext);
  if (!context) throw new Error("useBranch must be used within a BranchProvider");
  return context;
};