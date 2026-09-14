'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useUserRole } from '@/lib/useUserRole'
import AdminGuard from '@/components/AdminGuard'
import { useBranch } from '@/components/BranchContext' // 🔥 ADDED: Multi-Tenant Architecture

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
  const { activeBranchId } = useBranch() // 🔥 TUNED INTO GLOBAL MEMORY
  
  // 🚀 AUTH & ROLE STATE
  const { role, loadingRole } = useUserRole()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<any[]>([])

  // --- FINANCIAL STATE ---
  const [exchangeRate, setExchangeRate] = useState<number>(4000)
  const [isResetting, setIsResetting] = useState(false)

  // 🔥 CLOSURE FIX: Wrap in useCallback to dynamically track activeBranchId
  const fetchSettings = useCallback(async () => {
    setLoading(true)
    const branchKey = activeBranchId === 0 ? 'exchange_rate' : `exchange_rate_${activeBranchId}`;
    const keys = [branchKey, 'exchange_rate'];
    
    const { data } = await supabase.from('app_settings').select('*').in('setting_key', keys)
    
    if (data) {
      // Prioritize the branch-specific rate, fallback to global
      const setting = data.find((s: any) => s.setting_key === branchKey) || data.find((s: any) => s.setting_key === 'exchange_rate');
      if (setting) setExchangeRate(Number(setting.setting_value) || 4000)
    }
    setLoading(false)
  }, [activeBranchId]);

  // 🔒 SECURITY FIX: Isolate profile reads to the active branch!
  const fetchProfiles = useCallback(async () => {
    let q = supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if (activeBranchId !== 0) q = q.eq('branch_id', activeBranchId); // 🔥 DYNAMIC BRANCH FILTER
    
    const { data, error } = await q;
    if (data) setProfiles(data)
  }, [activeBranchId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user)
    })
  }, [])

  // 🔥 TRIGGER SECURE REFETCH: Updates everything when branch changes
  useEffect(() => {
    setProfiles([]); // 💣 SECURITY WIPE: Clear profiles instantly on branch switch
    fetchProfiles()
    fetchSettings()
  }, [activeBranchId, fetchProfiles, fetchSettings])

  async function updateSetting(key: string, val: number) {
    // 🔥 SECURITY FIX: Isolate setting overrides to the active branch
    const branchKey = activeBranchId === 0 ? key : `${key}_${activeBranchId}`;
    const { error } = await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: val }, { onConflict: 'setting_key' })
    if (error) alert(`Error saving ${key}: ${error.message}`)
  }

  // 🚀 PERMISSION UPDATER
  async function handleRoleUpdate(profileId: string, newRole: string) {
    if (!confirm(`Are you sure you want to change this user's access level to ${newRole.toUpperCase() || 'NO ACCESS'}?`)) return;

    const roleValue = newRole === '' ? null : newRole;
    
    // 🔒 SECURITY FIX: Enforce branch isolation on profile role updates
    let updateQuery = supabase.from('profiles').update({ role: roleValue }).eq('id', profileId);
    if (activeBranchId !== 0) updateQuery = updateQuery.eq('branch_id', activeBranchId);

    const { error } = await updateQuery;
    
    if (error) {
      alert(`Error updating permissions: ${error.message}`);
    } else {
      setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, role: roleValue } : p));
    }
  }

  const handleSignOut = async () => {
    if(!confirm("Are you sure you want to sign out?")) return;
    await supabase.auth.signOut();
    router.push('/');
  }

  const handleResetLayouts = async () => {
    // 🛡️ UI FIX: Force user to type 'CONFIRM' to prevent accidental resets
    const userInput = prompt("⚠️ WARNING: This will reset all table column widths, sorts, and layouts across the entire app back to their default state.\n\nPlease type the word CONFIRM to proceed:");
    
    if (userInput !== "CONFIRM") {
      if (userInput !== null) {
        alert("❌ Reset canceled. You must type exactly 'CONFIRM' in all caps to proceed.");
      }
      return;
    }
    
    setIsResetting(true);
    try {
      // 🔥 FIX: Collect the new POS/Rice layout keys and isolate the deletion to the active branch
      const branchSuffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;
      const layoutKeys = [
        `pos_product_order${branchSuffix}`, `category_order${branchSuffix}`,
        `column_widths${branchSuffix}`, `column_order${branchSuffix}`, 
        `pending_col_widths${branchSuffix}`, `pending_col_order${branchSuffix}`,
        `supplier_col_widths${branchSuffix}`, `supplier_col_order${branchSuffix}`,
        `product_sort${branchSuffix}`, `pending_sort${branchSuffix}`, `supplier_sort${branchSuffix}`,
        `cust_col_widths${branchSuffix}`, `cust_col_order${branchSuffix}`, 
        `biz_col_widths${branchSuffix}`, `biz_sum_cols${branchSuffix}`, `biz_daily_cols${branchSuffix}`, `biz_retail_cols${branchSuffix}`, `biz_exp_cols${branchSuffix}`
      ];
      
      const { error } = await supabase.from('app_settings').delete().in('setting_key', layoutKeys);
      if (error) throw error;
      
      alert("✅ All UI Layouts have been successfully reset. Refresh your other tabs to see the changes.");
    } catch (err: any) {
      alert(`Error resetting layouts: ${err.message}`);
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <AdminGuard>
      <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
        
        {/* HEADER CONTAINER */}
        <div className="header-container" style={{ flexShrink: 0 }}>
          <div className="header-left">
            <h1 className="saas-page-title">⚙️ Access & Settings</h1>
          </div>
        </div>

        {/* SCROLLABLE CONTENT AREA */}
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

            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>Account Management</h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
              Signing out will safely end your current session on this device. All your inventory, sales, and customer data will remain completely intact in the database.
            </p>

            <button onClick={handleSignOut} className="saas-btn saas-btn-secondary" style={{ marginTop: 'auto', padding: '12px 24px' }}>
              Sign Out
            </button>
          </div>

          {/* === CARD 2: SYSTEM CONSTANTS === */}
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

          {/* === CARD 3: USER PERMISSIONS === */}
          <div className="saas-card" style={{ gridColumn: '1 / -1' }}>
            <h2 className="saas-card-title" style={{ fontSize: '15px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>👥 User Permissions & Roles</h2>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: 1.5 }}>
              Change the access level for your staff. <br/>
              <strong style={{ color: '#b45309' }}>To Add Users:</strong> Create them securely in your <i>Supabase Auth Dashboard</i>. They will instantly appear below so you can assign their role.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {profiles.map(p => (
                <div key={p.id} style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '15px', wordBreak: 'break-word', lineHeight: 1.3 }}>
                        {p.full_name || 'New Staff Member'}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                        ID: {p.id.split('-')[0]}...
                      </div>
                    </div>
                    
                    <div style={{ flexShrink: 0 }}>
                      <span style={{
                         padding: '6px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', display: 'inline-block',
                         background: p.role === 'admin' ? '#fef3c7' : p.role === 'manager' ? '#e0f2fe' : p.role === 'cashier' ? '#f3e8ff' : '#f1f5f9',
                         color: p.role === 'admin' ? '#b45309' : p.role === 'manager' ? '#0369a1' : p.role === 'cashier' ? '#7e22ce' : '#475569',
                         textTransform: 'uppercase', letterSpacing: '0.5px'
                      }}>
                         {p.role ? String(p.role) : 'NO ACCESS'}
                      </span>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                    <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      Change Permission Level
                    </label>
                    <select
                      className="saas-input"
                      value={p.role || ''}
                      onChange={(e) => handleRoleUpdate(p.id, e.target.value)}
                      disabled={p.id === currentUser?.id}
                      style={{ 
                        cursor: p.id === currentUser?.id ? 'not-allowed' : 'pointer', 
                        width: '100%',
                        backgroundColor: p.id === currentUser?.id ? '#f8fafc' : '#ffffff',
                        padding: '12px'
                      }}
                    >
                      <option value="">🚫 No Access</option>
                      <option value="cashier">🛒 Cashier (POS Only)</option>
                      <option value="manager">🛡️ Manager</option>
                      <option value="admin">👑 Master Admin</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* === CARD 4: SYSTEM MAINTENANCE === */}
          <div className="saas-card red" style={{ gridColumn: '1 / -1', background: '#fff1f2' }}>
            <h2 className="saas-card-title" style={{ color: '#be123c', fontSize: '15px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🛠️ System Maintenance</h2>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginTop: '16px' }}>
              <div style={{ flex: 1, minWidth: '250px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#991b1b' }}>Reset UI Layouts</h3>
                <p style={{ fontSize: '13px', color: '#ef4444', margin: 0, lineHeight: 1.5 }}>
                  If your tables disappear or column widths get completely broken because of accidental dragging, click this button to factory reset all table views across the app.
                </p>
              </div>
              <button onClick={handleResetLayouts} disabled={isResetting} className="saas-btn saas-btn-danger" style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}>
                {isResetting ? 'Processing...' : '⚠️ Reset All Tables'}
              </button>
            </div>
          </div>

          </div>
        </div>
        
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
    </AdminGuard>
  )
}