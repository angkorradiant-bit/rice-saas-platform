'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
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
      if (!session) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('branch_id, role') // 🔥 Ensure you are fetching the role!
        .eq('id', session.user.id)
        .single();

      // 2. Fetch all available branches
      const { data: allBranches } = await supabase.from('branches').select('*');
      if (allBranches) setBranches(allBranches);

      if (profile) {
        // 🔥 THE ROLE BARRIER
        const isAdmin = profile.role === 'admin' || profile.role === 'owner'; // Adjust to match your exact DB role names

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
    }

    loadBranchData();
  }, []);

  // 🔥 THE FIX: Whenever the admin selects a new branch from the dropdown, save it to memory!
  const handleSetBranch = (newBranchId: number) => {
    // Only trigger the wipe if they are ACTUALLY changing to a different branch
    if (newBranchId !== activeBranchId) {
      setActiveBranchId(newBranchId);
      localStorage.setItem('pos_active_branch_id', String(newBranchId));
      
      // 💣 THE SECURITY WIPE: Destroy active cart and customer data to prevent cross-branch contamination!
      localStorage.removeItem('pos_cart');
      localStorage.removeItem('pos_customer');
      localStorage.removeItem('pos_override');
      
      // Fire the custom event so other components know to refetch their data
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('branch_changed'));
      }
    }
  };

  return (
    <BranchContext.Provider value={{ 
      activeBranchId, 
      branches, 
      setActiveBranchId: handleSetBranch,
      isLoadingBranches // 🔥 FIX 1: Added this to satisfy the TypeScript interface
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