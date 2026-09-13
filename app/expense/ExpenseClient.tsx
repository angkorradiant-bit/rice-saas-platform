'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useFocusRefresh } from '@/lib/useFocusRefresh'
import { useToast } from '@/components/ToastProvider'
import { formatRiel, formatUSD, EXCHANGE_RATE } from '@/utils/formatters'
import { CurrencyInput } from '@/components/Inputs'
import Modal from '@/components/Modal'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext' // 🔥 GLOBAL MEMORY IMPORTED

// --- Interfaces ---
interface PaymentSplit {
  id: number;
  method: string;
  amount: number | '';
}

interface PendingExpense {
  id: string;
  remarks: string;
  spender: 'Pich' | 'Jing' | 'Both';
  payments: PaymentSplit[];
}

// --- 🔥 CUSTOM INLINE DATE PICKER COMPONENT (Bypasses Native iOS Pop-up) ---
function CustomDatePicker({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const dateObj = useMemo(() => (value ? new Date(value + 'T00:00:00') : new Date()), [value]);
  const [viewDate, setViewDate] = useState(() => new Date(dateObj.getFullYear(), dateObj.getMonth(), 1));

  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      if (!isNaN(d.getTime())) setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [value]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const daysOfWeek = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const formatDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const handleSelectDay = (dayNum: number) => {
    const m = String(month + 1).padStart(2, '0');
    const d = String(dayNum).padStart(2, '0');
    onChange(`${year}-${m}-${d}`);
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        className="saas-input"
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          height: '42px', 
          cursor: 'pointer', 
          backgroundColor: '#ffffff',
          boxSizing: 'border-box',
          padding: '0 12px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          borderRadius: '8px'
        }}
      >
        <span style={{ fontSize: '14px', color: '#0f172a', fontWeight: '500' }}>
          {formatDisplay(value) || 'Select date'}
        </span>
        
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, minWidth: '16px', display: 'block' }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      </div>

      {isOpen && (
        <>
          <div 
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} 
            onClick={() => setIsOpen(false)} 
          />
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 100,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            padding: '16px',
            width: 'max-content',
            minWidth: '280px',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <button type="button" onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontWeight: 'bold', color: '#64748b' }}>‹</button>
              <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#0f172a' }}>{months[month]} {year}</span>
              <button type="button" onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontWeight: 'bold', color: '#64748b' }}>›</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '8px' }}>
              {daysOfWeek.map(d => (
                <span key={d} style={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' }}>{d}</span>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center' }}>
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const m = String(month + 1).padStart(2, '0');
                const d = String(dayNum).padStart(2, '0');
                const dateStr = `${year}-${m}-${d}`;
                const isSelected = dateStr === value;
                const isToday = new Date().toISOString().split('T')[0] === dateStr;

                return (
                  <button
                    key={dayNum}
                    type="button"
                    onClick={() => handleSelectDay(dayNum)}
                    style={{
                      height: '32px',
                      width: '32px',
                      margin: '0 auto',
                      borderRadius: '8px',
                      border: isToday && !isSelected ? '1px solid #0284c7' : 'none',
                      background: isSelected ? '#0284c7' : 'transparent',
                      color: isSelected ? '#ffffff' : (isToday ? '#0284c7' : '#334155'),
                      fontWeight: isSelected || isToday ? 'bold' : 'normal',
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ExpenseDashboard() {
  const { showToast } = useToast();
  const { activeBranchId } = useBranch(); // 🔥 CONNECTED TO GLOBAL MEMORY
  const [isMounted, setIsMounted] = useState(false);
  const [isDeviceMobile, setIsDeviceMobile] = useState(false); // 🔥 FIX: Added missing state

  // 🔥 FIX: Added listener to securely track mobile screen sizes without crashing
  useEffect(() => {
    const checkDeviceType = () => {
      setIsDeviceMobile(window.innerWidth < 1024);
    };
    checkDeviceType();
    window.addEventListener('resize', checkDeviceType);
    return () => window.removeEventListener('resize', checkDeviceType);
  }, []);

  // --- Active Tab State ---
  const [activeTab, setActiveTab] = useState<'personal' | 'business' | 'staff' | 'database'>('personal')

  // --- Expense Ledger States (Auto-saved) ---
  const [expenseDate, setExpenseDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmModal, setConfirmModal] = useState(false)

  const createNewExpense = (): PendingExpense => ({
    id: Date.now().toString() + Math.random().toString().slice(2, 6),
    remarks: '',
    spender: 'Pich',
    payments: [{ id: Date.now(), method: 'QR ៛', amount: '' }]
  });

  const [pendingPersonal, setPendingPersonal] = useState<PendingExpense[]>([])
  const [pendingBusiness, setPendingBusiness] = useState<PendingExpense[]>([])
  // ✂️ Removed pendingRice state since we input rice on the Inventory page!

  // --- Staff Management States ---
  const [staffList, setStaffList] = useState<any[]>([])
  const [isFetchingStaff, setIsFetchingStaff] = useState(true)
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffSalary, setNewStaffSalary] = useState<number | ''>('')
  const [newStaffQuota, setNewStaffQuota] = useState<number | ''>(12)
  
  // 🟢 CLEAN MODAL STATES FOR COMPACT TABLE
  const [advanceModal, setAdvanceModal] = useState<{ isOpen: boolean, staff: any, amount: number | '', method: string }>({
    isOpen: false, staff: null, amount: '', method: 'Cash ៛'
  })

  const [leaveModal, setLeaveModal] = useState<{ isOpen: boolean, staff: any, quota: number | '', days: number | '', reason: string }>({
    isOpen: false, staff: null, quota: '', days: 1, reason: ''
  })

  const [settleModal, setSettleModal] = useState<{ isOpen: boolean, staff: any, amount: number | '', method: string }>({
    isOpen: false, staff: null, amount: '', method: 'Cash ៛'
  })

  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, staff: any, activeTab: 'debt' | 'leave', debtHistory: any[], leaveHistory: any[] }>({
    isOpen: false, staff: null, activeTab: 'debt', debtHistory: [], leaveHistory: []
  })

  const [editingCell, setEditingCell] = useState<{ id: number, field: string } | null>(null)
  const [editValue, setEditValue] = useState<string>('')

  // --- Database Tab States ---
  const [dbExpenses, setDbExpenses] = useState<any[]>([])
  const [dbStaffDebt, setDbStaffDebt] = useState<any[]>([])
  
  const [dbTab, setDbTab] = useState<'personal' | 'business' | 'rice' | 'staff_debt' | 'insight'>('insight')
  const [dbTabOrder, setDbTabOrder] = useState(['insight', 'personal', 'business', 'rice', 'staff_debt'])
  
  const [dbSortConfig, setDbSortConfig] = useState<{key: string, direction: 'asc' | 'desc'} | null>(null)
  const [isFetchingDb, setIsFetchingDb] = useState(false)

  // Insights State
  const [insightFilter, setInsightFilter] = useState<'today'|'week'|'month'|'custom'>('month')
  const [insightFrom, setInsightFrom] = useState('')
  const [insightTo, setInsightTo] = useState('')

  // --- Initialization & Local Storage Sync ---
  useEffect(() => {
    setIsMounted(true);
    const today = new Date().toISOString().split('T')[0]
    setExpenseDate(today)
    setInsightFrom(today)
    setInsightTo(today)
    
    const savedPers = localStorage.getItem('expense_ledger_personal');
    const savedBiz = localStorage.getItem('expense_ledger_business');
    // 🔥 CACHE BUSTER: Added '_v2' so the browser forgets the old tab layout!
    const savedDbTabOrder = localStorage.getItem('expense_db_tab_order_v2'); 
    
    if (savedPers) setPendingPersonal(JSON.parse(savedPers));
    else setPendingPersonal([createNewExpense()]);
    
    if (savedBiz) setPendingBusiness(JSON.parse(savedBiz));
    else setPendingBusiness([createNewExpense()]);

    if (savedDbTabOrder) {
      try { setDbTabOrder(JSON.parse(savedDbTabOrder)); } catch(e){}
    }

    const handleAutoSynced = () => {
      setPendingPersonal([createNewExpense()]);
      setPendingBusiness([createNewExpense()]);
      fetchDatabase();
    };
    window.addEventListener('expense_ledger_synced', handleAutoSynced);
    return () => window.removeEventListener('expense_ledger_synced', handleAutoSynced);
  }, [])

  // 🔥 FETCH DATA WHEN BRANCH CHANGES
  useEffect(() => {
    if (isMounted) {
      // 💣 SECURITY WIPE: Destroy all active expense drafts, staff modals, 
      // and inline edits when switching branches to prevent Cross-Tenant Data Smuggling!
      setPendingPersonal([createNewExpense()]);
      setPendingBusiness([createNewExpense()]);
      setAdvanceModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' });
      setLeaveModal({ isOpen: false, staff: null, quota: '', days: 1, reason: '' });
      setSettleModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' });
      setHistoryModal({ isOpen: false, staff: null, activeTab: 'debt', debtHistory: [], leaveHistory: [] });
      setConfirmModal(false);
      setEditingCell(null);
      setNewStaffName('');
      setNewStaffSalary('');
      setNewStaffQuota(12);

      fetchStaff();
      fetchDatabase();
    }
  }, [activeBranchId, isMounted]);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('expense_ledger_personal', JSON.stringify(pendingPersonal));
      const existingDate = localStorage.getItem('expense_ledger_date');
      if (!existingDate) {
        const todayCambodia = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' });
        localStorage.setItem('expense_ledger_date', expenseDate || todayCambodia);
      }
    }
  }, [pendingPersonal, expenseDate, isMounted]);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('expense_ledger_business', JSON.stringify(pendingBusiness));
      const existingDate = localStorage.getItem('expense_ledger_date');
      if (!existingDate) {
        const todayCambodia = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' });
        localStorage.setItem('expense_ledger_date', expenseDate || todayCambodia);
      }
    }
  }, [pendingBusiness, expenseDate, isMounted]);

  useEffect(() => {
    // 🔥 CACHE BUSTER: Saves to the new v2 layout list
    if (isMounted) localStorage.setItem('expense_db_tab_order_v2', JSON.stringify(dbTabOrder));
  }, [dbTabOrder, isMounted])

  useFocusRefresh(() => {
    fetchStaff();
    fetchDatabase();
  });

  // --- Helper: Dynamic Ledger Handlers ---
  const getActiveList = () => activeTab === 'personal' ? pendingPersonal : pendingBusiness;
  const setActiveList = (newList: PendingExpense[]) => activeTab === 'personal' ? setPendingPersonal(newList) : setPendingBusiness(newList);

  const updateExpense = (id: string, field: keyof PendingExpense, value: any) => {
    setActiveList(getActiveList().map(exp => exp.id === id ? { ...exp, [field]: value } : exp));
  }

  const addPaymentSplit = (expId: string) => {
    setActiveList(getActiveList().map(exp => {
      if (exp.id === expId) {
        return { ...exp, payments: [{ id: Date.now(), method: 'Cash ៛', amount: '' }, ...exp.payments] }
      }
      return exp;
    }));
  }

  const updatePaymentSplit = (expId: string, payId: number, field: string, value: any) => {
    setActiveList(getActiveList().map(exp => {
      if (exp.id === expId) {
        return {
          ...exp,
          payments: exp.payments.map(p => p.id === payId ? { ...p, [field]: value } : p)
        }
      }
      return exp;
    }));
  }

  const removePaymentSplit = (expId: string, payId: number) => {
    setActiveList(getActiveList().map(exp => {
      if (exp.id === expId) {
        return { ...exp, payments: exp.payments.filter(p => p.id !== payId) }
      }
      return exp;
    }));
  }

  const removeExpense = (id: string) => {
    setActiveList(getActiveList().filter(exp => exp.id !== id));
  }

  const addNewExpense = () => {
    setActiveList([createNewExpense(), ...getActiveList()]);
  }

  // --- API: Fetch Staff ---
  async function fetchStaff() {
    setIsFetchingStaff(true)
    const { data } = await supabase.from('staff').select('*').eq('branch_id', activeBranchId).order('id', { ascending: true }) // 🔥 BRANCH FILTER
    if (data) setStaffList(data)
    setIsFetchingStaff(false)
  }

  // --- API: Fetch Database Tab ---
  async function fetchDatabase() {
    setIsFetchingDb(true)
    const [ {data: exp}, {data: debt} ] = await Promise.all([
       supabase.from('expenses').select('*').eq('branch_id', activeBranchId).order('created_at', { ascending: false }).limit(2000), // 🔥 BRANCH FILTER
       supabase.from('staff_debt_history').select('*, staff:staff_id(name)').eq('branch_id', activeBranchId).order('created_at', { ascending: false }).limit(2000) // 🔥 BRANCH FILTER
    ])
    setDbExpenses(exp || []);
    setDbStaffDebt(debt || []);
    setIsFetchingDb(false)
  }

  // --- Action: Delete Database Record ---
  async function handleDeleteDbRecord(id: number) {
    if (!confirm('Are you sure you want to permanently delete this expense? Your total assets and insights will automatically recalculate.')) return;
    
    const { error } = await supabase.from('expenses').delete().eq('id', id).eq('branch_id', activeBranchId);
    
    if (error) {
      showToast('error', 'Deletion Failed', `Error: ${error.message}`);
    } else {
      showToast('success', 'Deleted', 'Expense record has been removed.');
      setDbExpenses(prev => prev.filter(e => e.id !== id));
      window.dispatchEvent(new Event('expense_ledger_synced')); // 🔥 Triggers auto-sync across tabs to update insights
    }
  }

  // --- Action: Submit Bulk Expenses ---
  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    setConfirmModal(false)

    const list = getActiveList();
    const validExpenses = list.filter(exp => exp.remarks.trim() !== '' && exp.payments.some(p => Number(p.amount) > 0));

    if (validExpenses.length === 0) {
      showToast('error', 'Missing Info', 'Please add at least one valid expense with remarks and a payment amount.');
      return;
    }

    setLoading(true)

    try {
      const payloadArray = validExpenses.map(exp => {
        const activePayments = exp.payments.filter(r => (Number(r.amount) || 0) > 0);
        
        let combinedMethod = activePayments[0].method;
        if (activePayments.length > 1) {
          combinedMethod = activePayments.map(r => `${r.method}:${r.amount}`).join(',');
        }

        let totalUsd = 0;
        let totalRiel = 0;

        for (const row of activePayments) {
          // 🔥 RELIABILITY FIX: Strip commas from CurrencyInput strings to prevent NaN database corruption
          let rawAmount = Number(String(row.amount).replace(/,/g, '')) || 0;
          if (row.method.includes('$')) {
            totalUsd += rawAmount;
          } else {
            totalRiel += rawAmount;
          }
        }

        return {
          expense_date: expenseDate,
          spender: exp.spender,
          payment_method: combinedMethod,
          remarks: exp.remarks,                    
          amount_usd: totalUsd,              
          amount_riel: totalRiel,         
          description: activeTab.toUpperCase(),
          branch_id: activeBranchId // 🔥 STAMPED
        };
      });

      const { error } = await supabase.from('expenses').insert(payloadArray.reverse()); 

      if (error) throw error;

      showToast('success', 'Success', `${validExpenses.length} expense(s) recorded successfully!`);
      setActiveList([createNewExpense()]);
      fetchDatabase(); 

    } catch (err: any) {
      showToast('error', 'Save Failed', `Error saving entry: ${err.message}`);
    } finally {
      setLoading(false)
    }
  }

  // --- Staff Methods ---
  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!newStaffName) { showToast('error', 'Validation Error', 'Staff name is required'); return; }
    setLoading(true)
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    
    const { error } = await supabase.from('staff').insert([{ 
      name: newStaffName, 
      salary: Number(newStaffSalary) || 0, 
      total_debt_riel: 0, 
      total_debt_usd: 0, 
      start_date: firstOfMonth,
      leave_quota: Number(newStaffQuota) || 12,
      leave_used: 0,
      branch_id: activeBranchId // 🔥 STAMPED
    }])
    setLoading(false)
    if (error) { showToast('error', 'Error', `Error adding staff: ${error.message}`); } else {
      showToast('success', 'Staff Added', `${newStaffName} has been registered.`);
      setNewStaffName(''); setNewStaffSalary(''); setNewStaffQuota(12); fetchStaff();
    }
  }

  // 🟢 CLEAN MODAL HANDLER: STAFF ADVANCE (ATOMIC)
  async function handleAdvanceSubmit() {
    if (loading) return;
    const staff = advanceModal.staff;
    const rawAmount = Number(String(advanceModal.amount).replace(/,/g, '')) || 0;
    if (!rawAmount || rawAmount === 0) { showToast('error', 'Validation Error', 'Please enter a valid advance amount.'); return; }
    
    setLoading(true);
    try {
      let saveRiel = 0, saveUsd = 0;
      if (advanceModal.method.includes('$')) saveUsd = rawAmount; 
      else saveRiel = rawAmount;

      const payload = {
          staff_id: staff.id,
          branch_id: activeBranchId,
          type: 'ADVANCE',
          amount_riel: saveRiel,
          amount_usd: saveUsd,
          method: advanceModal.method,
          remarks: `Staff Advance: ${staff.name}`,
          log_expense: 'true'
      };

      const { error } = await supabase.rpc('process_staff_transaction', { p_payload: payload });
      if (error) throw error;

      setAdvanceModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' });
      showToast('success', 'Advance Added', `Advance added for ${staff.name}`);
      fetchStaff();
      fetchDatabase();
    } catch (err: any) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  // 🟢 CLEAN MODAL HANDLER: LEAVE MANAGEMENT (ATOMIC)
  async function handleLeaveSubmit() {
    if (loading) return;
    const staff = leaveModal.staff;
    const days = Number(leaveModal.days) || 0;
    const quota = Number(leaveModal.quota) || 12;
    const reason = leaveModal.reason.trim() || 'Annual / Personal Leave';

    if (days <= 0) { showToast('error', 'Invalid Input', 'Please enter a valid number of leave days.'); return; }

    const newUsed = Number(staff.leave_used || 0) + days;
    const remaining = quota - newUsed;

    if (remaining < 0) {
      if (!confirm(`⚠️ Warning: Taking ${days} days will exceed their leave quota by ${Math.abs(remaining)} days. Continue anyway?`)) return;
    }

    setLoading(true);
    try {
      if (quota !== Number(staff.leave_quota)) {
          await supabase.from('staff').update({ leave_quota: quota }).eq('id', staff.id).eq('branch_id', activeBranchId);
      }

      const payload = {
          staff_id: staff.id,
          branch_id: activeBranchId,
          type: 'LEAVE',
          days: days,
          reason: reason
      };

      const { error } = await supabase.rpc('process_staff_transaction', { p_payload: payload });
      if (error) throw error;

      setLeaveModal({ isOpen: false, staff: null, quota: '', days: 1, reason: '' });
      showToast('success', 'Leave Logged', `${days} day(s) leave recorded for ${staff.name}`);
      fetchStaff();
    } catch (err: any) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  // 🟢 CLEAN MODAL HANDLER: DEBT SETTLEMENT (ATOMIC)
  async function handleSettleSubmit() {
    if (loading) return;
    const staff = settleModal.staff;
    const rawAmount = Number(String(settleModal.amount).replace(/,/g, '')) || 0;
    if (!rawAmount || rawAmount <= 0) { showToast('error', 'Invalid Amount', 'Enter a valid settlement amount.'); return; }
    
    setLoading(true);
    try {
      let saveRiel = 0, saveUsd = 0;
      let currentRiel = Number(staff.total_debt_riel || 0); 
      let currentUsd = Number(staff.total_debt_usd || 0);

      if (settleModal.method.includes('$')) {
        if (rawAmount > currentUsd) { showToast('error', 'Overpayment', 'Cannot settle more USD than they owe.'); setLoading(false); return; }
        saveUsd = -Math.abs(rawAmount); 
      } else {
        if (rawAmount > currentRiel) { showToast('error', 'Overpayment', 'Cannot settle more Riel than they owe.'); setLoading(false); return; }
        saveRiel = -Math.abs(rawAmount); 
      }

      const isWriteOff = settleModal.method === 'Write-off';
      const historyMethodStr = isWriteOff ? '❌ Bad Debt (Write-off)' : `Settled: ${settleModal.method}`;

      const payload = {
          staff_id: staff.id,
          branch_id: activeBranchId,
          type: 'SETTLE',
          amount_riel: saveRiel,
          amount_usd: saveUsd,
          method: historyMethodStr,
          remarks: `Staff Debt Settlement: ${staff.name}`,
          log_expense: isWriteOff ? 'false' : 'true'
      };

      const { error } = await supabase.rpc('process_staff_transaction', { p_payload: payload });
      if (error) throw error;

      setSettleModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' });
      showToast('success', isWriteOff ? 'Debt Forgiven' : 'Settled', isWriteOff ? `Debt written off for ${staff.name}` : `Settlement recorded for ${staff.name}`);
      fetchStaff();
      fetchDatabase();
    } catch (err: any) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  // 🟢 UNIFIED HISTORY MODAL (View both Debt and Leave History)
  async function handleViewHistory(staff: any) {
    const [{ data: debtData }, { data: leaveData }] = await Promise.all([
      // 🔥 SECURITY FIX: Enforce branch isolation on history read operations
      supabase.from('staff_debt_history').select('*').eq('staff_id', staff.id).eq('branch_id', activeBranchId).order('created_at', { ascending: false }),
      supabase.from('staff_leave_history').select('*').eq('staff_id', staff.id).eq('branch_id', activeBranchId).order('created_at', { ascending: false })
    ]);
    
    setHistoryModal({ 
      isOpen: true, 
      staff: staff, 
      activeTab: 'debt', 
      debtHistory: debtData || [], 
      leaveHistory: leaveData || [] 
    });
  }

  async function saveInlineEdit(id: number, field: string) {
    if (!editValue && editValue !== '0' && field !== 'name') { setEditingCell(null); return; }
    
    // 🛡️ DASHBOARD FIX: Block direct edits to debt fields. Debt must ONLY be changed via Advance/Settle buttons to preserve Cash-to-AR ledger symmetry.
    if (field === 'total_debt_riel' || field === 'total_debt_usd') {
        showToast('error', 'Action Blocked', 'Debt balances cannot be manually edited. Please use the Advance or Settle buttons to maintain accurate cash ledgers.');
        setEditingCell(null);
        return;
    }

    let finalValue: any = editValue;
    if (field === 'salary' || field === 'leave_quota') { 
      finalValue = Number(editValue.replace(/,/g, '')) || 0; 
    }
    
    setStaffList(prev => prev.map(s => s.id === id ? { ...s, [field]: finalValue } : s));
    setEditingCell(null);

    const { error } = await supabase.from('staff').update({ [field]: finalValue }).eq('id', id).eq('branch_id', activeBranchId);
    
    if (error) { showToast('error', 'Update Failed', error.message); fetchStaff(); }
  }

  async function handleDeleteStaff(id: number, name: string) {
    // 🛡️ DASHBOARD FIX: Prevent burning AR Assets by deleting staff who owe money
    const staff = staffList.find(s => s.id === id);
    if (staff && (Number(staff.total_debt_riel) > 0 || Number(staff.total_debt_usd) > 0)) {
       showToast('error', 'Action Blocked', `Cannot delete ${name} because they still owe a debt balance. Settle their debt to 0 first to protect your Net Worth metric.`);
       return;
    }

    if (!confirm(`Are you sure you want to remove ${name} from the payroll?`)) return;
    
    setStaffList(prev => prev.filter(s => s.id !== id));
    const { error } = await supabase.from('staff').delete().eq('id', id).eq('branch_id', activeBranchId);
    if (error) { showToast('error', 'Deletion Failed', error.message); fetchStaff(); } else showToast('success', 'Deleted', `${name} has been removed.`);
  }

  function calculateDaysWorked(startDateStr: string) {
    if (!startDateStr) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0); 
    const currentMonth = today.getMonth(); const currentYear = today.getFullYear();
    const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
    let effectiveStartDate = startDate;
    if (startDate.getMonth() !== currentMonth || startDate.getFullYear() !== currentYear) {
      effectiveStartDate = new Date(currentYear, currentMonth, 1); effectiveStartDate.setHours(0, 0, 0, 0);
    }
    const diffTime = today.getTime() - effectiveStartDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1; 
    return diffDays > 0 ? diffDays : 0;
  }

  // --- Database Tab Sorting & Filtering ---
  const filteredAndSortedDb = useMemo(() => {
    let baseData: any[] = [];
    if (dbTab === 'staff_debt') baseData = dbStaffDebt;
    else if (dbTab === 'insight') return []; 
    else baseData = dbExpenses.filter(e => e.description === dbTab.toUpperCase());

    if (!dbSortConfig) return baseData;

    return [...baseData].sort((a, b) => {
        const { key, direction } = dbSortConfig;
        let valA = a[key], valB = b[key];
        
        if (key === 'staff_name') { valA = a.staff?.name || ''; valB = b.staff?.name || ''; }
        if (key === 'expense_date') { valA = new Date(a.expense_date || a.created_at).getTime(); valB = new Date(b.expense_date || b.created_at).getTime(); }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
  }, [dbTab, dbExpenses, dbStaffDebt, dbSortConfig]);

  // --- Insights Calculation Logic ---
  const insightsData = useMemo(() => {
    if (dbTab !== 'insight') return null;

    const filterDate = (dateStr: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr); d.setHours(0,0,0,0);
      const today = new Date(); today.setHours(0,0,0,0);
      
      if (insightFilter === 'today') return d.getTime() === today.getTime();
      if (insightFilter === 'week') {
        const lw = new Date(today); lw.setDate(lw.getDate() - 7);
        return d >= lw && d <= today;
      }
      if (insightFilter === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
      if (insightFilter === 'custom') {
        const f = new Date(insightFrom); f.setHours(0,0,0,0);
        const t = new Date(insightTo); t.setHours(23,59,59,999);
        return d >= f && d <= t;
      }
      return true;
    };

    const validExp = dbExpenses.filter(e => filterDate(e.expense_date || e.created_at));
    const validDebt = dbStaffDebt.filter(d => filterDate(d.created_at));

    let totalPersRiel = 0, totalPersUsd = 0;
    let totalBizRiel = 0, totalBizUsd = 0;
    let totalRiceRiel = 0, totalRiceUsd = 0;
    let totalDebtRiel = 0, totalDebtUsd = 0;

    validExp.forEach(e => {
      const amtRiel = Number(e.amount_riel) || 0;
      const amtUsd = Number(e.amount_usd) || 0;
      
      if (e.description === 'PERSONAL') {
        totalPersRiel += amtRiel;
        totalPersUsd += amtUsd;
      }
      if (e.description === 'BUSINESS') {
        totalBizRiel += amtRiel;
        totalBizUsd += amtUsd;
      }
      if (e.description === 'RICE') {
        totalRiceRiel += amtRiel;
        totalRiceUsd += amtUsd;
      }
    });

    validDebt.forEach(d => {
      let amt = Number(d.amount);
      if (!(d.payment_method || '').includes('Settled')) {
        if ((d.payment_method || '').includes('$')) totalDebtUsd += amt;
        else totalDebtRiel += amt;
      }
    });

    const totalExpRiel = totalPersRiel + totalBizRiel + totalRiceRiel;
    const totalExpUsd = totalPersUsd + totalBizUsd + totalRiceUsd;

    const topPers = validExp.filter(e => e.description === 'PERSONAL').sort((a,b) => ((Number(b.amount_riel)||0) + (Number(b.amount_usd)||0)*EXCHANGE_RATE) - ((Number(a.amount_riel)||0) + (Number(a.amount_usd)||0)*EXCHANGE_RATE)).slice(0, 5);
    const topBiz = validExp.filter(e => e.description === 'BUSINESS').sort((a,b) => ((Number(b.amount_riel)||0) + (Number(b.amount_usd)||0)*EXCHANGE_RATE) - ((Number(a.amount_riel)||0) + (Number(a.amount_usd)||0)*EXCHANGE_RATE)).slice(0, 5);

    const thisMonthData = new Array(31).fill(0);
    const lastMonthData = new Array(31).fill(0);

    const isThisMonth = (dateStr: string) => {
       const d = new Date(dateStr); const now = new Date();
       return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    const isLastMonth = (dateStr: string) => {
       const d = new Date(dateStr); const now = new Date();
       const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
       return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }

    dbExpenses.forEach(e => {
       if (e.description !== 'PERSONAL' && e.description !== 'BUSINESS' && e.description !== 'RICE') return;
       const d = new Date(e.expense_date || e.created_at);
       const dayIdx = d.getDate() - 1;
       const amt = Number(e.amount_riel) + (Number(e.amount_usd) * EXCHANGE_RATE);
       
       if (isThisMonth(e.expense_date || e.created_at) && dayIdx >= 0 && dayIdx < 31) {
          thisMonthData[dayIdx] += amt;
       } else if (isLastMonth(e.expense_date || e.created_at) && dayIdx >= 0 && dayIdx < 31) {
          lastMonthData[dayIdx] += amt;
       }
    });

    return { totalPersRiel, totalPersUsd, totalBizRiel, totalBizUsd, totalRiceRiel, totalRiceUsd, totalExpRiel, totalExpUsd, totalDebtRiel, totalDebtUsd, topPers, topBiz, thisMonthData, lastMonthData };
  }, [dbTab, dbExpenses, dbStaffDebt, insightFilter, insightFrom, insightTo]);

  if (!isMounted) return null; 

  return (
    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', backgroundColor: '#f8fafc' }}>

      {/* HEADER (Frozen, Uses Explicit Height to Align with Sidebar Menu) */}
      <div className="header-container" style={{ flexShrink: 0 }}>
        <div className="header-left">
          {/* 🔥 FIX: Forced line-height crushes the invisible text padding for visual symmetry */}
          <h1 className="saas-page-title" style={{ margin: 0, padding: 0, display: 'flex', alignItems: 'center', lineHeight: '1.2' }}>💸 Daily Expense & Payroll</h1>
        </div>
      </div>

      {/* TABS (Frozen) */}
      {/* 🔥 FIX: Erased padding and locked margin-bottom to exactly 20px to match header */}
      <div className="content-container" style={{ flexShrink: 0, marginBottom: '20px' }}>
        {/* 🔥 FIX: Forced margin: 0 to override any hidden global margins from saas-tab-container */}
        <div className="saas-tab-container hide-scrollbar" style={{ margin: 0, display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch', gap: '8px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '6px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <button type="button" onClick={() => setActiveTab('personal')} className={`saas-tab ${activeTab === 'personal' ? 'active' : ''}`} style={{ flexShrink: 0, padding: '10px 24px' }}>
            🏡 Personal
          </button>
          <button type="button" onClick={() => setActiveTab('business')} className={`saas-tab ${activeTab === 'business' ? 'active' : ''}`} style={{ flexShrink: 0, padding: '10px 24px' }}>
            🏢 Business
          </button>
          <button type="button" onClick={() => setActiveTab('staff')} className={`saas-tab ${activeTab === 'staff' ? 'active' : ''}`} style={{ flexShrink: 0, padding: '10px 24px' }}>
            👥 Staff Payroll
          </button>
          <button type="button" onClick={() => setActiveTab('database')} className={`saas-tab ${activeTab === 'database' ? 'active' : ''}`} style={activeTab === 'database' ? { background: '#10b981', color: '#fff', flexShrink: 0, padding: '10px 24px' } : { flexShrink: 0, padding: '10px 24px' }}>
            🗄️ Expense Database
          </button>
        </div>
      </div>

      {/* SCROLLING CONTENT AREA */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingBottom: '60px' }}>
        <div className="content-container">

          {/* --- DYNAMIC EXPENSE LEDGER (Personal & Business) --- */}
          {(activeTab === 'personal' || activeTab === 'business') && (
            <form onSubmit={handleSubmit} className="saas-card" style={{ padding: isDeviceMobile ? '16px' : '30px', margin: 0, width: '100%' }}>
              
              {/* Top Action Row (Date, Add, Submit) */}
              <div className="top-action-row" style={{ marginBottom: isDeviceMobile ? '20px' : '32px' }}>
                <div className="date-wrapper">
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748b', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>Date</label>
                  <CustomDatePicker value={expenseDate} onChange={setExpenseDate} />
                </div>
                
                <div className="button-wrapper">
                  <button 
                    type="button" 
                    onClick={addNewExpense}
                    className="saas-btn" 
                    style={{ padding: '0 16px', fontWeight: 'bold', whiteSpace: 'nowrap', margin: 0, height: '42px', background: '#e0f2fe', color: '#0284c7', border: '1px solid #bae6fd', borderRadius: '8px' }}
                  >
                    + Add
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setConfirmModal(true)}
                    disabled={loading} 
                    className={`saas-btn ${loading ? 'saas-btn-secondary' : 'saas-btn-primary'}`}
                    style={{ padding: '0 24px', fontWeight: 'bold', whiteSpace: 'nowrap', margin: 0, height: '42px', opacity: loading ? 0.7 : 1, borderRadius: '8px' }}
                  >
                    <span className="hide-on-mobile">{loading ? 'Processing...' : `Submit ${getActiveList().length} Expense(s)`}</span>
                    <span className="show-on-mobile">Submit</span>
                  </button>
                </div>
              </div>

              {/* List of Pending Expenses */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: isDeviceMobile ? '16px' : '24px' }}>
                {getActiveList().map((exp, index) => (
                  <div key={exp.id} className="expense-entry-card" style={{ padding: isDeviceMobile ? '16px' : '24px', background: '#ffffff', borderRadius: '12px', border: '1px solid #cbd5e1', position: 'relative', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)' }}>
                    
                    {/* 3-COLUMN GRID SETUP */}
                    <div className="expense-grid">

                      {/* Col 1: Remarks */}
                      <>
                        <div className="expense-col desktop-only-flex" style={{ flexDirection: 'column', gap: '8px' }}>
                          <label style={{ height: '16px', lineHeight: '16px', fontSize: '11px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', margin: 0 }}>Remarks</label>
                          <input 
                            type="text" 
                            placeholder="Remarks"
                            value={exp.remarks} 
                            onChange={(e) => updateExpense(exp.id, 'remarks', e.target.value)} 
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                document.getElementById(`amount-wrapper-${exp.id}`)?.querySelector('input')?.focus();
                              }
                            }}
                            required 
                            className="saas-input" 
                            style={{ width: '100%', height: '42px', margin: 0, boxSizing: 'border-box' }}
                          />
                        </div>

                        <div className="expense-col mobile-only-flex" style={{ flexDirection: 'column', justifyContent: 'flex-end', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', height: '42px', borderBottom: '1px dashed #cbd5e1', paddingBottom: '4px' }}>
                            <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '16px', marginRight: '8px' }}>
                              {getActiveList().length - index}.
                            </span>
                            <input 
                              type="text" 
                              placeholder="Remarks"
                              value={exp.remarks} 
                              onChange={(e) => updateExpense(exp.id, 'remarks', e.target.value)} 
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  document.getElementById(`amount-wrapper-${exp.id}`)?.querySelector('input')?.focus();
                                }
                              }}
                              required 
                              style={{ flex: 1, minWidth: 0, height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '16px', color: '#0f172a' }}
                            />
                            {getActiveList().length > 1 && (
                              <button type="button" onClick={() => removeExpense(exp.id)} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', fontWeight: 'bold', padding: '0 0 0 12px', lineHeight: 1 }} title="Remove">
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      </>

                      {/* Col 2: Payments */}
                      <div className="expense-col" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ height: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ lineHeight: '16px', fontSize: '11px', color: '#64748b', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>Payment Method(s)</label>
                            <button type="button" onClick={() => addPaymentSplit(exp.id)} className="saas-btn" style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', padding: '0 8px', fontSize: '11px', fontWeight: 'bold', height: '20px', display: 'flex', alignItems: 'center', borderRadius: '4px' }}>
                              + Split
                            </button>
                          </div>

                          {getActiveList().length > 1 && (
                            <button type="button" onClick={() => removeExpense(exp.id)} className="desktop-only-flex" style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold', padding: 0, lineHeight: 1 }} title="Remove Expense">
                              ✕
                            </button>
                          )}
                        </div>

                        {exp.payments.map((row, rIndex) => (
                          <div key={row.id} className="payment-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select 
                              value={row.method} 
                              onChange={e => updatePaymentSplit(exp.id, row.id, 'method', e.target.value)}
                              className="saas-input"
                              style={{ flex: '0 0 110px', cursor: 'pointer', fontSize: '14px', margin: 0, height: '42px', padding: '0 8px', boxSizing: 'border-box' }}
                            >
                              <option value="QR ៛">📱 QR ៛</option>
                              <option value="Cash ៛">💵 Cash ៛</option>
                              <option value="Cash $">💵 Cash $</option>
                              <option value="QR $">📱 QR $</option>
                            </select>
                            
                            <div id={rIndex === 0 ? `amount-wrapper-${exp.id}` : undefined} style={{ flex: 1 }}>
                              <CurrencyInput 
                                placeholder="0" 
                                value={row.amount} 
                                onChange={(val: any) => updatePaymentSplit(exp.id, row.id, 'amount', val)}
                                className="saas-input"
                                style={{ textAlign: 'right', height: '42px', margin: 0, boxSizing: 'border-box' }}
                              />
                            </div>
                            
                            {exp.payments.length > 1 && (
                              <button type="button" onClick={() => removePaymentSplit(exp.id, row.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '18px', cursor: 'pointer', padding: '0 4px', fontWeight: 'bold', height: '42px' }}>✕</button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Col 3: Spender */}
                      <div className="expense-col" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ height: '16px', lineHeight: '16px', fontSize: '11px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', margin: 0 }}>Spender</label>
                        <div className="saas-tab-container" style={{ margin: 0, padding: 0, background: '#f1f5f9', border: 'none', boxShadow: 'none', height: '42px', display: 'flex', boxSizing: 'border-box', borderRadius: '8px', overflow: 'hidden' }}>
                          {(['Pich', 'Jing', 'Both'] as const).map(person => (
                            <button
                              type="button"
                              key={person}
                              onClick={() => updateExpense(exp.id, 'spender', person)}
                              style={exp.spender === person ? { background: '#e0f2fe', color: '#0284c7', fontWeight: 'bold', flex: 1, padding: 0, borderRadius: 0, border: 'none', height: '100%', fontSize: '14px', cursor: 'pointer' } : { flex: 1, padding: 0, fontWeight: '500', color: '#94a3b8', background: 'transparent', border: 'none', height: '100%', fontSize: '14px', cursor: 'pointer' }}
                            >
                              {person}
                            </button>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            </form>
          )}

          {/* --- 🟢 UPGRADED STAFF MANAGEMENT UI --- */}
          {activeTab === 'staff' && (
            <div>
              <div className="saas-card" style={{ marginBottom: '24px', padding: '20px' }}>
                <div className="saas-card-title" style={{ marginBottom: '16px' }}>➕ Register New Staff</div>
                <form onSubmit={handleAddStaff} style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>Name</label>
                    <input type="text" placeholder="Staff Name" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} className="saas-input" onBlur={() => { setTimeout(() => { window.scrollTo(0, 0); document.body.scrollTop = 0; }, 100); }} required />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>Monthly Salary (៛)</label>
                    <CurrencyInput value={newStaffSalary} onChange={(v: any) => setNewStaffSalary(v)} className="saas-input" placeholder="1,200,000" />
                  </div>
                  <div style={{ flex: '1 1 130px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>Annual Leave Quota</label>
                    <input type="number" value={newStaffQuota} onChange={e => setNewStaffQuota(e.target.value === '' ? '' : Number(e.target.value))} className="saas-input" placeholder="12" />
                  </div>
                  <button type="submit" disabled={loading} className="saas-btn saas-btn-primary" style={{ padding: '12px 24px' }}>Add Staff</button>
                </form>
              </div>

              {/* COMPACT TABLE (Replaced Wide Inline Forms with Modals + Added Leave Quota Pill) */}
              <div className="saas-table-wrapper">
                <div className="saas-table-responsive">
                  <table className="saas-table" style={{ minWidth: '1000px' }}>
                    <thead>
                      <tr>
                        <th className="saas-th">Name</th>
                        <th className="saas-th">Start Date</th>
                        <th className="saas-th" style={{ textAlign: 'right' }}>Monthly Salary</th>
                        <th className="saas-th" style={{ textAlign: 'right', color: '#10b981' }}>Earned MTD</th>
                        <th className="saas-th" style={{ textAlign: 'right', color: '#ef4444' }}>Debt Balance</th>
                        <th className="saas-th" style={{ textAlign: 'center', color: '#3b82f6' }}>Leave Balance</th>
                        <th className="saas-th" style={{ textAlign: 'right', color: '#3b82f6' }}>Net Payout</th>
                        <th className="saas-th" style={{ textAlign: 'center', width: '220px' }}>Quick Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isFetchingStaff ? (
                        <TableSkeleton columns={8} rows={3} />
                      ) : staffList.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: 0 }}>
                            <EmptyState icon="👥" title="No staff found" message="Register your first staff member above." />
                          </td>
                        </tr>
                      ) : (
                        staffList.map((staff) => {
                          const monthlySalary = Number(staff.salary) || 0;
                          const dailyRate = monthlySalary / 30; 
                          const daysWorked = calculateDaysWorked(staff.start_date);
                          const totalEarned = Math.round(dailyRate * daysWorked);
                          
                          const totalDebtRiel = Number(staff.total_debt_riel) || 0;
                          const totalDebtUsd = Number(staff.total_debt_usd) || 0;

                          const leaveQuota = Number(staff.leave_quota) || 12;
                          const leaveUsed = Number(staff.leave_used) || 0;
                          const leaveRemaining = leaveQuota - leaveUsed;

                          const netPayout = totalEarned - totalDebtRiel - (totalDebtUsd * EXCHANGE_RATE);
                          const isNegativePayout = netPayout < 0;

                          return (
                            <tr key={staff.id} className="saas-tr">
                              <td className="saas-td" style={{ cursor: 'text', fontWeight: 'bold' }} onClick={() => { setEditingCell({ id: staff.id, field: 'name' }); setEditValue(staff.name); }}>
                                {editingCell?.id === staff.id && editingCell?.field === 'name' ? (
                                  <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => saveInlineEdit(staff.id, 'name')} onKeyDown={e => e.key === 'Enter' && saveInlineEdit(staff.id, 'name')} className="saas-input" />
                                ) : staff.name}
                              </td>
                              <td className="saas-td" style={{ cursor: 'text' }} onClick={() => { setEditingCell({ id: staff.id, field: 'start_date' }); setEditValue(staff.start_date || ''); }}>
                                {editingCell?.id === staff.id && editingCell?.field === 'start_date' ? (
                                  <input type="date" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => saveInlineEdit(staff.id, 'start_date')} onKeyDown={e => e.key === 'Enter' && saveInlineEdit(staff.id, 'start_date')} className="saas-input" />
                                ) : (
                                  <div>{staff.start_date || 'N/A'}<div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', fontWeight: 'bold' }}>{daysWorked} days</div></div>
                                )}
                              </td>
                              <td className="saas-td" style={{ cursor: 'text', textAlign: 'right' }} onClick={() => { setEditingCell({ id: staff.id, field: 'salary' }); setEditValue(String(staff.salary || 0)); }}>
                                {editingCell?.id === staff.id && editingCell?.field === 'salary' ? (
                                  <CurrencyInput autoFocus value={Number(editValue)} onChange={(v:any) => setEditValue(String(v))} onEnter={() => saveInlineEdit(staff.id, 'salary')} className="saas-input" style={{ textAlign: 'right' }} />
                                ) : formatRiel(monthlySalary)}
                              </td>
                              <td className="saas-td" style={{ color: '#10b981', textAlign: 'right', fontWeight: 'bold' }}>{formatRiel(totalEarned)}</td>
                              
                              {/* Combined Debt Display */}
                              <td className="saas-td" style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                                  <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{formatRiel(totalDebtRiel)}</span>
                                  {totalDebtUsd > 0 && <span style={{ color: '#ef4444', fontSize: '12px' }}>{formatUSD(totalDebtUsd)}</span>}
                                </div>
                              </td>

                              {/* 🟢 NEW: Compact Leave Balance Badge */}
                              <td className="saas-td" style={{ textAlign: 'center' }}>
                                <div 
                                  onClick={() => setLeaveModal({ isOpen: true, staff: staff, quota: leaveQuota, days: 1, reason: '' })}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '4px 10px',
                                    borderRadius: '20px',
                                    backgroundColor: leaveRemaining <= 2 ? '#fef2f2' : '#eff6ff',
                                    color: leaveRemaining <= 2 ? '#dc2626' : '#2563eb',
                                    fontWeight: 'bold',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    border: `1px solid ${leaveRemaining <= 2 ? '#fecaca' : '#bfdbfe'}`
                                  }}
                                >
                                  <span>🏖️ {leaveRemaining} / {leaveQuota} Days</span>
                                </div>
                              </td>

                              <td className="saas-td" style={{ color: isNegativePayout ? '#ef4444' : '#3b82f6', textAlign: 'right', fontWeight: 'bold', fontSize: '15px' }}>
                                {isNegativePayout ? '-' : ''}{formatRiel(Math.abs(netPayout))}
                              </td>
                              
                              {/* 🟢 NEW: Compact Action Buttons */}
                              <td className="saas-td" style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                  <button 
                                    onClick={() => setAdvanceModal({ isOpen: true, staff: staff, amount: '', method: 'Cash ៛' })}
                                    className="saas-btn" 
                                    style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde047', padding: '4px 8px', fontSize: '11px', fontWeight: 'bold' }}
                                  >
                                    ➕ Advance
                                  </button>

                                  <button 
                                    onClick={() => setLeaveModal({ isOpen: true, staff: staff, quota: leaveQuota, days: 1, reason: '' })}
                                    className="saas-btn" 
                                    style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', padding: '4px 8px', fontSize: '11px', fontWeight: 'bold' }}
                                  >
                                    🏖️ Leave
                                  </button>

                                  {(totalDebtRiel > 0 || totalDebtUsd > 0) && (
                                    <button 
                                      onClick={() => {
                                        // 🔥 AUTO-FILL LOGIC: Detects which currency they owe and defaults the exact amount and method
                                        const defaultMethod = totalDebtRiel > 0 ? 'Cash ៛' : 'Cash $';
                                        const defaultAmount = totalDebtRiel > 0 ? totalDebtRiel : totalDebtUsd;
                                        setSettleModal({ isOpen: true, staff: staff, amount: defaultAmount, method: defaultMethod });
                                      }} 
                                      className="saas-btn" 
                                      style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '4px 8px', fontSize: '11px', fontWeight: 'bold' }}
                                    >
                                      ✅ Settle
                                    </button>
                                  )}

                                  <button 
                                    onClick={() => handleViewHistory(staff)} 
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }} 
                                    title="View Audit History"
                                  >
                                    🕒
                                  </button>

                                  <button 
                                    onClick={() => handleDeleteStaff(staff.id, staff.name)} 
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }} 
                                    title="Delete Staff"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* --- EXPENSE DATABASE UI --- */}
          {activeTab === 'database' && (
            <div>
              <div className="saas-tab-container hide-scrollbar" style={{ border: 'none', padding: '4px', background: '#f1f5f9', margin: '0 0 24px 0', flexWrap: 'nowrap', overflowX: 'auto', borderRadius: '12px' }}>
                {dbTabOrder.map(tab => {
                  // 🔥 FIX 5: Added 'rice' text to the label dictionary!
                  const labels: any = { personal: '🏡 Personal Expenses', business: '🏢 Business Expenses', rice: '🌾 Rice Purchases', staff_debt: '💸 Staff Debt Log', insight: '📊 Expense Insight' };
                  return (
                    <button
                      key={tab} draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/dbtab', tab); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault(); const sourceTab = e.dataTransfer.getData('text/dbtab');
                        if (!sourceTab || sourceTab === tab) return;
                        setDbTabOrder(prev => { const newOrder = prev.filter(t => t !== sourceTab); newOrder.splice(newOrder.indexOf(tab), 0, sourceTab); return newOrder; });
                      }}
                      onClick={() => setDbTab(tab as any)}
                      className={`saas-tab ${dbTab === tab ? 'active' : ''}`}
                      style={dbTab === tab && tab === 'insight' ? { cursor: 'grab', background: '#3b82f6', color: '#fff', padding: '10px 20px' } : { cursor: 'grab', padding: '10px 20px' }}
                    >
                      {labels[tab]}
                    </button>
                  )
                })}
              </div>

              {dbTab === 'insight' ? (
                // --- INSIGHTS VIEW ---
                <div className="fade-in">
                  
                  {/* Filters */}
                  <div className="saas-tab-container hide-scrollbar" style={{ margin: '0 0 24px 0', padding: '4px', background: '#f1f5f9', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', border: 'none' }}>
                    {['today', 'week', 'month', 'custom'].map(f => (
                      <button 
                        key={f} onClick={() => setInsightFilter(f as any)} 
                        className={`saas-tab ${insightFilter === f ? 'active' : ''}`} 
                        style={insightFilter === f ? { background: '#0f172a', color: '#fff', padding: '8px 16px' } : { padding: '8px 16px' }}
                      >
                        {f === 'custom' ? 'Custom Range' : f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : 'Today'}
                      </button>
                    ))}
                  </div>

                  {/* Custom Date Filters */}
                  {insightFilter === 'custom' && (
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center', flexWrap: 'nowrap', width: '100%' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <label style={{ fontWeight: 'bold', fontSize: '12px', color: '#64748b' }}>From:</label>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <CustomDatePicker value={insightFrom} onChange={setInsightFrom} />
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <label style={{ fontWeight: 'bold', fontSize: '12px', color: '#64748b' }}>To:</label>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <CustomDatePicker value={insightTo} onChange={setInsightTo} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Core Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                    
                    <div className="saas-card">
                      <div className="saas-card-title">📉 Total Expenses</div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#ef4444', fontWeight: 'bold' }}>{formatRiel(insightsData?.totalExpRiel || 0)}</div>
                        </div>
                        <div style={{ width: '1px', background: '#e2e8f0' }}></div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#ef4444', fontWeight: 'bold' }}>{formatUSD(insightsData?.totalExpUsd || 0)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="saas-card">
                      <div className="saas-card-title">🏢 Business Operation</div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#b91c1c', fontWeight: 'bold' }}>{formatRiel(insightsData?.totalBizRiel || 0)}</div>
                        </div>
                        <div style={{ width: '1px', background: '#e2e8f0' }}></div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#b91c1c', fontWeight: 'bold' }}>{formatUSD(insightsData?.totalBizUsd || 0)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="saas-card" style={{ border: '1px solid #bfdbfe' }}>
                      <div className="saas-card-title" style={{ color: '#2563eb' }}>🌾 Rice Stock</div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#3b82f6', fontWeight: 'bold' }}>{formatRiel(insightsData?.totalRiceRiel || 0)}</div>
                        </div>
                        <div style={{ width: '1px', background: '#e2e8f0' }}></div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#3b82f6', fontWeight: 'bold' }}>{formatUSD(insightsData?.totalRiceUsd || 0)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="saas-card">
                      <div className="saas-card-title">🏡 Personal</div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#f59e0b', fontWeight: 'bold' }}>{formatRiel(insightsData?.totalPersRiel || 0)}</div>
                        </div>
                        <div style={{ width: '1px', background: '#e2e8f0' }}></div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#f59e0b', fontWeight: 'bold' }}>{formatUSD(insightsData?.totalPersUsd || 0)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="saas-card">
                      <div className="saas-card-title" style={{ color: '#64748b' }}>ℹ️ Total Staff Debt Logged</div>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#64748b', fontWeight: 'bold' }}>{formatRiel(insightsData?.totalDebtRiel || 0)}</div>
                        </div>
                        <div style={{ width: '1px', background: '#e2e8f0' }}></div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '20px', color: '#64748b', fontWeight: 'bold' }}>{formatUSD(insightsData?.totalDebtUsd || 0)}</div>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Top 5 Lists */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                    <div className="saas-card">
                      <h3 className="saas-card-title">🏆 Top 5 Personal Expenses</h3>
                      {insightsData?.topPers.length === 0 ? <div style={{ fontSize: '13px', color: '#94a3b8' }}>No data available.</div> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {insightsData?.topPers.map((item: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                              <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{idx + 1}. {item.remarks}</div>
                              <div style={{ fontSize: '14px', fontWeight: 'bold', textAlign: 'right' }}>
                                {Number(item.amount_riel) > 0 && <div style={{ color: '#f59e0b' }}>{formatRiel(Number(item.amount_riel))}</div>}
                                {Number(item.amount_usd) > 0 && <div style={{ color: '#f59e0b' }}>{formatUSD(Number(item.amount_usd))}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="saas-card">
                      <h3 className="saas-card-title">🏆 Top 5 Business Expenses</h3>
                      {insightsData?.topBiz.length === 0 ? <div style={{ fontSize: '13px', color: '#94a3b8' }}>No data available.</div> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {insightsData?.topBiz.map((item: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                              <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{idx + 1}. {item.remarks}</div>
                              <div style={{ fontSize: '14px', fontWeight: 'bold', textAlign: 'right' }}>
                                {Number(item.amount_riel) > 0 && <div style={{ color: '#b91c1c' }}>{formatRiel(Number(item.amount_riel))}</div>}
                                {Number(item.amount_usd) > 0 && <div style={{ color: '#b91c1c' }}>{formatUSD(Number(item.amount_usd))}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chart */}
                  <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📉 EXPENSE TREND (Day 1 - 31)</h2>
                  <div style={{ marginBottom: '40px' }}>
                    <LineChartCard title="Total Expenses: This Month vs Last Month" dataCurrent={insightsData?.thisMonthData || []} dataLast={insightsData?.lastMonthData || []} color="#ef4444" />
                  </div>

                </div>
              ) : (
                // --- REGULAR DATABASE TABLE VIEW ---
                <div className="saas-table-wrapper" style={{ marginBottom: '32px' }}>
                  <div className="saas-table-responsive">
                    <table className="saas-table">
                      <thead>
                        <tr>
                          {[
                            { key: dbTab === 'staff_debt' ? 'created_at' : 'expense_date', label: 'Date', align: 'left' },
                            { key: dbTab === 'staff_debt' ? 'staff_name' : 'remarks', label: dbTab === 'staff_debt' ? 'Staff Name' : 'Description', align: 'left' },
                            ...(dbTab !== 'staff_debt' ? [{ key: 'spender', label: 'Spender', align: 'left' }] : []), // 🔥 Left aligned
                            { key: 'payment_method', label: 'Payment Method', align: 'left' },
                            { key: dbTab === 'staff_debt' ? 'amount' : 'amount_riel', label: 'Amount (៛)', align: 'right' },
                            ...(dbTab !== 'staff_debt' ? [{ key: 'amount_usd', label: 'Amount ($)', align: 'right' }] : []),
                            ...(dbTab !== 'staff_debt' ? [{ key: 'actions', label: '', align: 'center' }] : []) // 🗑️ Delete Header
                          ].map((col: any) => (
                            <th 
                              key={col.key} className="saas-th"
                              onClick={() => {
                                let direction: 'asc' | 'desc' = 'desc';
                                if (dbSortConfig && dbSortConfig.key === col.key && dbSortConfig.direction === 'desc') direction = 'asc';
                                setDbSortConfig({ key: col.key, direction });
                              }}
                              style={{ textAlign: col.align as any, cursor: 'pointer', userSelect: 'none' }}
                            >
                              {col.label}
                              <span style={{ marginLeft: '6px', fontSize: '12px', opacity: dbSortConfig?.key === col.key ? 1 : 0.3 }}>
                                {dbSortConfig?.key === col.key ? (dbSortConfig?.direction === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {isFetchingDb ? (
                          <TableSkeleton columns={dbTab === 'staff_debt' ? 4 : 7} rows={6} />
                        ) : filteredAndSortedDb.length === 0 ? (
                          <tr>
                            <td colSpan={dbTab === 'staff_debt' ? 4 : 7} style={{ padding: 0 }}>
                              <EmptyState icon="📭" title="No Records" message="No data found in this category." />
                            </td>
                          </tr>
                        ) : (
                          filteredAndSortedDb.map((row: any) => (
                            <tr key={row.id} className="saas-tr">
                              {/* 🔥 verticalAlign: 'middle' added to EVERY <td> */}
                              <td className="saas-td" style={{ fontSize: '14px', color: '#334155', verticalAlign: 'middle', textAlign: 'left' }}>
                                {new Date(dbTab === 'staff_debt' ? row.created_at : row.expense_date).toLocaleDateString('en-GB')}
                              </td>
                              <td className="saas-td" style={{ fontSize: '14px', fontWeight: 'bold', color: '#0f172a', verticalAlign: 'middle', textAlign: 'left' }}>
                                {dbTab === 'staff_debt' ? row.staff?.name : row.remarks}
                              </td>
                              {dbTab !== 'staff_debt' && (
                                <td className="saas-td" style={{ fontSize: '14px', color: '#64748b', verticalAlign: 'middle', textAlign: 'left' }}>
                                  {row.spender}
                                </td>
                              )}
                              <td className="saas-td" style={{ fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', verticalAlign: 'middle', textAlign: 'left' }}>
                                {row.payment_method}
                              </td>
                              <td className="saas-td" style={{ fontSize: '14px', textAlign: 'right', fontWeight: 'bold', color: '#ef4444', verticalAlign: 'middle' }}>
                                {dbTab === 'staff_debt' ? 
                                  (row.payment_method.includes('$') ? '-' : formatRiel(row.amount)) : 
                                  formatRiel(row.amount_riel)}
                              </td>
                              {dbTab !== 'staff_debt' && (
                                <>
                                  <td className="saas-td" style={{ fontSize: '14px', textAlign: 'right', fontWeight: 'bold', color: '#ef4444', verticalAlign: 'middle' }}>
                                    {formatUSD(row.amount_usd)}
                                  </td>
                                  <td className="saas-td" style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                                    <button 
                                      onClick={() => handleDeleteDbRecord(row.id)} 
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }}
                                      title="Delete Expense"
                                    >
                                      🗑️
                                    </button>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* --- 🟢 NEW: ADVANCE MODAL --- */}
      <Modal isOpen={advanceModal.isOpen} onClose={() => setAdvanceModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' })} title={`Add Advance: ${advanceModal.staff?.name}`} icon="➕" maxWidth="400px">
        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Advance Amount</label>
          <CurrencyInput autoFocus value={advanceModal.amount} onChange={(v:any) => setAdvanceModal({...advanceModal, amount: v})} className="saas-input" placeholder="0" />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Payment Method</label>
          <select value={advanceModal.method} onChange={e => setAdvanceModal({...advanceModal, method: e.target.value})} className="saas-input" style={{ cursor: 'pointer' }}>
            <option value="Cash ៛">💵 Cash ៛</option>
            <option value="Cash $">💵 Cash $</option>
            <option value="QR ៛">📱 QR ៛</option>
            <option value="QR $">📱 QR $</option>
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setAdvanceModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' })} disabled={loading} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleAdvanceSubmit} disabled={loading} className="saas-btn saas-btn-primary">{loading ? 'Processing...' : 'Confirm Advance'}</button>
        </div>
      </Modal>

      {/* --- 🟢 NEW: LEAVE MANAGEMENT MODAL (0.5, 1 Day, or Custom) --- */}
      <Modal isOpen={leaveModal.isOpen} onClose={() => setLeaveModal({ isOpen: false, staff: null, quota: '', days: 1, reason: '' })} title={`Log Leave: ${leaveModal.staff?.name}`} icon="🏖️" maxWidth="420px">
        <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569', marginBottom: '6px' }}>
            <span>Annual Quota:</span>
            <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{leaveModal.quota || 12} Days</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
            <span>Remaining After Request:</span>
            <span style={{ fontWeight: 'bold', color: ((Number(leaveModal.quota) || 12) - Number(leaveModal.staff?.leave_used || 0) - (Number(leaveModal.days) || 0)) < 0 ? '#ef4444' : '#2563eb' }}>
              {((Number(leaveModal.quota) || 12) - Number(leaveModal.staff?.leave_used || 0) - (Number(leaveModal.days) || 0))} Days
            </span>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Total Annual Quota (Days)</label>
          <input 
            type="number" 
            value={leaveModal.quota} 
            onChange={(e) => setLeaveModal({ ...leaveModal, quota: e.target.value === '' ? '' : Number(e.target.value) })} 
            className="saas-input" 
            placeholder="12" 
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Leave Days to Take</label>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            {[0.5, 1, 2].map((num) => (
              <button
                type="button"
                key={num}
                onClick={() => setLeaveModal({ ...leaveModal, days: num })}
                className="saas-btn"
                style={leaveModal.days === num ? { background: '#2563eb', color: '#fff', flex: 1, padding: '8px' } : { background: '#f1f5f9', color: '#334155', flex: 1, padding: '8px', border: 'none' }}
              >
                {num === 0.5 ? '0.5 (Half Day)' : `${num} Day${num > 1 ? 's' : ''}`}
              </button>
            ))}
          </div>
          <input 
            type="number" 
            step="0.5"
            value={leaveModal.days} 
            onChange={(e) => setLeaveModal({ ...leaveModal, days: e.target.value === '' ? '' : Number(e.target.value) })} 
            className="saas-input" 
            placeholder="1.0" 
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Reason / Note</label>
          <input 
            type="text" 
            value={leaveModal.reason} 
            onChange={(e) => setLeaveModal({ ...leaveModal, reason: e.target.value })} 
            className="saas-input" 
            placeholder="e.g., Sick leave, Family event" 
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setLeaveModal({ isOpen: false, staff: null, quota: '', days: 1, reason: '' })} disabled={loading} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleLeaveSubmit} disabled={loading} className="saas-btn saas-btn-primary">{loading ? 'Processing...' : 'Confirm Leave'}</button>
        </div>
      </Modal>

      {/* --- 🟢 NEW: UNIFIED HISTORY MODAL (Debt & Leave Tabs) --- */}
      <Modal 
        isOpen={historyModal.isOpen} 
        onClose={() => setHistoryModal({ isOpen: false, staff: null, activeTab: 'debt', debtHistory: [], leaveHistory: [] })} 
        title={`History: ${historyModal.staff?.name}`} 
        icon="🕒" 
        maxWidth="500px"
      >
        <div className="saas-tab-container" style={{ margin: '0 0 16px 0', padding: '4px', background: '#f1f5f9', display: 'flex', border: 'none', borderRadius: '8px' }}>
          <button 
            onClick={() => setHistoryModal({ ...historyModal, activeTab: 'debt' })}
            className={`saas-tab ${historyModal.activeTab === 'debt' ? 'active' : ''}`}
            style={historyModal.activeTab === 'debt' ? { background: '#0f172a', color: '#fff', flex: 1, padding: '6px' } : { flex: 1, padding: '6px' }}
          >
            💸 Debt History
          </button>
          <button 
            onClick={() => setHistoryModal({ ...historyModal, activeTab: 'leave' })}
            className={`saas-tab ${historyModal.activeTab === 'leave' ? 'active' : ''}`}
            style={historyModal.activeTab === 'leave' ? { background: '#0f172a', color: '#fff', flex: 1, padding: '6px' } : { flex: 1, padding: '6px' }}
          >
            🏖️ Leave Audit
          </button>
        </div>

        {historyModal.activeTab === 'debt' ? (
          historyModal.debtHistory.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '14px', padding: '20px' }}>No debt history found.</p>
          ) : (
            <table className="saas-table" style={{ minWidth: '100%', marginBottom: '20px' }}>
              <thead>
                <tr>
                  <th className="saas-th" style={{ padding: '8px', fontSize: '11px' }}>Date</th>
                  <th className="saas-th" style={{ padding: '8px', fontSize: '11px' }}>Action Type</th>
                  <th className="saas-th" style={{ padding: '8px', fontSize: '11px', textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {historyModal.debtHistory.map((record) => (
                  <tr key={record.id} className="saas-tr">
                    <td className="saas-td" style={{ padding: '10px 8px', fontSize: '13px' }}>{new Date(record.created_at).toLocaleDateString()}</td>
                    <td className="saas-td" style={{ padding: '10px 8px', fontSize: '13px' }}>{record.payment_method}</td>
                    <td className="saas-td" style={{ padding: '10px 8px', fontSize: '13px', textAlign: 'right', color: '#ef4444', fontWeight: 'bold' }}>
                      {record.payment_method.includes('$') ? formatUSD(record.amount) : formatRiel(record.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          historyModal.leaveHistory.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '14px', padding: '20px' }}>No leave history logged yet.</p>
          ) : (
            <table className="saas-table" style={{ minWidth: '100%', marginBottom: '20px' }}>
              <thead>
                <tr>
                  <th className="saas-th" style={{ padding: '8px', fontSize: '11px' }}>Date</th>
                  <th className="saas-th" style={{ padding: '8px', fontSize: '11px' }}>Reason</th>
                  <th className="saas-th" style={{ padding: '8px', fontSize: '11px', textAlign: 'right' }}>Days</th>
                </tr>
              </thead>
              <tbody>
                {historyModal.leaveHistory.map((record) => (
                  <tr key={record.id} className="saas-tr">
                    <td className="saas-td" style={{ padding: '10px 8px', fontSize: '13px' }}>{new Date(record.created_at).toLocaleDateString()}</td>
                    <td className="saas-td" style={{ padding: '10px 8px', fontSize: '13px', color: '#475569' }}>{record.reason || 'Leave'}</td>
                    <td className="saas-td" style={{ padding: '10px 8px', fontSize: '13px', textAlign: 'right', color: '#2563eb', fontWeight: 'bold' }}>
                      -{record.days} Days
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setHistoryModal({ isOpen: false, staff: null, activeTab: 'debt', debtHistory: [], leaveHistory: [] })} className="saas-btn saas-btn-secondary">Close</button>
        </div>
      </Modal>

      {/* STAFF SETTLEMENT MODAL */}
      <Modal isOpen={settleModal.isOpen} onClose={() => setSettleModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' })} title={`Settle Debt: ${settleModal.staff?.name}`} icon="✅" maxWidth="400px">
        <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '8px' }}>Current Debt (៛): <b style={{ color: '#ef4444', fontSize: '16px' }}>{formatRiel(settleModal.staff?.total_debt_riel || 0)}</b></div>
        <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>Current Debt ($): <b style={{ color: '#ef4444', fontSize: '16px' }}>{formatUSD(settleModal.staff?.total_debt_usd || 0)}</b></div>

        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Settlement Amount</label>
          <CurrencyInput autoFocus value={settleModal.amount} onChange={(v:any) => setSettleModal({...settleModal, amount: v})} className="saas-input" />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Payment Received Into</label>
          <select value={settleModal.method} onChange={e => setSettleModal({...settleModal, method: e.target.value})} className="saas-input" style={{ cursor: 'pointer' }}>
            <option value="Cash ៛">💵 Cash ៛</option>
            <option value="Cash $">💵 Cash $</option>
            <option value="QR ៛">📱 QR ៛</option>
            <option value="QR $">📱 QR $</option>
            <option value="Write-off">❌ Bad Debt (Runaway / Write-off)</option>
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setSettleModal({ isOpen: false, staff: null, amount: '', method: 'Cash ៛' })} disabled={loading} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleSettleSubmit} disabled={loading} className="saas-btn saas-btn-primary">{loading ? 'Processing...' : 'Confirm Settlement'}</button>
        </div>
      </Modal>

      {/* EXPENSE CONFIRMATION MODAL */}
      <Modal isOpen={confirmModal} onClose={() => setConfirmModal(false)} title="Confirm Expenses" icon="✅" maxWidth="400px">
        <div style={{ fontSize: '15px', color: '#475569', marginBottom: '24px', lineHeight: '1.5' }}>
          Are you sure you want to log <b>{getActiveList().length} expense(s)</b> for <b>{new Date(expenseDate).toLocaleDateString('en-GB')}</b>?
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setConfirmModal(false)} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={() => handleSubmit()} className="saas-btn saas-btn-primary">Yes, Log Expenses</button>
        </div>
      </Modal>

      {/* --- GLOBAL CSS --- */}
      <style jsx global>{`
        input, select, button, textarea {
          font-family: inherit;
          font-variant-numeric: tabular-nums lining-nums;
        }

        body {
          font-variant-numeric: tabular-nums lining-nums;
        }

        .section-divider { font-size: 15px; color: #475569; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
        .fade-in { animation: fadeIn 0.3s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

        /* ALIGNMENT CONTAINERS */
        .hide-on-mobile { display: inline; }
        .show-on-mobile { display: none; }
        .desktop-only-flex { display: flex; }
        .mobile-only-flex { display: none; }

        /* 🔥 FIX: BULLETPROOF SCROLLBAR HIDING FOR WEBKIT BROWSERS (iOS/Safari/Chrome) */
        .hide-scrollbar::-webkit-scrollbar { display: none !important; }
        .hide-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }

        /* 🔥 FIX: BULLETPROOF SCROLLBAR HIDING FOR WEBKIT BROWSERS (iOS/Safari/Chrome) */
        .hide-scrollbar::-webkit-scrollbar { display: none !important; }
        .hide-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }

        .content-container {
          width: 100%;
          max-width: 1600px;
          margin: 0 auto;
          padding-left: 0px; 
          padding-right: 0px; 
          box-sizing: border-box;
        }
        
        .header-container { 
          display: flex;
          justify-content: flex-start;
          align-items: center; 
          margin-bottom: 20px !important; /* 🔥 FIX: Locked to 20px for perfect symmetry with tabs */
          margin-top: 0; 
          margin-left: 60px; 
          gap: 12px;
          height: 42px; 
          width: calc(100% - 60px);
          max-width: 1600px;
        }

        .header-left {
          display: flex;
          align-items: center; 
          height: 100%;
          gap: 12px;
        }

        input[type="text"].no-spinners::-webkit-inner-spin-button,
        input[type="text"].no-spinners::-webkit-outer-spin-button {
          -webkit-appearance: none; margin: 0;
        }

        /* DESKTOP LAYOUT FOR TOP ACTION ROW */
        .top-action-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
        }
        .top-action-row .date-wrapper {
          flex: 1;
          max-width: 220px;
        }
        .top-action-row .button-wrapper {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        /* RESPONSIVE EXPENSE GRID FOR DESKTOP */
        .expense-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }

        @media (min-width: 1024px) {
          .expense-grid {
             grid-template-columns: 1.5fr 1.2fr 1.5fr; 
             gap: 24px;
             align-items: flex-end; 
          }
        }

        /* MOBILE CSS OVERRIDES */
        @media (max-width: 1023px) { 
          .hide-on-mobile { display: none !important; }
          .show-on-mobile { display: inline !important; }
          .desktop-only-flex { display: none !important; }
          .mobile-only-flex { display: flex !important; }

          .top-action-row {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 16px !important;
            width: 100% !important;
          }
          .top-action-row .date-wrapper {
            width: 100% !important;
            max-width: none !important;
          }
          .top-action-row .button-wrapper {
            width: 100% !important;
            display: flex !important;
            flex-direction: row !important;
            gap: 12px !important;
            justify-content: space-between !important;
          }
          .top-action-row .button-wrapper button {
            flex: 1 !important; 
            padding: 0 !important;
            text-align: center !important;
            justify-content: center !important;
            display: flex !important;
            align-items: center !important;
          }

          .content-container {
            padding-left: 0px !important;
            padding-right: 0px !important;
          }

          .header-container { 
            margin-left: 54px !important; 
            margin-right: 0 !important;
            margin-bottom: 20px !important; /* 🔥 FIX: Locked to 20px for perfect symmetry with tabs */
            margin-top: 0 !important; 
            display: flex !important;
            flex-direction: row !important;
            justify-content: flex-start !important;
            align-items: center !important; 
            height: 44px !important;
            width: calc(100% - 54px) !important;
          }
        }
      `}</style>
    </div>
  )
}

function LineChartCard({ title, dataCurrent, dataLast, color }: any) {
  const maxVal = Math.max(...dataCurrent, ...dataLast, 1) 
  const formatPoints = (arr: any[]) => {
    return arr.map((val: any, idx: number) => {
      const x = (idx / 30) * 1000; const y = 200 - ((val / maxVal) * 200); return `${x},${y}`;
    }).join(' ');
  }
  const currentPoints = formatPoints(dataCurrent); const lastPoints = formatPoints(dataLast);
  return (
    <div className="saas-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: '#475569', fontWeight: 'bold' }}>{title}</h3>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', fontWeight: 'bold' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '14px', height: '4px', background: color, borderRadius: '2px' }}></div> <span style={{ color: '#334155' }}>This Mth</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '14px', height: '4px', borderBottom: '2px dashed #cbd5e1' }}></div> <span style={{ color: '#94a3b8' }}>Last Mth</span>
          </div>
        </div>
      </div>
      <div style={{ width: '100%', height: '220px', position: 'relative' }}>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          <line x1="0" y1="50" x2="1000" y2="50" stroke="#f1f5f9" strokeWidth="1" />
          <line x1="0" y1="100" x2="1000" y2="100" stroke="#f1f5f9" strokeWidth="1" />
          <line x1="0" y1="150" x2="1000" y2="150" stroke="#f1f5f9" strokeWidth="1" />
          <line x1="0" y1="200" x2="1000" y2="200" stroke="#e2e8f0" strokeWidth="2" />
          <polyline points={lastPoints} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="5,5" />
          <polyline points={currentPoints} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {dataCurrent.map((val: any, idx: number) => {
            const x = (idx / 30) * 1000; const y = 200 - ((val / maxVal) * 200);
            return val > 0 ? <circle key={idx} cx={x} cy={y} r="4" fill="#ffffff" stroke={color} strokeWidth="2" /> : null;
          })}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', color: '#94a3b8', fontSize: '11px', fontWeight: 'bold' }}>
          <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span><span>25</span><span>31</span>
        </div>
      </div>
    </div>
  )
}
