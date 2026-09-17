'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useFocusRefresh } from '@/lib/useFocusRefresh'
import { formatRiel, formatUSD, formatNumber, EXCHANGE_RATE } from '@/utils/formatters'
import { CurrencyInput } from '@/components/Inputs'
import { useToast } from '@/components/ToastProvider'
import { useDebounce } from '@/lib/useDebounce'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext' // 🔥 GLOBAL MEMORY IMPORTED
import AdminGuard from '@/components/AdminGuard' // 🔒 NEW: IMPORT THE BOUNCER
import Modal from '@/components/Modal'
import { exportBizDataToExcel } from '@/utils/exportHelpers';

// Formats headers beautifully
const formatHeader = (key: string) => {
  if (key === 'qty') return 'Quantity';
  if (key === 'cogs_price') return 'COGS Price';
  if (key === 'invoice_id') return 'Invoice ID';
  if (key === 'transaction_id') return 'Transaction ID';
  if (key === 'amount_riel') return 'Amount (៛)';
  if (key === 'amount_usd') return 'Amount ($)';
  return key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Helper to convert ISO dates to the local format needed by <input type="datetime-local">
const toLocalDatetimeString = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- UNIFIED TRANSACTION TYPE ---
type TabType = 'Wholesale Invoice Summary' | 'Walk-in Wholesale' | 'Non-Walk-in Wholesale' | 'Retails only' | 'Biz Expense' | 'Personal Expense' | 'Staff Debt';

interface UnifiedTransaction {
  [key: string]: any; 
  id: string;
  raw_db_id: string | number;
  product_id?: number | string; 
  invoice_id?: string;
  source: TabType;
  created_at: string;
}

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
} | null;

type TimeFilter = 'Today' | 'This Week' | 'This Month' | 'All Time';

// Standardized initial widths for all possible columns
const DEFAULT_WIDTHS: Record<string, number> = {
  invoice_id: 140, transaction_id: 140, created_at: 180, customer_name: 160, owner: 100,
  rice_types: 250, rice_type: 180, qty: 100, price_per_bag: 130, cogs_price: 130,
  total_sales: 140, total_cogs: 140, total_profit: 140, description: 200, 
  amount_riel: 140, amount_usd: 140, category: 140, status: 120
}

const DEFAULT_SUMMARY_COLS = ['invoice_id', 'created_at', 'customer_name', 'owner', 'rice_types', 'total_sales', 'total_cogs', 'total_profit'];
const DEFAULT_DAILY_COLS = ['invoice_id', 'created_at', 'customer_name', 'owner', 'rice_type', 'qty', 'price_per_bag', 'cogs_price', 'total_sales', 'total_cogs', 'total_profit'];
const DEFAULT_RETAIL_COLS = ['transaction_id', 'created_at', 'rice_type', 'qty', 'price_per_bag', 'cogs_price', 'total_sales', 'total_cogs', 'total_profit'];
const DEFAULT_EXPENSE_COLS = ['created_at', 'description', 'amount_riel', 'amount_usd', 'category', 'status', 'owner'];

export default function BizDatabase() {
  const { showToast } = useToast();
  const { activeBranchId } = useBranch(); // 🔥 TUNED INTO RADIO TOWER

  // --- CORE STATE ---
  const [transactions, setTransactions] = useState<UnifiedTransaction[]>([])
  const [activeTab, setActiveTab] = useState<TabType>('Wholesale Invoice Summary')
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('Today')
  const [isLoading, setIsLoading] = useState(true)
  // --- EXPORT STATE ---
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // --- SELECTION STATE ---
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set())
  
  // --- PREFERENCES ---
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const [summaryCols, setSummaryCols] = useState<string[]>(DEFAULT_SUMMARY_COLS)
  const [dailyCols, setDailyCols] = useState<string[]>(DEFAULT_DAILY_COLS)
  const [retailCols, setRetailCols] = useState<string[]>(DEFAULT_RETAIL_COLS)
  const [expenseCols, setExpenseCols] = useState<string[]>(DEFAULT_EXPENSE_COLS)
  
  const widthsRef = useRef(columnWidths)
  widthsRef.current = columnWidths

  // --- SORT STATE ---
  const [sortConfig, setSortConfig] = useState<SortConfig>(null)

  // Dynamic active columns based on tab
  const activeColumns = activeTab === 'Wholesale Invoice Summary' ? summaryCols 
                      : (activeTab === 'Walk-in Wholesale' || activeTab === 'Non-Walk-in Wholesale') ? dailyCols 
                      : activeTab === 'Retails only' ? retailCols 
                      : expenseCols;

  // --- LIFECYCLE ---
  useEffect(() => { 
    fetchSettings()
  }, [activeBranchId])

  // 🔥 CLOSURE FIX: Wrap fetchData in useCallback so it always knows the exact activeBranchId
  // even when called from an external window focus event!
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true)
    
    let queryStart = null;
    const now = new Date();
    if (timeFilter === 'Today') {
      queryStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (timeFilter === 'This Week') {
      const dayOfWeek = now.getDay(); 
      const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      queryStart = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0).toISOString();
    } else if (timeFilter === 'This Month') {
      queryStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
    }

    // 🔥 INFINITE FETCH FIX: Only download records that match our actual time filter!
    const fetchTable = async (table: string) => {
      let q = supabase.from(table).select('*').eq('branch_id', activeBranchId);
      if (queryStart) q = q.gte('created_at', queryStart);
      const { data, error } = await q;
      if (error) console.warn(`${table} fetch error`, error);
      return data || [];
    }

    const [summaryData, dailyData, retailData, allExpenses] = await Promise.all([
      fetchTable('invoice_summaries'),
      fetchTable('sales'),
      fetchTable('retail_sales'),
      fetchTable('expenses')
    ]);

    const unified: UnifiedTransaction[] = []
    const invoiceDict: Record<string, any> = {};

    if (summaryData) {
      summaryData.forEach(s => {
        if (s.invoice_id) invoiceDict[s.invoice_id] = s;
        
        // 🔥 FIX: Hide Voided Summaries (using delivery_status based on your schema)
        if (s.delivery_status === 'Voided') return;

        const custName = s.customer_name || 'Walk-in';
        const isWalkIn = ['walk-in', 'walk in'].includes(custName.trim().toLowerCase());

        if (isWalkIn) return;

        unified.push({
          id: `sum_${s.id}`,
          raw_db_id: s.id, 
          source: 'Wholesale Invoice Summary',
          created_at: s.created_at,
          invoice_id: s.invoice_id,
          customer_name: custName,
          owner: s.owner || '-',
          rice_types: s.rice_types,
          total_sales: Number(s.total_sales || 0),
          total_cogs: Number(s.total_cogs || 0),
          total_profit: Number(s.total_profit || 0)
        })
      })
    }

    if (dailyData) {
      dailyData.forEach(d => {
        const parentInvoice = invoiceDict[d.invoice_id] || {};
        
        // 🔥 FIX: Hide Voided Wholesale Sales AND check parent invoice
        if (d.is_voided === true || parentInvoice.delivery_status === 'Voided') return;

        const qty = Number(d.qty || 0);
        const price = Number(d.price_per_bag || 0);
        const cogs = Number(d.cogs_price || 0);
        
        const custName = d.customer_name || parentInvoice.customer_name || 'Walk-in';
        const ownerName = d.owner || parentInvoice.owner || '-';

        const isWalkIn = !custName || custName.trim().toLowerCase() === 'walk-in';

        unified.push({
          id: `daily_${d.id}`,
          raw_db_id: d.id,
          product_id: d.product_id,
          invoice_id: d.invoice_id,
          source: isWalkIn ? 'Walk-in Wholesale' : 'Non-Walk-in Wholesale',
          created_at: d.created_at,
          customer_name: custName,
          owner: ownerName,
          rice_type: d.custom_rice_type || d.rice_type,
          qty: qty,
          price_per_bag: price,
          cogs_price: cogs,
          total_sales: qty * price,
          total_cogs: qty * cogs,
          total_profit: (price - cogs) * qty
        })
      })
    }

    if (retailData) {
      retailData.forEach(r => {
        // 🔥 FIX: Hide Voided Retail Sales
        if (r.is_voided === true) return;

        const qty = Number(r.qty || 0);
        const price = Number(r.price_per_bag || 0);
        const cogs = Number(r.cogs_price || 0);

        unified.push({
          id: `ret_${r.id}`,
          raw_db_id: r.id, 
          product_id: r.product_id,
          source: 'Retails only',
          created_at: r.created_at,
          transaction_id: r.transaction_id,
          rice_type: r.custom_rice_type || r.rice_type,
          qty: qty,
          price_per_bag: price,
          cogs_price: cogs,
          total_sales: qty * price,
          total_cogs: qty * cogs,
          total_profit: (price - cogs) * qty
        })
      })
    }

    // 🔥 SORTING THE "ONE TABLE" INTO 3 SEPARATE TABS & SEPARATING RIEL VS USD
    if (allExpenses && allExpenses.length > 0) {
      allExpenses.forEach(e => {
        let targetSource: TabType = 'Biz Expense';
        if (e.description === 'PERSONAL') targetSource = 'Personal Expense';
        else if (e.description === 'STAFF_DEBT') targetSource = 'Staff Debt';
        else targetSource = 'Biz Expense';

        unified.push({
          id: `exp_${e.id}`, // Unified prefix for expenses
          raw_db_id: e.id, 
          source: targetSource,
          created_at: e.created_at,
          description: e.remarks || `Expense #${e.id}`, // Maps UI Description -> DB Remarks
          amount_riel: Number(e.amount_riel || 0),
          amount_usd: Number(e.amount_usd || 0),
          category: e.category || 'Uncategorized',     // Maps UI Category -> DB Category
          status: e.payment_method || e.status || 'cleared',
          owner: e.spender || e.owner || '-'
        })
      })
    }

    unified.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setTransactions(unified)
    setIsLoading(false)
  }, [activeBranchId, timeFilter]);

  useEffect(() => { 
    // 💣 SECURITY WIPE: Destroy any checked boxes immediately when switching branches 
    setSelectedToDelete(new Set());
    fetchData(false)
  }, [fetchData])

  useFocusRefresh(() => fetchData(true));

  // --- DATABASE OPERATIONS ---
  async function fetchSettings() {
    const branchSuffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;
    const keys = [
      `biz_col_widths${branchSuffix}`, `biz_sum_cols${branchSuffix}`, 
      `biz_daily_cols${branchSuffix}`, `biz_retail_cols${branchSuffix}`, `biz_exp_cols${branchSuffix}`
    ];
    // Fallback to global keys for new branches
    const fallbackKeys = ['biz_col_widths', 'biz_sum_cols', 'biz_daily_cols', 'biz_retail_cols', 'biz_exp_cols'];

    const { data } = await supabase.from('app_settings').select('*').in('setting_key', [...keys, ...fallbackKeys]);
    if (data) {
      const getSetting = (key: string) => data.find(d => d.setting_key === `${key}${branchSuffix}`) || data.find(d => d.setting_key === key);

      const widths = getSetting('biz_col_widths');
      const sumCols = getSetting('biz_sum_cols');
      const dalCols = getSetting('biz_daily_cols');
      const retCols = getSetting('biz_retail_cols');
      const expCols = getSetting('biz_exp_cols');
      
      if (widths?.setting_value) setColumnWidths(widths.setting_value)
      if (sumCols?.setting_value) setSummaryCols(sumCols.setting_value)
      if (dalCols?.setting_value) setDailyCols(dalCols.setting_value)
      if (retCols?.setting_value) setRetailCols(retCols.setting_value)
      
      if (expCols?.setting_value) {
        let cols = expCols.setting_value;
        if (cols.includes('amount')) {
          cols = cols.flatMap((c: string) => c === 'amount' ? ['amount_riel', 'amount_usd'] : c);
        }
        setExpenseCols(cols);
      }
    }
  }

  // --- RAW BULK DELETE (100% ATOMIC & SECURE) ---
  const handleDelete = async () => {
    if (!confirm(`🚨 Are you sure you want to PERMANENTLY DELETE ${selectedToDelete.size} records?\n\nThis will completely erase the transaction and physically return the items to your inventory stock.`)) return;
    
    setIsLoading(true);

    const payload = {
      branch_id: activeBranchId,
      summary_ids: [] as number[],
      sales_ids: [] as number[],
      retail_ids: [] as number[],
      expense_ids: [] as number[],
      invoice_ids: [] as string[],
      restorations: [] as { product_id: number, qty: number, cogs_price: number, rice_type: string }[]
    };

    const invoiceIdsToCascade = new Set<string>(); 

    // Step 1: Map selected items into payload buckets
    transactions.forEach(t => {
      if (selectedToDelete.has(t.id)) {
        if (t.source === 'Wholesale Invoice Summary') {
          payload.summary_ids.push(Number(t.raw_db_id));
          if (t.invoice_id) invoiceIdsToCascade.add(t.invoice_id);
        }
        else if (t.source === 'Walk-in Wholesale' || t.source === 'Non-Walk-in Wholesale') {
          payload.sales_ids.push(Number(t.raw_db_id));
          payload.restorations.push({ product_id: Number(t.product_id), qty: Number(t.qty) || 0, cogs_price: Number(t.cogs_price) || 0, rice_type: t.rice_type });
          if (t.invoice_id) invoiceIdsToCascade.add(t.invoice_id);
        }
        else if (t.source === 'Retails only') {
          payload.retail_ids.push(Number(t.raw_db_id));
          payload.restorations.push({ product_id: Number(t.product_id), qty: Number(t.qty) || 0, cogs_price: Number(t.cogs_price) || 0, rice_type: t.rice_type });
        }
        else if (t.source === 'Biz Expense' || t.source === 'Personal Expense' || t.source === 'Staff Debt') {
          payload.expense_ids.push(Number(t.raw_db_id));
        }
      }
    });

    // Step 2: Grab orphaned children if a master invoice was selected
    if (invoiceIdsToCascade.size > 0) {
      payload.invoice_ids = Array.from(invoiceIdsToCascade);
      
      const children = transactions.filter(t => 
        (t.source === 'Non-Walk-in Wholesale' || t.source === 'Walk-in Wholesale') && 
        t.invoice_id && 
        invoiceIdsToCascade.has(t.invoice_id) && 
        !selectedToDelete.has(t.id)
      );
      
      children.forEach(c => {
        payload.sales_ids.push(Number(c.raw_db_id));
        payload.restorations.push({ product_id: Number(c.product_id), qty: Number(c.qty) || 0, cogs_price: Number(c.cogs_price) || 0, rice_type: c.rice_type });
      });
    }

    // Step 3: Strip non-inventory items from the restoration queue (Delivery fees, empty bags)
    payload.restorations = payload.restorations.filter(r => {
       const isSpecial = (r.rice_type || '').includes('បានប្រើ') || (r.rice_type || '').includes('សេវាដឹក');
       return r.qty !== 0 && !isSpecial && r.product_id;
    });

    // Step 4: Hand it off securely to Postgres
    try {
      const { error } = await supabase.rpc('bulk_delete_transactions', { p_payload: payload });
      if (error) throw error;

      setSelectedToDelete(new Set());
      showToast('success', 'Deleted Successfully', 'Records and inventory restored.');
      fetchData(true);
    } catch (e: any) {
      showToast('error', 'Deletion Failed', e.message);
      setIsLoading(false);
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedToDelete);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedToDelete(next);
  }

  const toggleSelectAll = () => {
    if (selectedToDelete.size === processedTransactions.length && processedTransactions.length > 0) {
      setSelectedToDelete(new Set());
    } else {
      setSelectedToDelete(new Set(processedTransactions.map(t => t.id)));
    }
  }

  // --- HEADER SORT LOGIC ---
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  }

  // --- COLUMN DRAG & DROP LOGIC ---
  const handleDragStart = (e: React.DragEvent, col: string) => {
    e.dataTransfer.setData('text/plain', col)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault() 
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    const sourceCol = e.dataTransfer.getData('text/plain')
    if (!sourceCol || sourceCol === targetCol) return

    const reorder = (prev: string[]) => {
      const newOrder = prev.filter(c => c !== sourceCol)
      const targetIdx = newOrder.indexOf(targetCol)
      newOrder.splice(targetIdx, 0, sourceCol)
      return newOrder
    }

    const branchSuffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;

    if (activeTab === 'Wholesale Invoice Summary') {
      const updated = reorder(summaryCols)
      setSummaryCols(updated)
      supabase.from('app_settings').upsert({ setting_key: `biz_sum_cols${branchSuffix}`, setting_value: updated }, { onConflict: 'setting_key' }).then()
    } else if (activeTab === 'Walk-in Wholesale' || activeTab === 'Non-Walk-in Wholesale') {
      const updated = reorder(dailyCols)
      setDailyCols(updated)
      supabase.from('app_settings').upsert({ setting_key: `biz_daily_cols${branchSuffix}`, setting_value: updated }, { onConflict: 'setting_key' }).then()
    } else if (activeTab === 'Retails only') {
      const updated = reorder(retailCols)
      setRetailCols(updated)
      supabase.from('app_settings').upsert({ setting_key: `biz_retail_cols${branchSuffix}`, setting_value: updated }, { onConflict: 'setting_key' }).then()
    } else {
      const updated = reorder(expenseCols)
      setExpenseCols(updated)
      supabase.from('app_settings').upsert({ setting_key: `biz_exp_cols${branchSuffix}`, setting_value: updated }, { onConflict: 'setting_key' }).then()
    }
  }

  // --- COLUMN RESIZE LOGIC ---
  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent, columnKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = 'touches' in e ? e.touches[0].pageX : e.pageX
    const startWidth = widthsRef.current[columnKey] || 150

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0].pageX : moveEvent.pageX
      const newWidth = Math.max(60, startWidth + (currentX - startX))
      setColumnWidths(prev => ({ ...prev, [columnKey]: newWidth }))
    }

    const handleUp = async () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.removeEventListener('touchmove', handleMove)
      document.removeEventListener('touchmove', handleMove)
      document.removeEventListener('touchend', handleUp)
      
      const branchSuffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;
      await supabase.from('app_settings').upsert({ setting_key: `biz_col_widths${branchSuffix}`, setting_value: widthsRef.current }, { onConflict: 'setting_key' })
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.addEventListener('touchmove', handleMove, { passive: false })
    document.addEventListener('touchmove', handleMove, { passive: false })
    document.addEventListener('touchmove', handleUp)
  }

  // --- DATA PROCESSING (USING DEBOUNCED SEARCH!) ---
  const processedTransactions = transactions
    .filter(t => {
      if (t.source !== activeTab) return false;

      if (debouncedSearch) {
        const query = debouncedSearch.toLowerCase()
        const searchableText = `${t.invoice_id || ''} ${t.transaction_id || ''} ${t.customer_name || ''} ${t.rice_types || ''} ${t.rice_type || ''} ${t.description || ''} ${t.category || ''}`.toLowerCase()
        if (!searchableText.includes(query)) return false
      }

      return true
    })
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      
      let valA = a[key];
      let valB = b[key];
      
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    })

  // --- HELPERS ---
  const formatDate = (dateString: string) => {
    const d = new Date(dateString)
    return d.toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const Resizer = ({ columnKey }: { columnKey: string }) => (
    <div
      className="resizer-handle"
      onMouseDown={(e) => handleResizeStart(e, columnKey)}
      onTouchStart={(e) => handleResizeStart(e, columnKey)}
    />
  )

  return (
    <AdminGuard>
      {/* 🔥 APP LAYOUT: Flex Column + Overflow Hidden locks the outer page */}
      <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      
      {/* HEADER (Frozen) */}
      <div className="header-container" style={{ flexShrink: 0 }}>
        <div className="header-left">
          <h1 className="saas-page-title">🔐 Business Database</h1>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={() => setIsExportModalOpen(true)} 
            className="saas-btn"
            style={{ background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px' }}
            title="Export Options"
          >
            <span>📤</span>
            <span className="hide-on-mobile">Export Data</span>
          </button>

          {selectedToDelete.size > 0 && (
            <button onClick={handleDelete} className="saas-btn saas-btn-danger" style={{ padding: '8px 12px' }}>
              🗑️ <span className="hide-on-mobile">Delete</span> ({selectedToDelete.size})
            </button>
          )}
          <button className="saas-btn saas-btn-secondary" onClick={() => fetchData(false)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px' }} title="Refresh Data">
            <span>{isLoading ? '⏳' : '🔄'}</span>
            <span className="hide-on-mobile">{isLoading ? 'Loading...' : 'Refresh Data'}</span>
          </button>
        </div>
      </div>

      {/* TOOLBAR (Frozen) */}
      <div className="saas-card" style={{ padding: '16px', marginBottom: '24px', flexShrink: 0 }}>
        
        {/* TOP ROW: TABS */}
        <div className="saas-tab-container" style={{ border: 'none', padding: 0, boxShadow: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0, paddingBottom: '12px', marginBottom: '16px' }}>
          <button className={`saas-tab ${activeTab === 'Wholesale Invoice Summary' ? 'active' : ''}`} onClick={() => {setActiveTab('Wholesale Invoice Summary'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            🌾 Wholesale Invoice Summary
          </button>
          <button className={`saas-tab ${activeTab === 'Walk-in Wholesale' ? 'active' : ''}`} onClick={() => {setActiveTab('Walk-in Wholesale'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            🚶 Walk-in Wholesale
          </button>
          <button className={`saas-tab ${activeTab === 'Non-Walk-in Wholesale' ? 'active' : ''}`} onClick={() => {setActiveTab('Non-Walk-in Wholesale'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            🚚 Non-Walk-in Wholesale
          </button>
          <button className={`saas-tab ${activeTab === 'Retails only' ? 'active' : ''}`} onClick={() => {setActiveTab('Retails only'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            🛍️ Retails only
          </button>
          <button className={`saas-tab ${activeTab === 'Biz Expense' ? 'active' : ''}`} onClick={() => {setActiveTab('Biz Expense'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            📉 Biz Expense
          </button>
          <button className={`saas-tab ${activeTab === 'Personal Expense' ? 'active' : ''}`} onClick={() => {setActiveTab('Personal Expense'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            🍕 Personal Expense
          </button>
          <button className={`saas-tab ${activeTab === 'Staff Debt' ? 'active' : ''}`} onClick={() => {setActiveTab('Staff Debt'); setSortConfig(null); setSelectedToDelete(new Set());}}>
            💸 Staff Debt
          </button>
        </div>

        {/* BOTTOM ROW: FILTERS & SEARCH */}
        <div className="toolbar-bottom-row">
          <div className="time-filters-wrapper">
            <button className={`time-btn ${timeFilter === 'Today' ? 'active' : ''}`} onClick={() => setTimeFilter('Today')}>Today</button>
            <button className={`time-btn ${timeFilter === 'This Week' ? 'active' : ''}`} onClick={() => setTimeFilter('This Week')}>This Week</button>
            <button className={`time-btn ${timeFilter === 'This Month' ? 'active' : ''}`} onClick={() => setTimeFilter('This Month')}>This Month</button>
            <button className={`time-btn ${timeFilter === 'All Time' ? 'active' : ''}`} onClick={() => setTimeFilter('All Time')}>All Time</button>
          </div>

          <input 
            className="saas-input" 
            placeholder="🔍 Search records..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            style={{ flex: 1, minWidth: '200px' }}
          />
        </div>
      </div>

      {/* RECORD COUNT BADGE (Frozen) */}
      <div className="record-count-badge" style={{ flexShrink: 0 }}>
        Showing {processedTransactions.length} records for {timeFilter}
      </div>

      {/* 🔥 MAIN SPREADSHEET (Fills remaining space and scrolls internally) */}
      <div className="saas-table-wrapper" style={{ flex: 1, minHeight: 0, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
          <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {/* Checkbox Header Column (Sticky) */}
                <th className="saas-th" style={{ width: '50px', textAlign: 'center', borderRight: '1px solid #f1f5f9', position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0' }}>
                  <input 
                    type="checkbox" 
                    className="biz-checkbox"
                    checked={selectedToDelete.size === processedTransactions.length && processedTransactions.length > 0} 
                    onChange={toggleSelectAll} 
                  />
                </th>

                {/* Dynamic Data Headers (Sticky) */}
                {activeColumns.map(key => (
                  <th 
                    key={key} 
                    className="saas-th"
                    draggable 
                    onDragStart={(e) => handleDragStart(e, key)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, key)}
                    onClick={() => handleSort(key)}
                    style={{ 
                      width: columnWidths[key] || 150, 
                      borderRight: '1px solid #f1f5f9', 
                      cursor: 'pointer', 
                      position: 'sticky', 
                      top: 0, 
                      zIndex: 30, 
                      backgroundColor: '#f8fafc', 
                      boxShadow: 'inset 0 -2px 0 0 #e2e8f0'
                    }}
                    title="Click to sort, Drag to reorder"
                  >
                    {formatHeader(key)}
                    <span className="sort-icon" style={{ opacity: sortConfig?.key === key ? 1 : 0.3 }}>
                      {sortConfig?.key === key ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                    <Resizer columnKey={key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && transactions.length === 0 ? (
                <TableSkeleton columns={activeColumns.length + 1} rows={8} />
              ) : processedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length + 1} style={{ padding: 0 }}>
                    <EmptyState 
                      icon="🔍" 
                      title="No records found" 
                      message="We couldn't find any transactions matching your current search or date filters." 
                    />
                  </td>
                </tr>
              ) : (
                processedTransactions.map(t => {
                  const isRowSelected = selectedToDelete.has(t.id);
                  
                  return (
                    <tr key={t.id} className={`saas-tr ${isRowSelected ? 'selected' : ''}`}>
                      <td className="saas-td" style={{ textAlign: 'center', borderRight: '1px solid #f1f5f9', padding: '14px 12px' }}>
                        <input 
                          type="checkbox" 
                          className="biz-checkbox"
                          checked={isRowSelected} 
                          onChange={() => toggleSelect(t.id)} 
                        />
                      </td>

                      {activeColumns.map(col => {
                        const val = t[col] ?? '';

                        return (
                          <td 
                            key={col} 
                            className="saas-td"
                            style={{ padding: 0, borderRight: '1px solid #f1f5f9', position: 'relative' }}
                          >
                            <div className="cell-display" style={{ cursor: 'default' }}>
                              {['invoice_id', 'transaction_id', 'customer_name', 'rice_types', 'rice_type', 'description'].includes(col) && (
                                <span style={{ fontWeight: ['invoice_id', 'transaction_id'].includes(col) ? 'bold' : 'normal', color: ['invoice_id', 'transaction_id'].includes(col) ? '#1e293b' : 'inherit' }}>
                                  {val || '-'}
                                </span>
                              )}
                              
                              {col === 'owner' && <span className="badge-owner">{val || '-'}</span>}
                              {col === 'category' && <span className="badge-category">{val || '-'}</span>}
                              {col === 'status' && <span className="badge-status">{val || '-'}</span>}
                              
                              {col === 'created_at' && formatDate(t.created_at)}
                              {col === 'qty' && formatNumber(val || 0)}

                              {['price_per_bag', 'cogs_price', 'total_sales', 'total_cogs', 'total_profit', 'amount_riel', 'amount_usd'].includes(col) && (
                                <span style={{ 
                                  fontWeight: 'bold', 
                                  color: (col === 'total_profit' && val < 0) || col === 'total_cogs' || col === 'cogs_price' || col === 'amount_riel' || col === 'amount_usd' ? '#ef4444' : '#10b981' 
                                }}>
                                  {col === 'amount_usd' ? formatUSD(val || 0) : formatRiel(val || 0)}
                                </span>
                              )}
                            </div>
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

      {/* 🟢 EXPORT POPUP MODAL */}
      <Modal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} title="Export Database" icon="📤" maxWidth="400px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          
          <button 
            onClick={() => {
              exportBizDataToExcel(transactions, `Full-Biz-Report-Branch-${activeBranchId}-${timeFilter}.xlsx`);
              setIsExportModalOpen(false);
            }} 
            className="saas-btn" 
            style={{ background: '#10b981', color: '#fff', padding: '16px', fontSize: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <span>📊</span> Download Excel (.xlsx)
            </div>
            <div style={{ fontSize: '11px', fontWeight: 'normal', opacity: 0.9 }}>Exports all 3 tabs (Wholesale, Retail, Expenses)</div>
          </button>

          <button 
            onClick={() => {
              setIsExportModalOpen(false);
              // Wait a fraction of a second for the modal to close before triggering the PDF print dialog
              setTimeout(() => window.print(), 300);
            }} 
            className="saas-btn saas-btn-primary" 
            style={{ padding: '16px', fontSize: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <span>📄</span> Print / Save as PDF
            </div>
            <div style={{ fontSize: '11px', fontWeight: 'normal', opacity: 0.9 }}>Captures the currently visible table perfectly</div>
          </button>

        </div>
        <button onClick={() => setIsExportModalOpen(false)} className="saas-btn saas-btn-secondary" style={{ width: '100%' }}>Cancel</button>
      </Modal>

      {/* --- PRESERVED PAGE-SPECIFIC UTILITY STYLES --- */}
      <style jsx global>{`
        /* 🔥 NEW: Cleanly hides text inside buttons on small screens */
        .hide-on-mobile { display: inline; }

        .toolbar-bottom-row { display: flex; width: 100%; gap: 12px; flex-wrap: wrap; align-items: center; }
        .time-filters-wrapper { display: flex; background: #f1f5f9; padding: 4px; border-radius: 8px; gap: 4px; }
        .record-count-badge { margin-bottom: 12px; color: #64748b; font-size: 13px; font-weight: bold; }
        .time-btn { padding: 8px 12px; border-radius: 6px; border: none; background: transparent; font-weight: bold; font-size: 13px; color: #64748b; cursor: pointer; }
        .time-btn.active { background: #fff; color: #b58a3d; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        
        .biz-checkbox { width: 18px; height: 18px; cursor: pointer; accent-color: #b58a3d; }
        .sort-icon { margin-left: 6px; font-size: 12px; }
        .resizer-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 14px; cursor: col-resize; background: transparent; z-index: 10; transform: translateX(50%); }
        
        .badge-owner { text-transform: capitalize; font-weight: bold; color: #64748b; }
        .badge-category { text-transform: capitalize; color: #475569; }
        .badge-status { color: #64748b; font-style: italic; }

        .cell-display { padding: 14px 12px; width: 100%; height: 100%; box-sizing: border-box; display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .header-container { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; margin-top: 0; margin-left: 60px; gap: 12px; height: 42px; width: calc(100% - 60px); max-width: 1600px; }
        .header-left { display: flex; align-items: center; gap: 12px; }

        /* 🔥 PDF EXPORT CLEANUP: Hides sidebars and UI controls when generating the PDF */
        @media print {
          body { background: white; }
          .header-actions, .saas-card, .time-filters-wrapper, .record-count-badge, .biz-checkbox, .resizer-handle { display: none !important; }
          .main-wrapper { padding: 0 !important; margin: 0 !important; height: auto !important; overflow: visible !important; }
          .saas-table-wrapper { flex: none !important; height: auto !important; overflow: visible !important; }
          .saas-table-responsive { overflow: visible !important; }
          .saas-table { width: 100% !important; border-collapse: collapse !important; }
          .saas-th, .saas-td { border: 1px solid #e2e8f0 !important; font-size: 10pt !important; padding: 8px !important; }
          .saas-th { background-color: #f8fafc !important; color: #000 !important; }
        }

        @media (max-width: 1023px) {
          .hide-on-mobile { display: none !important; }
          .header-container { margin-left: 54px !important; margin-right: 0 !important; margin-bottom: 24px !important; margin-top: 0 !important; display: flex !important; flex-direction: row !important; justify-content: space-between !important; align-items: center !important; height: 44px !important; width: calc(100% - 54px) !important; }
          .header-left { display: flex !important; flex-direction: row !important; align-items: center !important; gap: 12px !important; }
          .toolbar-bottom-row { flex-direction: column; align-items: stretch; }
          .time-filters-wrapper { display: flex; width: 100%; }
          .time-btn { flex: 1; padding: 10px 4px; font-size: 12px; text-align: center; }
        }
      `}</style>
      </div>
    </AdminGuard>
  )
}