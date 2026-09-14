'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useFocusRefresh } from '@/lib/useFocusRefresh'
import { Customer } from '@/types'
import { useToast } from '@/components/ToastProvider'
import { useDebounce } from '@/lib/useDebounce'
import EmptyState from '@/components/EmptyState'
import Modal from '@/components/Modal'
import { useBranch } from '@/components/BranchContext' 

type SortConfig = {
  key: keyof Customer;
  direction: 'asc' | 'desc';
} | null;

const DEFAULT_WIDTHS: Record<string, number> = {
  created_at: 120, id: 280, name: 240, owner: 120, type: 120,
  phone: 150, location: 200, google_map: 120, last_purchase_date: 150,
  days_since_last_purchase: 160 
}

const DEFAULT_ORDER: Array<keyof Customer> = [
  'created_at', 'name', 'phone', 'location', 'type', 'owner', 'google_map', 'last_purchase_date', 'days_since_last_purchase', 'id'
]

export default function CustomerDatabasePage() {
  const { showToast } = useToast();
  const { activeBranchId } = useBranch(); 

  // --- CORE STATE ---
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false) // 🔥 ADDED LOCK STATE
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300) 
  const [edits, setEdits] = useState<Record<string, Partial<Customer>>>({})
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set())

  // --- CELL EDITING STATE ---
  const [editingCell, setEditingCell] = useState<{id: string, col: string} | null>(null)

  // --- FILTER & SORT STATE ---
  const [customerTypeFilter, setCustomerTypeFilter] = useState<string>('All')
  const [ownerFilter, setOwnerFilter] = useState<string>('All')
  const [sortConfig, setSortConfig] = useState<SortConfig>(null)

  // --- COLUMN PREFERENCE STATE ---
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const [columnOrder, setColumnOrder] = useState<Array<keyof Customer>>(DEFAULT_ORDER)

  // --- MODALS ---
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCustomer, setNewCustomer] = useState({
    name: '', owner: 'Both', type: 'ហូប', phone: '', location: '', google_map: ''
  })
  const [mobileEditCustomer, setMobileEditCustomer] = useState<Customer | null>(null); // 🔥 Mobile Control Center

  // --- DATABASE OPERATIONS ---
  // 🔥 CLOSURE FIX: Wrap in useCallback to lock onto the current activeBranchId
  const fetchSettings = useCallback(async () => {
    const branchSuffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;
    const keys = [`cust_col_widths${branchSuffix}`, `cust_col_order${branchSuffix}`];
    const fallbackKeys = ['cust_col_widths', 'cust_col_order'];

    const { data } = await supabase.from('app_settings').select('*').in('setting_key', [...keys, ...fallbackKeys]);
    if (data) {
      const widths = data.find(d => d.setting_key === `cust_col_widths${branchSuffix}`) || data.find(d => d.setting_key === 'cust_col_widths');
      const order = data.find(d => d.setting_key === `cust_col_order${branchSuffix}`) || data.find(d => d.setting_key === 'cust_col_order');
      
      if (widths && widths.setting_value) {
        setColumnWidths({ ...DEFAULT_WIDTHS, ...widths.setting_value })
      }
      if (order && order.setting_value) {
        const savedOrder = order.setting_value as Array<keyof Customer>;
        if (!savedOrder.includes('days_since_last_purchase')) {
          savedOrder.splice(savedOrder.indexOf('last_purchase_date') + 1, 0, 'days_since_last_purchase');
        }
        setColumnOrder(savedOrder)
      }
    }
  }, [activeBranchId]);

  // 🔥 CLOSURE FIX: Wrap in useCallback to safely pass to useFocusRefresh
  const loadCustomers = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('is_archived', false)
      .eq('branch_id', activeBranchId) 
      .order('created_at', { ascending: false })
      
    if (!error && data) {
      setCustomers(data as Customer[])
    }
    setIsLoading(false)
  }, [activeBranchId]);

  // --- LIFECYCLE ---
  useEffect(() => {
    // 💣 SECURITY WIPE: Destroy active selections, inline edits, and mobile modals
    // when switching branches to prevent Cross-Tenant Ghost Deletions!
    setSelectedToDelete(new Set());
    setEditingCell(null);
    setMobileEditCustomer(null);
    setShowAddModal(false);
    setEdits({}); // 🔥 OPTIMIZATION: Synchronously wipe edits instantly on branch switch
    setNewCustomer({ name: '', owner: 'Both', type: 'ហូប', phone: '', location: '', google_map: '' });

    loadCustomers(false);
    fetchSettings();
  }, [loadCustomers, fetchSettings]); 

  // 🔥 RESTORED & SAFE: Because loadCustomers is now a stable callback, 
  // this will only refresh silently in the background when the user returns to the tab!
  useFocusRefresh(() => loadCustomers(true));

  // --- RECORD OPERATIONS ---
  const handleSaveRecord = async (id: string): Promise<boolean> => {
    if (!edits[id]) return true;
    
    if (edits[id].name !== undefined && edits[id].name?.trim() === '') {
      showToast('error', 'Validation Error', 'Customer Name cannot be empty.');
      return false; // Block closure
    }

    const { error } = await supabase.from('customers')
      .update(edits[id])
      .eq('id', id)
      .eq('branch_id', activeBranchId)

    if (!error) {
      setEdits(prev => { const n = { ...prev }; delete n[id]; return n })
      setEditingCell(null)
      showToast('success', 'Saved', 'Customer updated successfully.');
      loadCustomers()
      return true; // Allow closure
    } else {
      showToast('error', 'Save Failed', error.message);
      return false; // Block closure
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to archive ${selectedToDelete.size} customer(s)?`)) return
    
    setIsProcessing(true);
    const { error } = await supabase
      .from('customers')
      .update({ is_archived: true })
      .in('id', Array.from(selectedToDelete))
      .eq('branch_id', activeBranchId)
      
    if (!error) { 
      setSelectedToDelete(new Set()); 
      showToast('success', 'Deleted', 'Customer(s) archived successfully.');
      loadCustomers() 
    } else {
      showToast('error', 'Deletion Failed', error.message);
    }
    setIsProcessing(false);
  }

  async function handleAddCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!newCustomer.name.trim() || isProcessing) return

    setIsProcessing(true);
    const { error } = await supabase.from('customers').insert([{
      name: newCustomer.name, owner: newCustomer.owner, type: newCustomer.type, 
      phone: newCustomer.phone, location: newCustomer.location, google_map: newCustomer.google_map,
      branch_id: activeBranchId 
    }])

    if (!error) {
      setShowAddModal(false)
      showToast('success', 'Customer Added', `${newCustomer.name} added successfully.`);
      setNewCustomer({ name: '', owner: 'Both', type: 'ហូប', phone: '', location: '', google_map: '' })
      loadCustomers() 
    } else {
      showToast('error', 'Error', error.message);
    }
    setIsProcessing(false);
  }

  const handleSort = (key: keyof Customer) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  }

  // --- DATA PROCESSING ---
  const processedCustomers = useMemo(() => {
    const now = new Date().getTime(); 
    return customers
      .map(c => {
        const cid = String(c.id);
        const merged = { ...c, ...edits[cid] };
        
        let daysSince = null;
        if (merged.last_purchase_date) {
          const diffTime = now - new Date(merged.last_purchase_date).getTime();
          daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          if (daysSince < 0) daysSince = 0; 
        }
        
        return { ...merged, days_since_last_purchase: daysSince };
      })
      .filter(c => {
        if (customerTypeFilter !== 'All' && c.type !== customerTypeFilter) return false;
        if (ownerFilter !== 'All' && c.owner !== ownerFilter) return false;

        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          return (
            c.name?.toLowerCase().includes(q) ||
            c.phone?.toLowerCase().includes(q) ||
            c.location?.toLowerCase().includes(q)
          )
        }
        return true;
      })
      .sort((a, b) => {
        if (!sortConfig) return 0;
        const { key, direction } = sortConfig;
        
        let valA = (a as any)[key];
        let valB = (b as any)[key];

        if (valA === null || valA === undefined || valA === '') return 1;
        if (valB === null || valB === undefined || valB === '') return -1;

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
  }, [customers, edits, customerTypeFilter, ownerFilter, debouncedSearch, sortConfig]);

  // --- FORMATTERS ---
  const formatHeader = (key: string) => {
    if (key === 'id') return 'ID';
    if (key === 'google_map') return 'Map Link';
    if (key === 'days_since_last_purchase') return 'Days Since Last Order';
    return key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  const formatDisplayValue = (col: string, val: any) => {
    if (val === null || val === undefined || val === '') {
      if (col === 'days_since_last_purchase') return '-';
      return '—';
    }
    
    if (col === 'created_at' || col === 'last_purchase_date') {
      return new Date(val).toLocaleDateString('en-GB');
    }
    
    if (col === 'days_since_last_purchase') {
      if (val === 0) return 'Today';
      
      const totalDays = Number(val);
      const years = Math.floor(totalDays / 365);
      const remDays = totalDays % 365;
      const months = Math.floor(remDays / 30);
      const days = remDays % 30;

      const parts = [];
      if (years > 0) parts.push(`${years}Y`);
      if (months > 0) parts.push(`${months}M`);
      if (days > 0) parts.push(`${days}D`);

      if (parts.length === 0) return 'Today';
      return parts.join(' '); 
    }

    return String(val);
  }

  const isReadOnly = (col: string) => ['id', 'created_at', 'last_purchase_date', 'days_since_last_purchase'].includes(col);

  return (
    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      
      {/* HEADER (Frozen) */}
      <div className="header-container" style={{ flexShrink: 0 }}>
        <div className="header-left">
          <h1 className="saas-page-title">🧑‍🌾 Customer Database</h1>
        </div>

        <div className="header-actions">
          {selectedToDelete.size > 0 && (
            <button className="saas-btn saas-btn-danger" onClick={handleDelete}>
              Delete ({selectedToDelete.size})
            </button>
          )}
        </div>
      </div>

      {/* TOOLBAR (Frozen) */}
      <div className="saas-card" style={{ padding: '16px', marginBottom: '24px', flexShrink: 0 }}>
        
        <div className="mobile-action-row" style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', width: '100%' }}>
          <input 
            className="saas-input" 
            placeholder="🔍 Quick search..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            style={{ flex: 1, minWidth: '0' }}
          />
          
          {/* ⏳ New Sort Button */}
          <button 
             className="saas-btn saas-btn-secondary" 
             onClick={() => handleSort('days_since_last_purchase')}
             style={{ padding: '0 16px', height: '40px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' }}
             title="Sort by days since last purchase"
          >
             ⏳ <span className="hide-on-mobile">Sort by Days</span>
             <span style={{ fontSize: '12px', opacity: sortConfig?.key === 'days_since_last_purchase' ? 1 : 0.3 }}>
                {sortConfig?.key === 'days_since_last_purchase' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
             </span>
          </button>

          <button className="saas-btn saas-btn-primary desktop-only-btn" onClick={() => setShowAddModal(true)} style={{ height: '40px' }}>
            + Add Customer
          </button>
          {/* 📱 Mobile "+" Button */}
          <button className="saas-btn saas-btn-primary mobile-only-btn" onClick={() => setShowAddModal(true)} style={{ padding: '0', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>

        {/* 🔥 PROFESSIONAL PILL TABS: OWNER */}
        <div className="hide-scrollbar" style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingRight: '12px', paddingBottom: '4px', marginBottom: '12px', margin: 0, WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
          <button 
            onClick={() => setOwnerFilter('All')} 
            style={{ background: ownerFilter === 'All' ? '#b58a3d' : '#f1f5f9', color: ownerFilter === 'All' ? '#fff' : '#475569', border: 'none', borderRadius: '20px', padding: '8px 16px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            All Owners
          </button>
          {(['Pich', 'Jing', 'Both', 'Mom'] as const).map(ownerItem => {
            const filteredByType = customerTypeFilter === 'All' ? customers : customers.filter(c => c.type === customerTypeFilter);
            const count = filteredByType.filter(c => c.owner === ownerItem).length;
            return (
              <button 
                key={ownerItem} 
                onClick={() => setOwnerFilter(ownerItem)} 
                style={{ background: ownerFilter === ownerItem ? '#b58a3d' : '#f1f5f9', color: ownerFilter === ownerItem ? '#fff' : '#475569', border: 'none', borderRadius: '20px', padding: '8px 16px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0, cursor: 'pointer', transition: 'all 0.2s' }}
              >
                👤 {ownerItem} ({count})
              </button>
            )
          })}
        </div>

        {/* 🔥 PROFESSIONAL PILL TABS: CUSTOMER TYPE */}
        <div className="hide-scrollbar" style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingRight: '12px', paddingBottom: '4px', paddingTop: '12px', margin: 0, WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
          <button 
            onClick={() => setCustomerTypeFilter('All')} 
            style={{ background: customerTypeFilter === 'All' ? '#b58a3d' : '#f1f5f9', color: customerTypeFilter === 'All' ? '#fff' : '#475569', border: 'none', borderRadius: '20px', padding: '8px 16px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            All Types ({ownerFilter === 'All' ? customers.length : customers.filter(c => c.owner === ownerFilter).length})
          </button>
          {(['ហូប', 'លក់បាយ', 'លក់ត', 'ធ្វើនំ', 'អំណោយ'] as const).map(typeItem => {
            const filteredByOwner = ownerFilter === 'All' ? customers : customers.filter(c => c.owner === ownerFilter);
            const count = filteredByOwner.filter(c => c.type === typeItem).length;
            return (
              <button 
                key={typeItem} 
                onClick={() => setCustomerTypeFilter(typeItem)} 
                style={{ background: customerTypeFilter === typeItem ? '#b58a3d' : '#f1f5f9', color: customerTypeFilter === typeItem ? '#fff' : '#475569', border: 'none', borderRadius: '20px', padding: '8px 16px', fontSize: '14px', fontWeight: 'bold', flexShrink: 0, cursor: 'pointer', transition: 'all 0.2s' }}
              >
                🏷️ {typeItem} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* DESKTOP SPREADSHEET TABLE */}
      <div className="saas-table-wrapper fade-in hide-on-mobile" style={{ flex: 1, minHeight: 0, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
          <table className="saas-table" style={{ width: 'max-content', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {/* Checkbox Header Column (Sticky) */}
                <th className="saas-th" style={{ width: '46px', minWidth: '46px', maxWidth: '46px', padding: '16px 8px', textAlign: 'center', borderRight: '1px solid #f1f5f9', position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0' }}>
                   <input 
                     type="checkbox" 
                     checked={selectedToDelete.size === processedCustomers.length && processedCustomers.length > 0}
                     onChange={(e) => {
                       if (e.target.checked) setSelectedToDelete(new Set(processedCustomers.map(c => String(c.id))));
                       else setSelectedToDelete(new Set());
                     }}
                     style={{ cursor: 'pointer', accentColor: '#b58a3d', width: '16px', height: '16px' }}
                   />
                </th>

                {/* NUMBER COLUMN HEADER (Sticky) */}
                <th className="saas-th" style={{ width: '50px', minWidth: '50px', maxWidth: '50px', padding: '16px 8px', textAlign: 'center', borderRight: '1px solid #f1f5f9', position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0' }}>
                  #
                </th>

                {/* Dynamic Data Headers (Sticky) */}
                {columnOrder.map(key => (
                  <th 
                    key={key} 
                    className="saas-th"
                    onClick={() => handleSort(key)}
                    style={{ 
                      width: columnWidths[key as string] || 150, 
                      borderRight: '1px solid #f1f5f9', 
                      cursor: 'pointer', 
                      position: 'sticky', 
                      top: 0, 
                      zIndex: 30, 
                      backgroundColor: '#f8fafc', 
                      boxShadow: 'inset 0 -2px 0 0 #e2e8f0'
                    }}
                    title="Click to Sort"
                  >
                    {formatHeader(key as string)}
                    <span style={{ marginLeft: '6px', fontSize: '12px', opacity: sortConfig?.key === key ? 1 : 0.3 }}>
                      {sortConfig?.key === key ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processedCustomers.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={columnOrder.length + 2} style={{ padding: 0 }}>
                    <EmptyState 
                      icon="🔍" 
                      title="No customers found" 
                      message="Try adjusting your search or owner filters." 
                    />
                  </td>
                </tr>
              ) : (
                processedCustomers.map((c, index) => {
                  const cid = String(c.id);
                  return (
                    <tr key={cid} className={`saas-tr ${selectedToDelete.has(cid) ? 'selected' : ''} ${edits[cid] ? 'editing' : ''}`}>
                      
                      <td className="saas-td" style={{ width: '46px', padding: '8px', textAlign: 'center', borderRight: '1px solid #f1f5f9' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedToDelete.has(cid)}
                          onChange={() => {
                            const next = new Set(selectedToDelete)
                            next.has(cid) ? next.delete(cid) : next.add(cid)
                            setSelectedToDelete(next)
                          }} 
                          style={{ cursor: 'pointer', width: '16px', height: '16px', margin: 0, accentColor: '#b58a3d' }} 
                        />
                      </td>

                      {/* NUMBER COLUMN ROW */}
                      <td className="saas-td" style={{ width: '50px', padding: '8px', textAlign: 'center', borderRight: '1px solid #f1f5f9', color: '#64748b', fontWeight: 'normal' }}>
                        {index + 1}
                      </td>

                      {columnOrder.map(col => {
                        const editing = editingCell?.id === cid && editingCell?.col === col;
                        const val = edits[cid]?.[col as keyof Customer] ?? (c as any)[col] ?? '';
                        const readOnly = isReadOnly(col as string);

                        return (
                          <td key={col as string} className={`saas-td ${editing ? 'cell-editing' : ''}`} style={{ borderRight: '1px solid #f1f5f9', overflow: 'hidden', position: 'relative', padding: 0 }}>
                            
                            {editing && !readOnly ? (
                              col === 'owner' ? (
                                <select 
                                  autoFocus 
                                  className="cell-input" 
                                  value={val} 
                                  onChange={(e) => setEdits(prev => ({ ...prev, [cid]: { ...(prev[cid] || {}), [col]: e.target.value } }))}
                                  onBlur={() => handleSaveRecord(cid)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                >
                                  <option value="Both">Both</option>
                                  <option value="Jing">Jing</option>
                                  <option value="Pich">Pich</option>
                                  <option value="Mom">Mom</option>
                                </select>
                              ) : col === 'type' ? (
                                <select 
                                  autoFocus 
                                  className="cell-input" 
                                  value={val} 
                                  onChange={(e) => setEdits(prev => ({ ...prev, [cid]: { ...(prev[cid] || {}), [col]: e.target.value } }))}
                                  onBlur={() => handleSaveRecord(cid)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                >
                                  <option value="ហូប">ហូប</option>
                                  <option value="លក់បាយ">លក់បាយ</option>
                                  <option value="លក់ត">លក់ត</option>
                                  <option value="ធ្វើនំ">ធ្វើនំ</option>
                                  <option value="អំណោយ">អំណោយ</option>
                                </select>
                              ) : (
                                <input 
                                  autoFocus
                                  type="text"
                                  className="cell-input"
                                  style={{ paddingLeft: '12px' }}
                                  value={val}
                                  onChange={(e) => setEdits(prev => ({ ...prev, [cid]: { ...(prev[cid] || {}), [col]: e.target.value } }))}
                                  onBlur={() => handleSaveRecord(cid)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEdits(prev => { const n = { ...prev }; delete n[cid]; return n }); setEditingCell(null); } }}
                                />
                              )
                            ) : (
                              <div 
                                className="cell-display"
                                style={{ 
                                  paddingLeft: '12px', 
                                  fontWeight: 'normal', 
                                  color: readOnly ? '#94a3b8' : '#334155',
                                  cursor: readOnly ? 'default' : 'text',
                                  fontFamily: 'inherit',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  width: '100%',
                                  boxSizing: 'border-box'
                                }}
                                onClick={() => !readOnly && setEditingCell({ id: cid, col: col as string })}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {col === 'google_map' && val ? (
                                    String(val).startsWith('http') ? (
                                      <a href={val} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>🗺️ Open Map</a>
                                    ) : (
                                      <span style={{ color: '#94a3b8' }}>Invalid Map Link</span>
                                    )
                                  ) : (
                                    formatDisplayValue(col as string, val)
                                  )}
                                </span>
                              </div>
                            )}

                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 📱 MOBILE VIEW: CUSTOMER CARDS (ULTRA-COMPACT) */}
      <div className="mobile-only-list fade-in">
        {isLoading ? (
           <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading customers...</div>
        ) : processedCustomers.length === 0 ? (
           <EmptyState icon="🔍" title="No customers found" message="Try adjusting your search or filters." />
        ) : (
           processedCustomers.map((c, index) => {
              const cid = String(c.id);
              const daysVal = Number(c.days_since_last_purchase) || 0;
              const lastOrderText = formatDisplayValue('days_since_last_purchase', c.days_since_last_purchase);
              const lastDateText = formatDisplayValue('last_purchase_date', c.last_purchase_date);
              const isOld = c.days_since_last_purchase !== null && daysVal > 30; // Safe comparison avoiding null errors
              
              return (
                <div key={cid} className="saas-mobile-card compact-card" onClick={() => { 
                    setMobileEditCustomer(c); 
                    setEdits({ [cid]: { name: c.name, owner: c.owner, type: c.type, phone: c.phone, location: c.location, google_map: c.google_map } }); 
                }}>
                   <div className="compact-card-left">
                      <span style={{ fontWeight: 'bold', color: '#94a3b8', fontSize: '14px', minWidth: '22px' }}>{index + 1}.</span>
                      <div className="compact-text-group">
                         <div className="compact-title" style={{ fontWeight: 'normal' }}>{c.name}</div>
                         <div className="compact-sub">📞 {c.phone || 'No phone'} • 📍 {c.location || 'No loc'}</div>
                      </div>
                   </div>
                   <div className="compact-card-right" style={{ justifyContent: 'center', alignItems: 'flex-end', minWidth: '70px', textAlign: 'right' }}>
                      {/* 🔥 Top: Last Purchase Date */}
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 'normal', lineHeight: '1.2' }}>
                         {lastDateText === '—' || lastDateText === '-' ? <span style={{ color: '#94a3b8', fontSize: '14px' }}>—</span> : lastDateText}
                      </div>
                      {/* 🔥 Bottom: Days Since Last Purchase */}
                      <div className="compact-date" style={{ color: isOld ? '#dc2626' : '#0f172a', fontSize: '13px', fontWeight: 'normal', lineHeight: '1.4' }}>
                         {lastOrderText === '-' ? <span style={{ color: '#94a3b8', fontSize: '14px' }}>—</span> : `${lastOrderText} ago`}
                      </div>
                   </div>
                </div>
              )
           })
        )}
      </div>

      {/* 📱 MOBILE EDIT CUSTOMER MODAL */}
      <Modal isOpen={!!mobileEditCustomer} onClose={() => { setMobileEditCustomer(null); setEdits(prev => { const n = { ...prev }; if(mobileEditCustomer) delete n[String(mobileEditCustomer.id)]; return n; }); }} title={`Edit: ${mobileEditCustomer?.name}`} maxWidth="400px">
        {mobileEditCustomer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Customer Name</label>
              <input type="text" className="saas-input" value={edits[String(mobileEditCustomer.id)]?.name ?? mobileEditCustomer.name} onChange={e => setEdits(prev => ({ ...prev, [String(mobileEditCustomer.id)]: { ...(prev[String(mobileEditCustomer.id)] || {}), name: e.target.value } }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Account Owner</label>
                <select className="saas-input" value={edits[String(mobileEditCustomer.id)]?.owner ?? mobileEditCustomer.owner} onChange={e => setEdits(prev => ({ ...prev, [String(mobileEditCustomer.id)]: { ...(prev[String(mobileEditCustomer.id)] || {}), owner: e.target.value } }))}>
                  <option value="Both">Both</option>
                  <option value="Jing">Jing</option>
                  <option value="Pich">Pich</option>
                  <option value="Mom">Mom</option>
                </select>
              </div>
              <div>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Customer Type</label>
                <select className="saas-input" value={edits[String(mobileEditCustomer.id)]?.type ?? mobileEditCustomer.type} onChange={e => setEdits(prev => ({ ...prev, [String(mobileEditCustomer.id)]: { ...(prev[String(mobileEditCustomer.id)] || {}), type: e.target.value } }))}>
                  <option value="ហូប">ហូប</option>
                  <option value="លក់បាយ">លក់បាយ</option>
                  <option value="លក់ត">លក់ត</option>
                  <option value="ធ្វើនំ">ធ្វើនំ</option>
                  <option value="អំណោយ">អំណោយ</option>
                </select>
              </div>
            </div>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Phone Number</label>
              <input type="text" className="saas-input" value={edits[String(mobileEditCustomer.id)]?.phone ?? mobileEditCustomer.phone ?? ''} onChange={e => setEdits(prev => ({ ...prev, [String(mobileEditCustomer.id)]: { ...(prev[String(mobileEditCustomer.id)] || {}), phone: e.target.value } }))} />
            </div>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Location</label>
              <input type="text" className="saas-input" value={edits[String(mobileEditCustomer.id)]?.location ?? mobileEditCustomer.location ?? ''} onChange={e => setEdits(prev => ({ ...prev, [String(mobileEditCustomer.id)]: { ...(prev[String(mobileEditCustomer.id)] || {}), location: e.target.value } }))} />
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
               <button onClick={async () => {
                  if (!confirm('Are you sure you want to delete this customer?')) return;
                  setIsProcessing(true);
                  await supabase.from('customers').update({ is_archived: true }).eq('id', mobileEditCustomer.id).eq('branch_id', activeBranchId);
                  loadCustomers(); setMobileEditCustomer(null); showToast('success', 'Deleted', 'Customer safely removed.');
                  setIsProcessing(false);
               }} disabled={isProcessing} className="saas-btn" style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', opacity: isProcessing ? 0.5 : 1 }}>
                 {isProcessing ? '⏳...' : '🗑️ Delete'}
               </button>
               
               <div style={{ display: 'flex', gap: '8px' }}>
                 <button onClick={() => { setMobileEditCustomer(null); setEdits(prev => { const n = { ...prev }; delete n[String(mobileEditCustomer.id)]; return n; }); }} disabled={isProcessing} className="saas-btn saas-btn-secondary">Cancel</button>
                 <button onClick={async () => { 
                    setIsProcessing(true);
                    const success = await handleSaveRecord(String(mobileEditCustomer.id)); 
                    if (success) setMobileEditCustomer(null); 
                    setIsProcessing(false);
                 }} disabled={isProcessing} className="saas-btn saas-btn-primary">
                   {isProcessing ? 'Saving...' : 'Save'}
                 </button>
               </div>
            </div>
          </div>
        )}
      </Modal>

      {/* --- ADD CUSTOMER MODAL --- */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add New Customer" icon="👤" maxWidth="460px">
        <form onSubmit={handleAddCustomer}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>Customer Full Name *</label>
              <input type="text" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} className="saas-input" required />
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 130px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>Account Owner</label>
                <select value={newCustomer.owner} onChange={(e) => setNewCustomer({ ...newCustomer, owner: e.target.value })} className="saas-input" style={{ cursor: 'pointer' }}>
                  <option value="Both">Both</option>
                  <option value="Jing">Jing</option>
                  <option value="Pich">Pich</option>
                  <option value="Mom">Mom</option>
                </select>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>Customer Type</label>
                <select value={newCustomer.type} onChange={(e) => setNewCustomer({ ...newCustomer, type: e.target.value })} className="saas-input" style={{ cursor: 'pointer' }}>
                  <option value="ហូប">ហូប</option>
                  <option value="លក់បាយ">លក់បាយ</option>
                  <option value="លក់ត">លក់ត</option>
                  <option value="ធ្វើនំ">ធ្វើនំ</option>
                  <option value="អំណោយ">អំណោយ</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>Phone Number</label>
              <input type="text" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="e.g. 012 345 678" className="saas-input" />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>Location</label>
              <input type="text" value={newCustomer.location} onChange={(e) => setNewCustomer({ ...newCustomer, location: e.target.value })} placeholder="Phnom Penh" className="saas-input" />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>Google Map URL Link</label>
              <input type="url" value={newCustomer.google_map} onChange={(e) => setNewCustomer({ ...newCustomer, google_map: e.target.value })} placeholder="https://maps.google.com/..." className="saas-input" />
            </div>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" onClick={() => setShowAddModal(false)} disabled={isProcessing} className="saas-btn saas-btn-secondary">Cancel</button>
            <button type="submit" disabled={isProcessing} className="saas-btn saas-btn-primary">
              {isProcessing ? 'Saving...' : 'Save Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* --- PAGE-SPECIFIC CSS --- */}
      <style jsx global>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        .cell-display {
          padding: 16px 12px;
          font-size: 14px;
          min-height: 48px;
          cursor: text;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: flex;
          align-items: center;
        }
        .cell-input {
          width: 100%;
          height: 100%;
          padding: 16px 12px;
          font-size: 16px;
          border: none;
          outline: 2px solid #b58a3d;
          box-shadow: 0 0 5px rgba(181, 138, 61, 0.3);
          background: #fff;
          position: absolute;
          top: 0;
          left: 0;
          z-index: 20;
          box-sizing: border-box;
          color: #0f172a;
        }
        .cell-editing {
          z-index: 20;
          position: relative;
        }

        .header-container { 
          display: flex;
          justify-content: flex-start;
          align-items: center; 
          margin-bottom: 24px; 
          margin-top: 0;
          margin-left: 60px; /* Clears the burger menu icon for horizontal alignment */
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

        .header-actions {
          display: flex;
          gap: 10px;
          margin-left: auto;
          padding-right: 60px; 
        }

        /* 📱 RESPONSIVE CLASSES */
        .desktop-only-btn { display: block; }
        .mobile-only-btn { display: none !important; }
        .hide-on-mobile { display: inline; }

        .fade-in {
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* 📱 ULTRA-COMPACT MOBILE LIST UI */
        .mobile-only-list {
           display: none;
           flex-direction: column;
           gap: 10px;
           padding: 0 16px 24px 16px;
           overflow-y: auto;
           height: 100%;
        }
        .compact-card {
           background: #ffffff;
           border-radius: 10px;
           border: 1px solid #e2e8f0;
           box-shadow: 0 2px 4px rgba(0,0,0,0.02);
           padding: 14px 16px;
           display: flex;
           justify-content: space-between;
           align-items: center;
           cursor: pointer;
           transition: background 0.2s;
        }
        .compact-card:active { background: #f8fafc; }
        
        .compact-card-left {
           display: flex;
           align-items: center;
           gap: 12px;
           flex: 1;
           min-width: 0; 
        }
        .compact-card-right {
           display: flex;
           flex-direction: column;
           align-items: flex-end;
           gap: 4px;
           flex-shrink: 0;
           text-align: right;
        }
        .compact-text-group {
           display: flex;
           flex-direction: column;
           gap: 2px;
           min-width: 0;
        }
        .compact-title {
           font-weight: 700;
           font-size: 15px;
           color: #0f172a;
           white-space: nowrap;
           overflow: hidden;
           text-overflow: ellipsis;
        }
        .compact-sub {
           font-size: 12px;
           color: #64748b;
        }
        .compact-stock {
           font-weight: bold;
           font-size: 14px;
        }

        @media (max-width: 1023px) {
          .saas-table-wrapper { display: none !important; }
          .mobile-only-list { display: flex !important; }
          .hide-on-mobile { display: none !important; }
          .desktop-only-btn { display: none !important; }
          .mobile-only-btn { display: flex !important; }

          .mobile-action-row {
            display: flex;
            flex: 1;
            gap: 8px !important;
            align-items: center;
            min-width: 0 !important;
            justify-content: space-between;
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
          }

          .header-left {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 12px !important;
            flex: 1;
            min-width: 0;
          }
          
          .saas-page-title {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .header-actions {
            margin-left: auto;
            padding-right: 0px; 
          }
        }
      `}</style>
    </div>
  )
}