'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useUserRole } from '@/lib/useUserRole'
import AdminGuard from '@/components/AdminGuard'
import { useBranch } from '@/components/BranchContext' 
import { useToast } from '@/components/ToastProvider'

// ==========================================
// ROBUST LIVE COMMA FORMATTER 
// ==========================================
function CurrencyInput({ value, onChange, onBlur, placeholder, style, className }: any) {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (value === '' || value === 0 || value === undefined) {
      setInputValue('');
    } else {
      const parsed = parseFloat(inputValue.replace(/,/g, ''));
      if (parsed !== Number(value)) {
        setInputValue(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value)));
      }
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');

    let formatted = parts[0] ? new Intl.NumberFormat('en-US').format(parseInt(parts[0], 10)) : '';
    if (parts.length > 1) formatted += '.' + parts[1].substring(0, 2);
    if (raw === '') formatted = '';

    setInputValue(formatted);
    const num = parseFloat(raw);
    onChange(isNaN(num) ? '' : num);
  };

  return (
    <input 
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={inputValue}
      onChange={handleChange}
      onBlur={onBlur}
      style={{ ...style, fontWeight: 'bold' }}
      className={className || "saas-input"}
    />
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { activeBranchId, branches, addBranch } = useBranch() 
  const { showToast } = useToast()
  
  const { role, loadingRole } = useUserRole()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [tenantStatus, setTenantStatus] = useState<string>('')
  const [tenantData, setTenantData] = useState<any>(null) // 🔥 NEW: Store all billing info
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<any[]>([])

  // --- FINANCIAL STATE ---
  const [exchangeRate, setExchangeRate] = useState<number>(4000)

  // --- BRANDING STATE ---
      const [shopName, setShopName] = useState('')
      const [currentLogo, setCurrentLogo] = useState('')
      const [logoFile, setLogoFile] = useState<File | null>(null)
      const [isSavingBranding, setIsSavingBranding] = useState(false)

      // --- ADD STAFF STATE ---
      const [isAddUserOpen, setIsAddUserOpen] = useState(false);
      const [newUserForm, setNewUserForm] = useState({
        email: '',
        password: '',
        full_name: '',
        role: 'cashier',
        branch_id: '', // 🔥 ADDED THIS
      });
      const [isCreatingUser, setIsCreatingUser] = useState(false);

      // --- ADD BRANCH STATE ---
      const [isAddBranchOpen, setIsAddBranchOpen] = useState(false);
      const [newBranchName, setNewBranchName] = useState('');
      const [isCreatingBranch, setIsCreatingBranch] = useState(false);
      const [expandedBranchId, setExpandedBranchId] = useState<number | null>(null);

      // 🔥 Declare isAdmin here so fetchProfiles can see it!
      const isAdmin = role === 'admin' || currentUser?.user_metadata?.role === 'admin';
      const isMainBranch = activeBranchId === 0 || activeBranchId === 1 || (branches.length > 0 && activeBranchId === branches[0]?.id);

      // 🔥 FIX: Renamed back to fetchSettings
      const fetchSettings = useCallback(async () => {
    setLoading(true)
    const suffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;
    const keys = [
      `exchange_rate${suffix}`, 'exchange_rate',
      `shop_name${suffix}`, 'shop_name',
      `shop_logo${suffix}`, 'shop_logo'
    ];
    
    const { data } = await supabase.from('app_settings').select('*').in('setting_key', keys)
    
    if (data) {
      // Exchange Rate
      const exRate = data.find((s: any) => s.setting_key === `exchange_rate${suffix}`) || data.find((s: any) => s.setting_key === 'exchange_rate');
      if (exRate) setExchangeRate(Number(exRate.setting_value) || 4000)

      // Shop Name
      const sName = data.find((s: any) => s.setting_key === `shop_name${suffix}`) || data.find((s: any) => s.setting_key === 'shop_name');
      if (sName) setShopName(String(sName.setting_value) || '')

      // Shop Logo
      const sLogo = data.find((s: any) => s.setting_key === `shop_logo${suffix}`) || data.find((s: any) => s.setting_key === 'shop_logo');
      if (sLogo) setCurrentLogo(String(sLogo.setting_value) || '')
    }
    setLoading(false)
  }, [activeBranchId]);

  const fetchProfiles = useCallback(async () => {
    let q = supabase.from('profiles').select('*').order('created_at', { ascending: true });
    
    // 🔥 If NOT an Admin, lock them to their specific branch. 
    // If they ARE an admin, fetch absolutely everyone!
    if (!isAdmin) {
      q = q.eq('branch_id', activeBranchId === 0 ? 1 : activeBranchId); 
    }
    
    const { data, error } = await q;
    if (data) setProfiles(data)
  }, [activeBranchId, isAdmin]); // Ensure isAdmin is in the dependency array

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setCurrentUser(user)
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single()
        if (profile?.tenant_id) {
          // 🔥 Fetch EVERYTHING about the workspace, not just the status
          const { data: tenant } = await supabase.from('tenants').select('*').eq('id', profile.tenant_id).single()
          if (tenant) {
            setTenantStatus(tenant.subscription_status)
            setTenantData(tenant)
          }
        }
      }
    })
  }, [])

  useEffect(() => {
    setProfiles([]); 
    fetchProfiles()
    fetchSettings()
  }, [activeBranchId, fetchProfiles, fetchSettings])

  async function updateSetting(key: string, val: any) {
    const branchKey = activeBranchId === 0 ? key : `${key}_${activeBranchId}`;
    const { error } = await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: val }, { onConflict: 'setting_key' })
    if (error) alert(`Error saving ${key}: ${error.message}`)
  }

  async function handleSaveBranding() {
    setIsSavingBranding(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', currentUser?.id)
        .single();
        
      const tenantId = profile?.tenant_id;
      let finalLogoUrl = currentLogo;

      if (logoFile && tenantId) {
        const fileExt = logoFile.name.split('.').pop();
        const filePath = `${tenantId}/logo-${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('tenant-assets')
          .upload(filePath, logoFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('tenant-assets')
          .getPublicUrl(filePath);
          
        finalLogoUrl = publicUrl;
        setCurrentLogo(publicUrl);
      }

      // Save to database
      await updateSetting('shop_name', shopName);
      if (finalLogoUrl) {
        await updateSetting('shop_logo', finalLogoUrl);
      }
      
      alert('Branding saved successfully!');
    } catch (error: any) {
      alert(`Error saving branding: ${error.message}`);
    } finally {
      setIsSavingBranding(false);
    }
  }

  async function handleCreateUserSubmit(e: React.FormEvent) {
        e.preventDefault();
        setIsCreatingUser(true);

        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/admin/create-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({
              ...newUserForm,
              // 🔥 Uses the dropdown selection, otherwise falls back to active branch
              branch_id: newUserForm.branch_id || (activeBranchId === 0 ? 1 : activeBranchId)
            })
          });

          const result = await res.json();
          if (!res.ok) throw new Error(result.error);

          showToast('success', 'Staff Created', `Account created for ${newUserForm.email}!`);
          setIsAddUserOpen(false);
          setNewUserForm({ email: '', password: '', full_name: '', role: 'cashier', branch_id: '' });
          fetchProfiles();
        } catch (err: any) {
          showToast('error', 'Creation Failed', err.message);
        } finally {
          setIsCreatingUser(false);
        }
      }

      async function handleCreateBranchSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!newBranchName.trim()) return;
        setIsCreatingBranch(true);

        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/admin/create-branch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ name: newBranchName })
          });

          const result = await res.json();
          if (!res.ok) throw new Error(result.error);

          showToast('success', 'Branch Created', `Store "${result.branch.name}" is now live!`);
          setIsAddBranchOpen(false);
          setNewBranchName('');
          
          // 🔥 Instantly updates the sidebar dropdown AND the visual list below without a page refresh!
          addBranch(result.branch); 
        } catch (err: any) {
          showToast('error', 'Creation Failed', err.message);
        } finally {
          setIsCreatingBranch(false);
        }
      }

      async function handleRoleUpdate(profileId: string, newRole: string) {
    if (!confirm(`Are you sure you want to change this user's access level to ${newRole.toUpperCase() || 'NO ACCESS'}?`)) return;

    const roleValue = newRole === '' ? null : newRole;
    
    let updateQuery = supabase.from('profiles').update({ role: roleValue }).eq('id', profileId);
    if (activeBranchId !== 0) updateQuery = updateQuery.eq('branch_id', activeBranchId);

    const { error } = await updateQuery;
    
    if (error) {
      alert(`Error updating permissions: ${error.message}`);
    } else {
      setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, role: roleValue } : p));
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm("⚠️ Are you absolutely sure you want to delete this staff member? This will permanently revoke their access.")) return;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ user_id: userId })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      showToast('success', 'Staff Deleted', 'The account has been permanently removed.');
      fetchProfiles();
    } catch (err: any) {
      showToast('error', 'Delete Failed', err.message);
    }
  }

  const handleSignOut = async () => {
    if(!confirm("Are you sure you want to sign out?")) return;
    await supabase.auth.signOut();
    router.push('/');
  }

  if (loadingRole) return null;

  return (
    <>
      <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
        
        <div className="header-container" style={{ flexShrink: 0 }}>
          <div className="header-left">
            <h1 className="saas-page-title">⚙️ Access & Settings</h1>
          </div>
        </div>

        <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: '60px', width: '100%', boxSizing: 'border-box' }}>
          <div className="settings-grid">
          
          {/* === CARD 1: ACCOUNT === */}
          <div className="saas-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="saas-card-title" style={{ fontSize: '15px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔐 Active Session Details</h2>
            
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Currently Authenticated As:</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#10b981', wordBreak: 'break-all' }}>
                {currentUser?.email || 'Unknown User'}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', wordBreak: 'break-all' }}>Session ID: {currentUser?.id || 'N/A'}</div>
            </div>

            {/* 🔥 NEW: Active Subscription Display for the User */}
            <div style={{ background: tenantData?.subscription_status === 'Monthly' ? '#f0fdf4' : '#fffbeb', padding: '16px', borderRadius: '8px', border: tenantData?.subscription_status === 'Monthly' ? '1px solid #bbf7d0' : '1px solid #fde047', marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', color: tenantData?.subscription_status === 'Monthly' ? '#166534' : '#b45309', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Your Current Plan</div>
              
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: tenantData?.subscription_status === 'Monthly' ? '#15803d' : '#d97706' }}>
                {tenantData?.subscription_status === 'Trial-7' && '⏳ 7-Day Free Trial'}
                {tenantData?.subscription_status === 'Trial' && '⏳ 14-Day Free Trial'}
                {tenantData?.subscription_status === 'Monthly' && '✅ Monthly Premium Active'}
                {tenantData?.subscription_status === 'Master' && '🛡️ Master Admin (Unlimited)'}
                {tenantData?.subscription_status === 'Pending' && '🔒 Account Pending'}
              </div>
              
              {/* Expiration Dates */}
              {(tenantData?.subscription_status === 'Trial-7' || tenantData?.subscription_status === 'Trial') && tenantData?.trial_end_date && (
                <div style={{ fontSize: '12px', color: '#b45309', marginTop: '8px', fontWeight: 'bold' }}>
                  Expires: {new Date(tenantData.trial_end_date).toLocaleDateString()}
                </div>
              )}
              {tenantData?.subscription_status === 'Monthly' && tenantData?.subscription_end_date && (
                <div style={{ fontSize: '12px', color: '#166534', marginTop: '8px', fontWeight: 'bold' }}>
                  Renews: {new Date(tenantData.subscription_end_date).toLocaleDateString()}
                </div>
              )}
            </div>

            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>Account Management</h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
              Signing out will safely end your current session on this device. All your inventory, sales, and customer data will remain completely intact in the database.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: 'auto' }}>
              {tenantStatus === 'Master' && (
                <button 
                  onClick={() => router.push('/settings/master')}
                  className="saas-btn"
                  style={{ background: '#f3e8ff', color: '#7e22ce', border: '1px solid #e9d5ff', padding: '12px 24px', fontWeight: 'bold', display: 'flex', justifyContent: 'center', gap: '8px' }}
                >
                  🛡️ SaaS Command Center
                </button>
              )}

              <button onClick={handleSignOut} className="saas-btn saas-btn-secondary" style={{ padding: '12px 24px' }}>
                Sign Out
              </button>
            </div>
          </div>

          {/* === NEW CARD: WHITE-LABEL BRANDING === */}
          {role === 'admin' && (
          <div className="saas-card">
            <h2 className="saas-card-title" style={{ fontSize: '15px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🎨 White-Label Branding</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
              Customize the receipt name and logo that appears on your customer invoices.
            </p>

            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '16px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="saas-card-title" style={{ color: '#166534', display: 'block', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Receipt Shop Name</label>
                <input
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="e.g., Heng Heng Rice Depot"
                  className="saas-input"
                  style={{ border: '2px solid #22c55e', width: '100%' }}
                />
              </div>

              <div>
                <label className="saas-card-title" style={{ color: '#166534', display: 'block', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Receipt Logo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                  {currentLogo ? (
                    <img src={currentLogo} alt="Store Logo" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #22c55e' }} />
                  ) : (
                    <div style={{ width: '64px', height: '64px', background: '#dcfce7', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #22c55e' }}>
                      <span style={{ fontSize: '10px', color: '#15803d' }}>No Logo</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                    style={{ fontSize: '12px' }}
                  />
                </div>
              </div>

              <button 
                onClick={handleSaveBranding} 
                disabled={isSavingBranding}
                className="saas-btn" 
                style={{ background: '#22c55e', color: 'white', padding: '12px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {isSavingBranding ? 'Uploading...' : 'Save Branding'}
              </button>
            </div>
          </div>
          )}

          {/* === CARD 2: SYSTEM CONSTANTS === */}
          {role === 'admin' && (
          <div className="saas-card">
            <h2 className="saas-card-title" style={{ fontSize: '15px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🌐 Global Business Constants</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
              These values affect the mathematical formulas across your entire Point of Sale and Accounting platform.
            </p>

            <div style={{ background: '#fefcf3', border: '1px solid #fde047', padding: '16px', borderRadius: '8px' }}>
              <div style={{ marginBottom: '12px' }}>
                <label className="saas-card-title" style={{ color: '#854d0e', display: 'block', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Master Exchange Rate (៛ per $1)</label>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>Updates POS & COGS calculations globally.</div>
              </div>
              <CurrencyInput 
                value={exchangeRate} 
                onChange={(v: any) => setExchangeRate(Number(v) || 0)} 
                onBlur={() => updateSetting('exchange_rate', exchangeRate)} 
                className="saas-input"
                style={{ border: '2px solid #b58a3d', color: '#b58a3d', fontSize: '18px', padding: '12px' }} 
              />
            </div>
          </div>
          )}

          {/* === CARD 4: MANAGE LOCATIONS (MAIN BRANCH ADMIN ONLY) === */}
          {isAdmin && isMainBranch && (
            <div className="saas-card" style={{ gridColumn: '1 / -1', marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 className="saas-card-title" style={{ margin: 0, fontSize: '15px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      🏬 Manage Store Locations
                    </h2>
                    <button 
                      onClick={() => setIsAddBranchOpen(true)} 
                      className="saas-btn"
                      style={{ padding: '8px 16px', fontSize: '13px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      + Add New Branch
                    </button>
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, marginBottom: '20px' }}>
                    Expand your business by adding new physical store locations. Each branch gets its own isolated inventory, sales, and expense tracking.
                  </div>

                  {/* 🔥 Visual List of Active Branches with Staff Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {branches.map((branch) => {
                      const isExpanded = expandedBranchId === branch.id;
                      const branchStaff = profiles.filter(p => p.branch_id === branch.id);

                      return (
                        <div key={branch.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                          {/* Header / Clickable Area */}
                          <div 
                            onClick={() => setExpandedBranchId(isExpanded ? null : branch.id)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', background: isExpanded ? '#f1f5f9' : 'transparent', userSelect: 'none' }}
                          >
                            <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#334155', display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block', fontSize: '12px', color: '#64748b' }}>
                                ▶
                              </span>
                              🏬 {branch.name}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>{branchStaff.length} Staff</span>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', background: '#e2e8f0', padding: '4px 10px', borderRadius: '12px' }}>
                                ID: {branch.id}
                              </span>
                            </div>
                          </div>

                          {/* Expanded Staff List */}
                          {isExpanded && (
                            <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>
                              {branchStaff.length === 0 ? (
                                <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No staff assigned to this branch.</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {branchStaff.map(staff => (
                                    <div key={staff.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                                      <div>
                                        <div style={{ fontWeight: 'bold', color: '#334155' }}>{staff.full_name || 'Unnamed Staff'}</div>
                                        <div style={{ color: '#64748b', fontSize: '11px' }}>{staff.email}</div>
                                      </div>
                                      <span style={{
                                        padding: '4px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase',
                                        background: staff.role === 'admin' ? '#fef3c7' : staff.role === 'manager' ? '#e0f2fe' : '#f3e8ff',
                                        color: staff.role === 'admin' ? '#b45309' : staff.role === 'manager' ? '#0369a1' : '#7e22ce',
                                      }}>
                                        {staff.role}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* === CARD 3: USER PERMISSIONS === */}
              <div className="saas-card" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h2 className="saas-card-title" style={{ margin: 0, fontSize: '15px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    👥 User Permissions & Roles
                  </h2>
                  <button 
                    onClick={() => setIsAddUserOpen(true)} 
                    className="saas-btn"
                    style={{ padding: '8px 16px', fontSize: '13px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    + Add Staff
                  </button>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
                  Change the access level for your staff. Or click "Add Staff" to create a new login.
                </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {profiles
                .filter(p => isMainBranch ? true : p.role !== 'admin')
                .map(p => (
                <div key={p.id} style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  
                  {/* Left Side: Name and ID */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.full_name || 'New Staff Member'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      ID: {p.id.split('-')[0]}...
                    </div>
                  </div>

                  {/* Right Side: Role Selector and Delete Button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <select
                      className="saas-input"
                      value={p.role || ''}
                      onChange={(e) => handleRoleUpdate(p.id, e.target.value)}
                      disabled={p.id === currentUser?.id}
                      style={{ 
                        cursor: p.id === currentUser?.id ? 'not-allowed' : 'pointer', 
                        backgroundColor: p.id === currentUser?.id ? '#f8fafc' : '#ffffff',
                        padding: '8px 12px',
                        margin: 0,
                        fontSize: '13px',
                        minWidth: '150px',
                        height: '38px', // Fixed height to match button
                        border: '1px solid #cbd5e1'
                      }}
                    >
                      <option value="">🚫 No Access</option>
                      <option value="cashier">🛒 Cashier</option>
                      <option value="manager">🛡️ Manager</option>
                      <option value="admin">👑 Admin</option>
                    </select>
                    
                    {p.id !== currentUser?.id && (
                      <button
                        onClick={() => handleDeleteUser(p.id)}
                        style={{
                          background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '6px',
                          width: '38px', height: '38px', // Square button to match select height perfectly
                          fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'background 0.2s', padding: 0
                        }}
                        title="Delete Staff Account"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          </div>
            </div>

            {/* === ADD BRANCH MODAL === */}
            {isAddBranchOpen && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }}>
                <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold' }}>🏬 Create New Branch</h3>
                  <form onSubmit={handleCreateBranchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>BRANCH NAME</label>
                      <input required autoFocus className="saas-input" value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="e.g. Toul Kork Depot" />
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                      <button type="button" onClick={() => setIsAddBranchOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
                      <button type="submit" disabled={isCreatingBranch} className="saas-btn" style={{ background: '#3b82f6', color: 'white', border: 'none' }}>
                        {isCreatingBranch ? 'Creating...' : 'Create Branch'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* === ADD STAFF MODAL === */}
            {isAddUserOpen && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }}>
                <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold' }}>👤 Register Staff Member</h3>
                  <form onSubmit={handleCreateUserSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>FULL NAME</label>
                      <input required className="saas-input" value={newUserForm.full_name} onChange={e => setNewUserForm({ ...newUserForm, full_name: e.target.value })} placeholder="e.g. Sok Chea" />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>EMAIL</label>
                      <input type="email" required className="saas-input" value={newUserForm.email} onChange={e => setNewUserForm({ ...newUserForm, email: e.target.value })} placeholder="staff@example.com" />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>TEMPORARY PASSWORD</label>
                      <input type="password" required minLength={6} className="saas-input" value={newUserForm.password} onChange={e => setNewUserForm({ ...newUserForm, password: e.target.value })} placeholder="••••••••" />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>ASSIGN TO BRANCH</label>
                      <select className="saas-input" required value={newUserForm.branch_id} onChange={e => setNewUserForm({ ...newUserForm, branch_id: e.target.value })}>
                        <option value="" disabled>-- Select a Branch --</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>🏬 {b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>INITIAL ROLE</label>
                      <select className="saas-input" value={newUserForm.role} onChange={e => setNewUserForm({ ...newUserForm, role: e.target.value })}>
                        <option value="cashier">🛒 Cashier (POS Only)</option>
                        <option value="manager">🛡️ Manager</option>
                        <option value="admin">👑 Master Admin</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                      <button type="button" onClick={() => setIsAddUserOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
                      <button type="submit" disabled={isCreatingUser} className="saas-btn" style={{ background: '#10b981', color: 'white', border: 'none' }}>
                        {isCreatingUser ? 'Creating...' : 'Create Account'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            
            <style jsx global>{`
          /* 🔥 DESKTOP LAYOUT */
          .main-wrapper { 
            padding: max(20px, env(safe-area-inset-top, 20px)) 24px 24px 24px; 
            background: #f8fafc; 
            font-family: Arial, sans-serif; 
            box-sizing: border-box; 
            color: #333;
            width: 100%;
            height: 100dvh; 
            overflow-y: auto; 
            -webkit-overflow-scrolling: touch;
          }

          .header-container { 
            display: flex;
            justify-content: flex-start;
            align-items: center; 
            margin-bottom: 24px; 
            margin-top: 0;
            margin-left: 60px; 
            gap: 12px;
            min-height: 42px;
            width: 100%;
            max-width: 1600px;
          }

          .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr));
            gap: 24px;
            width: 100%;
            max-width: 1600px;
            margin-left: auto;
            margin-right: auto;
          }
          
          .saas-card {
             max-width: 100%;
             box-sizing: border-box;
          }

          /* 🔥 MATCHED MOBILE OVERRIDES */
          @media (max-width: 1023px) { 
            .main-wrapper { 
              padding: max(20px, env(safe-area-inset-top, 20px)) 16px 0 16px !important; 
              max-width: 100vw !important;
              overflow-x: hidden !important;
              box-sizing: border-box !important;
            }
            .header-container { 
              margin-left: 54px !important; 
              margin-right: 0 !important; 
              margin-bottom: 24px !important; 
              margin-top: 0 !important;
              display: flex !important;
              flex-direction: row !important;
              justify-content: flex-start !important;
              align-items: center !important; 
              min-height: 44px !important;
              width: calc(100% - 54px) !important;
              box-sizing: border-box !important;
            }
            .header-left {
              display: flex !important;
              flex-direction: row !important;
              align-items: center !important;
              gap: 12px !important;
            }

            .settings-grid {
              grid-template-columns: 1fr;
              width: 100% !important;
              max-width: 100vw !important;
              box-sizing: border-box !important;
              gap: 16px !important;
            }
            
            .saas-card {
              width: 100% !important;
              max-width: 100vw !important;
              box-sizing: border-box !important;
            }
          }
        `}</style>
      </div>
    </>
  )
}