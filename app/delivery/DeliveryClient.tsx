'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useFocusRefresh } from '@/lib/useFocusRefresh' // 🔥 FIX: Added missing hook import
import { formatRiel, EXCHANGE_RATE } from '@/utils/formatters'
import { CurrencyInput } from '@/components/Inputs'
import { PaymentRow } from '@/types'
import { useToast } from '@/components/ToastProvider'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext' 

import { TELEGRAM_CONFIG } from '@/lib/telegramConfig'

export default function DeliveryPage() {
  const { showToast } = useToast();
  const { activeBranchId } = useBranch(); 

  const [deliveries, setDeliveries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'delivery' | 'credit'>('delivery')
  
  const [inlinePayments, setInlinePayments] = useState<Record<string, PaymentRow[]>>({})
  const [creditPayments, setCreditPayments] = useState<Record<string, PaymentRow[]>>({})

  const [isProcessing, setIsProcessing] = useState(false);

  const [loadLimit, setLoadLimit] = useState(100);
  const [hasMore, setHasMore] = useState(true);

  const [selectedMobileDelivery, setSelectedMobileDelivery] = useState<any | null>(null);
  const [mobileFilter, setMobileFilter] = useState<'All' | 'Pending' | 'Delivered'>('All'); 
  const [creditFilter, setCreditFilter] = useState<'Pich/Both' | 'Jing' | 'Mom' | 'All'>('Pich/Both'); 
  const [expandedCredit, setExpandedCredit] = useState<string | null>(null); 

  const DEFAULT_DELIVERY_COLS = ['customer', 'date', 'items', 'total', 'status', 'method', 'pay', 'action'];
  const COL_LABELS: Record<string, string> = { customer: 'Customer', date: 'Date & INV', items: 'Items Ordered', total: 'Total (៛)', status: 'Status', method: 'Payment Method', pay: 'Pay Amount', action: 'Complete' };
  const DEFAULT_WIDTHS: Record<string, number> = { customer: 200, date: 150, items: 300, total: 120, status: 120, method: 160, pay: 180, action: 120 };
  
  const [colOrder, setColOrder] = useState<string[]>(DEFAULT_DELIVERY_COLS);
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc'|'desc'} | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);
  
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const widthsRef = useRef(colWidths);
  widthsRef.current = colWidths;

  useEffect(() => {
    async function loadTablePrefs() {
      const baseKeys = ['delivery_col_order', 'delivery_hidden_cols', 'delivery_col_widths'];
      // 🔥 SECURITY FIX: Isolate app settings fetches by branch to prevent global cross-tenant data leaks
      const keys = activeBranchId === 0 ? baseKeys : baseKeys.map(k => `${k}_${activeBranchId}`);
      const { data } = await supabase.from('app_settings').select('*').in('setting_key', keys);
      if (data) {
        const orderPref = data.find(d => d.setting_key.replace(`_${activeBranchId}`, '') === 'delivery_col_order');
        const hiddenPref = data.find(d => d.setting_key.replace(`_${activeBranchId}`, '') === 'delivery_hidden_cols');
        const widthPref = data.find(d => d.setting_key.replace(`_${activeBranchId}`, '') === 'delivery_col_widths');
        
        if (orderPref?.setting_value) setColOrder(orderPref.setting_value);
        if (hiddenPref?.setting_value) setHiddenCols(hiddenPref.setting_value);
        if (widthPref?.setting_value) {
          setColWidths(prev => ({ ...prev, ...widthPref.setting_value }));
        }
      }
    }
    loadTablePrefs();
  }, [activeBranchId]);

  const toggleCol = (col: string) => {
    setHiddenCols(prev => {
      const newHidden = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      const branchKey = activeBranchId === 0 ? 'delivery_hidden_cols' : `delivery_hidden_cols_${activeBranchId}`;
      supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: newHidden }, { onConflict: 'setting_key' }).then();
      return newHidden;
    });
  };

  const handleDragStart = (e: React.DragEvent, col: string) => { e.dataTransfer.setData('col', col); };
  const handleDrop = (e: React.DragEvent, targetCol: string) => {
    const sourceCol = e.dataTransfer.getData('col');
    if (!sourceCol || sourceCol === targetCol) return;
    setColOrder(prev => {
      const newOrder = [...prev];
      newOrder.splice(newOrder.indexOf(sourceCol), 1);
      newOrder.splice(newOrder.indexOf(targetCol), 0, sourceCol);
      const branchKey = activeBranchId === 0 ? 'delivery_col_order' : `delivery_col_order_${activeBranchId}`;
      supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: newOrder }, { onConflict: 'setting_key' }).then();
      return newOrder;
    });
  };
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent, col: string) => {
    // 🔥 MOBILE FIX: Removed e.preventDefault() to avoid passive event listener crash on mobile Safari
    e.stopPropagation();
    const startX = 'touches' in e ? e.touches[0].pageX : e.pageX;
    const startWidth = widthsRef.current[col] || DEFAULT_WIDTHS[col] || 150;
    
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? (moveEvent as TouchEvent).touches[0].pageX : (moveEvent as MouseEvent).pageX;
      const newWidth = Math.max(60, startWidth + (currentX - startX)); 
      setColWidths(prev => ({ ...prev, [col]: newWidth }));
    }
    
    const handleUp = async () => {
      document.removeEventListener('mousemove', handleMove as any); 
      document.removeEventListener('mouseup', handleUp);
      // 🔥 RELIABILITY FIX: Removed duplicate listener removal
      document.removeEventListener('touchmove', handleMove as any); 
      document.removeEventListener('touchend', handleUp);
      
      const branchKey = activeBranchId === 0 ? 'delivery_col_widths' : `delivery_col_widths_${activeBranchId}`;
      await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: widthsRef.current }, { onConflict: 'setting_key' });
    }
    
    document.addEventListener('mousemove', handleMove as any); 
    document.addEventListener('mouseup', handleUp);
    // 🔥 RELIABILITY FIX: Removed duplicate listener addition
    document.addEventListener('touchmove', handleMove as any, { passive: false }); 
    document.addEventListener('touchend', handleUp);
  };

  // 🔥 CLOSURE FIX: Wrap fetchDeliveries in useCallback to lock onto current branch
  const fetchDeliveries = useCallback(async () => {
    setLoading(true);
    
    const { data: pendingData, error: pendingErr } = await supabase
      .from('invoice_summaries')
      .select('*')
      .not('customer_name', 'ilike', '%Walk-in%')
      .eq('is_done', false)
      .eq('branch_id', activeBranchId) 
      .order('created_at', { ascending: false });

    const { data: doneData, error: doneErr, count: doneCount } = await supabase
      .from('invoice_summaries')
      .select('*', { count: 'exact' })
      .not('customer_name', 'ilike', '%Walk-in%')
      .eq('is_done', true)
      .eq('branch_id', activeBranchId) 
      .order('created_at', { ascending: false })
      .limit(loadLimit);

    if (pendingErr || doneErr) {
      showToast('error', 'Fetch Error', pendingErr?.message || doneErr?.message || 'Failed to fetch deliveries');
    } else {
      const combined = [...(pendingData || []), ...(doneData || [])];
      setDeliveries(combined.filter((d: any) => d.delivery_status !== 'Voided'));
      setHasMore(doneCount ? doneCount > loadLimit : false);
    }
    
    setLoading(false);
  }, [activeBranchId, loadLimit, showToast]);

  useEffect(() => {
    // 💣 SECURITY WIPE: Destroy unsubmitted payment forms and active modals 
    // when switching branches to prevent Cross-Tenant Ghost Payments!
    setInlinePayments({});
    setCreditPayments({});
    setSelectedMobileDelivery(null);
    setExpandedCredit(null);

    fetchDeliveries();

    // 📡 WEBSOCKET ISOLATION: Append the branch ID to the channel name 
    // so branches don't trigger unnecessary database refetches for each other!
    const deliveryChannel = supabase.channel(`delivery-updates-${activeBranchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_summaries' }, () => {
        fetchDeliveries();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(deliveryChannel);
    };
  }, [activeBranchId, fetchDeliveries])

  // 🔥 RESTORED & SAFE: Window Focus Refresher
  useFocusRefresh(fetchDeliveries);

  // 🔥 RESTORED FUNCTION & SECURITY FIX: Locks the status update strictly to the active branch
  async function updateInvoiceField(invoiceId: string, field: string, value: any) {
    setDeliveries(prev => prev.map((d: any) => d.invoice_id === invoiceId ? { ...d, [field]: value } : d));
    
    const { error } = await supabase.from('invoice_summaries')
      .update({ [field]: value })
      .eq('invoice_id', invoiceId)
      .eq('branch_id', activeBranchId);
      
    if (error) {
      showToast('error', 'Update Failed', `Error updating ${field}: ${error.message}`);
      fetchDeliveries();
    }
  }

  const getInlinePaymentState = (invId: string, balanceDue: number) => {
    return inlinePayments[invId] || [{ id: 1, method: 'Cash ៛', amount: balanceDue }];
  }

  const updateInlineRow = (invId: string, rowId: number, field: string, value: any, balanceDue: number) => {
    setInlinePayments(prev => {
      const rows = prev[invId] ? [...prev[invId]] : [{ id: 1, method: 'Cash ៛', amount: balanceDue }];
      const newRows = rows.map(r => r.id === rowId ? { ...r, [field]: value } : r);
      return { ...prev, [invId]: newRows };
    });
  }

  const addInlineSplit = (invId: string, balanceDue: number) => {
    setInlinePayments(prev => {
      const rows = prev[invId] ? [...prev[invId]] : [{ id: 1, method: 'Cash ៛', amount: balanceDue }];
      return { ...prev, [invId]: [...rows, { id: Date.now(), method: 'Cash ៛', amount: '' }] };
    });
  }

  const removeInlineSplit = (invId: string, rowId: number, balanceDue: number) => {
    setInlinePayments(prev => {
      const rows = prev[invId] ? [...prev[invId]] : [{ id: 1, method: 'Cash ៛', amount: balanceDue }];
      return { ...prev, [invId]: rows.filter(r => r.id !== rowId) };
    });
  }

  async function handleInlineProcess(d: any, rows: PaymentRow[]) {
    if (isProcessing) return;

    let totalRielEq = 0;
    let methodStrings: string[] = [];
    const paymentRecordsToInsert: any[] = [];
    
    let rawOwner = (d.owner || '').trim();
    let normalizedOwner = rawOwner ? rawOwner.charAt(0).toUpperCase() + rawOwner.slice(1).toLowerCase() : 'Unassigned';
    const validSpender = ['Pich', 'Jing'].includes(normalizedOwner) ? normalizedOwner : 'Both';

    for (const r of rows) {
      const cleanAmount = String(r.amount).replace(/,/g, '');
      const amt = Math.abs(Number(cleanAmount) || 0);
      
      if (amt <= 0) continue;
      
      const isUsd = r.method.includes('$');
      let convertedAmt = isUsd ? Math.round(amt * EXCHANGE_RATE) : Math.round(amt);
      
      totalRielEq += convertedAmt;
      methodStrings.push(`${r.method}: ${amt}`);

      paymentRecordsToInsert.push({
        invoice_id: d.invoice_id,
        amount_paid_riel: isUsd ? 0 : amt,
        amount_paid_usd: isUsd ? amt : 0,
        payment_method: r.method,
        recorded_by: validSpender,
        payment_date: new Date().toISOString(), 
        remarks: `Inline Delivery Settlement`
      });
    }

    if (totalRielEq <= 0) {
       showToast('error', 'Invalid Amount', 'Please enter a valid payment amount.');
       return;
    }

    setIsProcessing(true);

    try {
      const { data: latestInv } = await supabase.from('invoice_summaries').select('balance_due, payment_method').eq('invoice_id', d.invoice_id).single();
      const actualBalance = latestInv ? Number(latestInv.balance_due) : d.balance_due;
      
      const newBalance = Math.round(actualBalance - totalRielEq);
      let newPaymentMethodStr = latestInv ? latestInv.payment_method : d.payment_method;
      
      newPaymentMethodStr = d.payment_method && d.payment_method !== '-' && d.payment_method !== 'Unpaid / Debt'
          ? `${d.payment_method}, ${methodStrings.join(', ')}`
          : methodStrings.join(', ');

      const isDone = newBalance <= 0;

      // 📦 ATOMIC RPC PAYLOAD
      const atomicPayload = {
        branch_id: activeBranchId,
        payments: paymentRecordsToInsert,
        invoices: [{
          invoice_id: d.invoice_id,
          balance_due: newBalance,
          payment_method: newPaymentMethodStr,
          is_done: isDone,
          delivery_status: 'Delivered'
        }]
      };

      // 🚀 ONE SECURE TRIP TO POSTGRES
      const { error: rpcError } = await supabase.rpc('process_delivery_payments', { p_payload: atomicPayload });
      if (rpcError) throw new Error("Transaction Failed: " + rpcError.message);

      setDeliveries(prev => prev.map(inv => inv.invoice_id === d.invoice_id ? {
        ...inv,
        balance_due: newBalance,
        payment_method: newPaymentMethodStr,
        is_done: isDone,
        delivery_status: 'Delivered' 
      } : inv));
      
      setInlinePayments(prev => { const n = {...prev}; delete n[d.invoice_id]; return n; });

      try {
        let message = `🚚 *Delivery Payment Update*\n`;
        message += `🏬 *Branch ID:* ${activeBranchId === 1 ? 'SMC' : activeBranchId === 2 ? 'Chukmeas' : activeBranchId}\n`;
        message += `📅 *Date:* ${new Date().toLocaleDateString('en-GB')}\n`;
        message += `👤 *Customer name:* ${d.customer_name}\n`;
        message += `🚚 *Delivery Status:* Delivered\n`;
        message += `💵 *Paid amount:* ${formatRiel(totalRielEq)}\n`;
        if (newBalance > 0) {
          message += `⏳ *Unpaid amount:* ${formatRiel(newBalance)}\n`; 
        }

        const botToken = TELEGRAM_CONFIG.botToken;
        const masterChatId = TELEGRAM_CONFIG.chatId;
        
        // 🚦 ROUTE TO DELIVERY TOPICS (19 or 22)
        const targetThreadId = (TELEGRAM_CONFIG as any).deliveryTopics?.[activeBranchId];

        if (botToken && masterChatId) {
          const payload: any = {
            chat_id: masterChatId,
            text: message,
            parse_mode: 'Markdown'
          };

          // Inject the specific topic ID for the active branch!
          if (targetThreadId) {
            payload.message_thread_id = targetThreadId;
          }

          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).catch(console.error);
        }
      } catch (teleErr) { console.error("Telegram Error", teleErr); }

      showToast('success', 'Payment Saved', 'Delivery payment logged successfully.');

    } catch (error: any) {
      showToast('error', 'Payment Error', error.message);
      fetchDeliveries(); 
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleUndoProcess(d: any) {
    if (!confirm('Are you sure you want to undo? This will permanently delete the collected payment records and revert your Dashboard Cash.')) return;
    
    setIsProcessing(true);
    try {
      // 📦 ATOMIC RPC PAYLOAD
      const atomicPayload = {
        branch_id: activeBranchId,
        invoice_id: d.invoice_id,
        total_sales: d.total_sales
      };

      // 🚀 ONE SECURE TRIP TO POSTGRES
      const { error: rpcError } = await supabase.rpc('undo_delivery_payment', { p_payload: atomicPayload });
      if (rpcError) throw rpcError;

      showToast('success', 'Undo Successful', 'Payment reversed and returned to pending.');
      fetchDeliveries();
    } catch (error: any) {
      showToast('error', 'Undo Failed', error.message);
    } finally {
      setIsProcessing(false);
    }
  }

  const getCreditPaymentState = (uniqueKey: string, totalOwed: number) => {
    return creditPayments[uniqueKey] || [{ id: 1, method: 'Cash ៛', amount: totalOwed }];
  }

  const updateCreditRow = (uniqueKey: string, rowId: number, field: string, value: any, totalOwed: number) => {
    setCreditPayments(prev => {
      const rows = prev[uniqueKey] ? [...prev[uniqueKey]] : [{ id: 1, method: 'Cash ៛', amount: totalOwed }];
      const newRows = rows.map(r => r.id === rowId ? { ...r, [field]: value } : r);
      return { ...prev, [uniqueKey]: newRows };
    });
  }

  const addCreditSplit = (uniqueKey: string, totalOwed: number) => {
    setCreditPayments(prev => {
      const rows = prev[uniqueKey] ? [...prev[uniqueKey]] : [{ id: 1, method: 'Cash ៛', amount: totalOwed }];
      return { ...prev, [uniqueKey]: [...rows, { id: Date.now(), method: 'Cash ៛', amount: '' }] };
    });
  }

  const removeCreditSplit = (uniqueKey: string, rowId: number, totalOwed: number) => {
    setCreditPayments(prev => {
      const rows = prev[uniqueKey] ? [...prev[uniqueKey]] : [{ id: 1, method: 'Cash ៛', amount: totalOwed }];
      return { ...prev, [uniqueKey]: rows.filter(r => r.id !== rowId) };
    });
  }

  async function handleProcessCreditPayment(debtor: any, rows: PaymentRow[]) {
    if (isProcessing) return;

    let totalRielEq = 0;
    let methodStrings: string[] = [];
    let availableFunds: { method: string, isUsd: boolean, faceRemaining: number, eqRemaining: number }[] = [];

    for (const r of rows) {
      const cleanAmount = String(r.amount).replace(/,/g, '');
      const amt = Math.abs(Number(cleanAmount) || 0);
      
      if (amt <= 0) continue;
      
      const isUsd = r.method.includes('$');
      let convertedAmt = isUsd ? Math.round(amt * EXCHANGE_RATE) : Math.round(amt);
      
      totalRielEq += convertedAmt;
      methodStrings.push(`${r.method}: ${amt}`);
      
      availableFunds.push({
          method: r.method,
          isUsd: isUsd,
          faceRemaining: amt,
          eqRemaining: convertedAmt
      });
    }

    if (totalRielEq <= 0) {
       showToast('error', 'Invalid Amount', 'Please enter a valid payment amount.');
       return;
    }

    setIsProcessing(true);

    try {
      const validSpender = ['Pich', 'Jing'].includes(debtor.owner) ? debtor.owner : 'Both';
      
      const updatedInvoices: any[] = [];
      const paymentRecordsToInsert: any[] = [];
      const combinedMethodStr = methodStrings.join(', ');
      
      for (const inv of debtor.invoices) {
        let invBalance = Number(inv.balance_due) || 0;
        if (invBalance <= 0) continue;
        
        let amountAppliedToThisInvoiceRielEq = 0;

        for (let fund of availableFunds) {
            if (fund.eqRemaining <= 0) continue;
            if (invBalance <= 0) break;

            let applyEq = Math.min(invBalance, fund.eqRemaining);
            let applyFace = fund.isUsd ? applyEq / EXCHANGE_RATE : Math.round(applyEq);

            paymentRecordsToInsert.push({
                invoice_id: inv.invoice_id,
                amount_paid_riel: fund.isUsd ? 0 : applyFace,
                amount_paid_usd: fund.isUsd ? applyFace : 0,
                payment_method: fund.method,
                recorded_by: validSpender,
                payment_date: new Date().toISOString(), 
                remarks: `Bulk Credit Settlement`
            });

            fund.eqRemaining -= applyEq;
            fund.faceRemaining -= applyFace;
            invBalance -= applyEq;
            amountAppliedToThisInvoiceRielEq += applyEq;
        }
        
        if (amountAppliedToThisInvoiceRielEq > 0) {
            let newBalance = Math.round((Number(inv.balance_due) || 0) - amountAppliedToThisInvoiceRielEq);
            let newPaymentMethodStr = inv.payment_method;
            const appliedStr = `Paid: ${formatRiel(amountAppliedToThisInvoiceRielEq)} via [${combinedMethodStr}]`;

            if (inv.payment_method && inv.payment_method !== '-' && inv.payment_method !== 'Unpaid / Debt') {
               newPaymentMethodStr = `${inv.payment_method}, ${appliedStr}`;
            } else {
               newPaymentMethodStr = appliedStr;
            }

            updatedInvoices.push({
              invoice_id: inv.invoice_id,
              balance_due: newBalance,
              payment_method: newPaymentMethodStr,
              is_done: newBalance <= 0,
              delivery_status: newBalance <= 0 ? 'Delivered' : inv.delivery_status
            });
        }
      }

      // 📦 ATOMIC RPC PAYLOAD
      const atomicPayload = {
        branch_id: activeBranchId,
        payments: paymentRecordsToInsert,
        invoices: updatedInvoices
      };

      // 🚀 ONE SECURE TRIP TO POSTGRES
      const { error: rpcError } = await supabase.rpc('process_delivery_payments', { p_payload: atomicPayload });
      if (rpcError) throw new Error("Transaction Failed: " + rpcError.message);

      const uniqueKey = `${debtor.owner}_${debtor.name}`;
      setDeliveries(prev => prev.map(d => {
        const matched = updatedInvoices.find(u => u.invoice_id === d.invoice_id);
        return matched ? { ...d, ...matched } : d;
      }));
      setCreditPayments(prev => { const n = {...prev}; delete n[uniqueKey]; return n; });

      showToast('success', 'Credit Settled', 'Account balance updated successfully.');

    } catch (error: any) {
      showToast('error', 'Settlement Error', error.message);
      fetchDeliveries();
    } finally {
      setIsProcessing(false);
    }
  }

  const isFullyComplete = (d: any) => d.is_done === true;
  const isDeliveredVisual = (d: any) => d.delivery_status === 'Delivered';

  // 🔥 PERFORMANCE FIX: Memoize sorting and mapping engine to prevent UI lock-up
  const { sortedDeliveries, debtorsList, groupedDebtors, activeOwners } = useMemo(() => {
      const sorted = [...deliveries].sort((a: any, b: any) => {
        if (sortConfig) {
          let valA = a[sortConfig.key] || '';
          let valB = b[sortConfig.key] || '';
          if (sortConfig.key === 'customer') { valA = a.customer_name; valB = b.customer_name; }
          if (sortConfig.key === 'date') { valA = new Date(a.created_at).getTime(); valB = new Date(b.created_at).getTime(); }
          if (sortConfig.key === 'total') { valA = Number(a.total_sales); valB = Number(b.total_sales); }
          if (sortConfig.key === 'items') { valA = a.rice_types; valB = b.rice_types; }
          if (sortConfig.key === 'status') { valA = a.delivery_status; valB = b.delivery_status; }
          if (sortConfig.key === 'method') { valA = a.payment_method; valB = b.payment_method; }
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
        } else {
          const aDone = isDeliveredVisual(a);
          const bDone = isDeliveredVisual(b);
          if (!aDone && bDone) return -1;
          if (aDone && !bDone) return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
      });

      const debtorsMap = deliveries.reduce((acc: any, curr: any) => {
        const balance = Number(curr.balance_due) || 0;
        
        // Credit tab logic: ONLY show if they owe money AND the physical delivery is finished!
        if (balance > 0 && curr.delivery_status === 'Delivered' && !isFullyComplete(curr)) {
          let owner = (curr.owner || '').trim();
          if (!owner) owner = 'Unassigned';
          owner = owner.charAt(0).toUpperCase() + owner.slice(1).toLowerCase();

          const key = `${owner}___${curr.customer_name}`; 
          
          if (!acc[key]) {
            acc[key] = { 
              name: curr.customer_name, 
              owner: owner, 
              totalOwed: 0, 
              invoices: [],
              oldestDate: curr.created_at 
            };
          }
          
          acc[key].totalOwed += balance;
          acc[key].invoices.push(curr);
          
          if (new Date(curr.created_at) < new Date(acc[key].oldestDate)) {
             acc[key].oldestDate = curr.created_at;
          }
        }
        return acc;
      }, {});

      const dList = Object.values(debtorsMap).sort((a: any, b: any) => (b as any).totalOwed - (a as any).totalOwed);

      const gDebtors: Record<string, any[]> = dList.reduce((acc: Record<string, any[]>, curr: any) => {
        if (!acc[curr.owner]) acc[curr.owner] = [];
        acc[curr.owner].push(curr);
        return acc;
      }, {} as Record<string, any[]>);

      const ownerOrder = ['Pich', 'Both', 'Jing', 'Mom', 'Unassigned']; 
      const aOwners = Object.keys(gDebtors).sort((a, b) => {
        let idxA = ownerOrder.indexOf(a);
        let idxB = ownerOrder.indexOf(b);
        if (idxA === -1) idxA = 99;
        if (idxB === -1) idxB = 99;
        return idxA - idxB;
      });
      
      return { sortedDeliveries: sorted, debtorsList: dList, groupedDebtors: gDebtors, activeOwners: aOwners };
  }, [deliveries, sortConfig]);

  function sidebarContent() {
    const getPaymentStatusVisual = (inv: any) => {
      const bal = Number(inv.balance_due) || 0;
      const tot = Number(inv.total_sales) || 0;
      if (bal <= 0) return { label: '💳 Paid', color: '#15803d', bg: '#dcfce7' };
      if (bal >= tot) return { label: '⏳ Unpaid', color: '#b91c1c', bg: '#fee2e2' };
      return { label: '💸 Debt', color: '#d97706', bg: '#fef3c7' };
    };

    if (activeTab === 'delivery') {
      
      if (isMobile) {
        const filteredMobileDeliveries = sortedDeliveries.filter((d: any) => {
          if (mobileFilter === 'All') return true;
          if (mobileFilter === 'Pending') return d.delivery_status === 'Pending';
          return d.delivery_status === 'Delivered';
        });

        let lastDateKey = '';

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px', paddingBottom: '40px' }}>
            
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', overflowX: 'auto', paddingBottom: '4px' }} className="hide-scrollbar">
              {['All', 'Pending', 'Delivered'].map(status => (
                <button 
                  key={status}
                  onClick={() => setMobileFilter(status as any)}
                  style={{
                    padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: mobileFilter === status ? '#3b82f6' : '#e2e8f0',
                    color: mobileFilter === status ? '#ffffff' : '#64748b',
                    boxShadow: mobileFilter === status ? '0 2px 6px rgba(59, 130, 246, 0.3)' : 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  {status === 'All' ? 'All Deliveries' : status === 'Pending' ? '🟡 Pending' : '🟢 Delivered'}
                </button>
              ))}
            </div>

            {loading && filteredMobileDeliveries.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', opacity: 0.7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                    <div style={{ background: '#e2e8f0', height: '18px', width: '60%', borderRadius: '4px' }} />
                    <div style={{ background: '#e2e8f0', height: '14px', width: '40%', borderRadius: '4px' }} />
                  </div>
                  <div style={{ background: '#e2e8f0', height: '24px', width: '20%', borderRadius: '4px' }} />
                </div>
              ))
            ) : filteredMobileDeliveries.length === 0 ? (
              <EmptyState icon="🚚" title="No matching deliveries" message="No wholesale deliveries match this filter!" />
            ) : (
              filteredMobileDeliveries.map((d: any) => {
                const isDoneVisual = isDeliveredVisual(d);
                const totalSale = Number(d.total_sales) || 0;
                const balanceDue = Number(d.balance_due) || 0;
                const depositAmount = totalSale - balanceDue; 
                const statusVis = getPaymentStatusVisual(d);
                
                const dateObj = new Date(d.created_at);
                const today = new Date();
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                
                let dateKey = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
                if (dateObj.toDateString() === today.toDateString()) dateKey = 'Today';
                else if (dateObj.toDateString() === yesterday.toDateString()) dateKey = 'Yesterday';

                const showHeader = dateKey !== lastDateKey;
                lastDateKey = dateKey;

                return (
                  <div key={d.invoice_id} style={{ display: 'flex', flexDirection: 'column' }}>
                    {showHeader && (
                      <div style={{ fontSize: '15px', fontWeight: '800', color: '#64748b', marginTop: '12px', marginBottom: '4px', paddingLeft: '4px' }}>
                        {dateKey}
                      </div>
                    )}
                    <div 
                      onClick={() => setSelectedMobileDelivery(d)}
                      style={{ 
                        background: '#fff', borderRadius: '16px', padding: '16px', 
                        boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', 
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        opacity: isDoneVisual ? 0.6 : 1, transition: 'all 0.2s', cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                        <span style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '16px' }}>{d.customer_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{
                              padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold',
                              background: d.delivery_status === 'Pending' ? '#fef3c7' : '#dcfce7',
                              color: d.delivery_status === 'Pending' ? '#d97706' : '#15803d',
                          }}>
                            {d.delivery_status === 'Pending' ? '🟡 Pending' : '🟢 Delivered'}
                          </div>
                          <div style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', background: statusVis.bg, color: statusVis.color }}>
                            {statusVis.label}
                          </div>
                          {depositAmount > 0 && balanceDue > 0 && (
                            <div style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                              💵 Deposited
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '16px' }}>{formatRiel(totalSale)}</span>
                        <span style={{ color: '#3b82f6', fontSize: '12px', fontWeight: 'bold' }}>Pay ➔</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            
            {hasMore && (
              <button onClick={() => setLoadLimit(prev => prev + 100)} className="saas-btn saas-btn-secondary" style={{ borderRadius: '20px', margin: '10px auto', display: 'block', width: '100%' }}>
                ⬇️ Load More
              </button>
            )}
          </div>
        );
      }

      return (
        <div className="saas-table-wrapper" style={{ display: 'flex', flexDirection: 'column', marginTop: isMobile ? '16px' : '0' }}>
          <div className="saas-table-responsive hide-scrollbar" style={{ flex: 1, overflow: 'auto' }}>
            <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'fixed', width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {colOrder.filter(c => !hiddenCols.includes(c)).map((col, index) => {
                    const isSticky = index === 0;
                    return (
                      <th 
                        key={col} 
                        className="saas-th" 
                        style={{ 
                          position: 'sticky', 
                          top: 0, 
                          left: isSticky ? 0 : undefined,
                          zIndex: isSticky ? 40 : 10,
                          backgroundColor: '#f8fafc',
                          boxShadow: isSticky ? '2px 0 5px -2px rgba(0,0,0,0.1), inset 0 -2px 0 0 #cbd5e1' : 'inset 0 -2px 0 0 #cbd5e1',
                          borderRight: '1px solid #cbd5e1',
                          borderLeft: index === 0 ? '1px solid #cbd5e1' : 'none',
                          borderTop: '1px solid #cbd5e1',
                          padding: 0,
                          width: colWidths[col] || DEFAULT_WIDTHS[col] || 150,
                          minWidth: colWidths[col] || DEFAULT_WIDTHS[col] || 150,
                          maxWidth: colWidths[col] || DEFAULT_WIDTHS[col] || 150,
                        }}
                      >
                        <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', alignItems: 'stretch' }}>
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(e, col)}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                            onDrop={(e) => handleDrop(e, col)}
                            onClick={() => handleSort(col)}
                            style={{ 
                              flex: 1, 
                              padding: '12px 16px', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: ['total', 'pay'].includes(col) ? 'flex-end' : ['status', 'method', 'action'].includes(col) ? 'center' : 'flex-start',
                              cursor: 'grab',
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              userSelect: 'none'
                            }}
                          >
                            <span>{COL_LABELS[col]}</span>
                            <span style={{ marginLeft: '6px', fontSize: '10px', opacity: sortConfig?.key === col ? 1 : 0.3 }}>
                              {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </div>
                          <div 
                            onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(e, col); }} 
                            onTouchStart={(e) => { e.stopPropagation(); handleResizeStart(e, col); }} 
                            onClick={(e) => e.stopPropagation()} 
                            // 🔥 UI FIX: Expanded touch target to 24px and disabled native browser touch actions for pure dragging
                            style={{ 
                              position: 'absolute', right: 0, top: 0, bottom: 0, 
                              width: '24px', cursor: 'col-resize', background: 'transparent', 
                              zIndex: 50, transform: 'translateX(50%)', touchAction: 'none'
                            }} 
                          />
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {loading && sortedDeliveries.length === 0 ? (
                  <TableSkeleton columns={colOrder.filter(c => !hiddenCols.includes(c)).length} rows={6} />
                ) : sortedDeliveries.length === 0 ? (
                  <tr>
                    <td colSpan={colOrder.filter(c => !hiddenCols.includes(c)).length} style={{ padding: 0 }}>
                      <EmptyState icon="🚚" title="No active deliveries" message="All wholesale deliveries are perfectly cleared!" />
                    </td>
                  </tr>
                ) : (
                  sortedDeliveries.map((d: any) => {
                    const isDoneVisual = isDeliveredVisual(d);
                    const totalSale = Number(d.total_sales) || 0;
                    const balanceDue = Number(d.balance_due) || 0;
                    const depositAmount = totalSale - balanceDue; 
                    const paymentState = getInlinePaymentState(d.invoice_id, balanceDue);
                    
                    return (
                      <tr key={d.invoice_id} className="saas-tr" style={{ opacity: isDoneVisual ? 0.6 : 1, transition: 'all 0.3s ease' }}>
                        {colOrder.filter(c => !hiddenCols.includes(c)).map((col, index) => {
                          const isSticky = index === 0;
                          const tdStyle: any = { 
                            verticalAlign: 'middle', 
                            position: isSticky ? 'sticky' : undefined,
                            left: isSticky ? 0 : undefined,
                            zIndex: isSticky ? 20 : undefined,
                            backgroundColor: isSticky ? '#ffffff' : 'inherit',
                            boxShadow: isSticky ? '2px 0 5px -2px rgba(0,0,0,0.1)' : 'none',
                            borderRight: isSticky ? '1px solid #e2e8f0' : 'none',
                            overflow: 'hidden',
                            wordWrap: 'break-word',
                            whiteSpace: 'normal'
                          };

                          if (col === 'date') return (
                            <td key={col} className="saas-td" style={tdStyle}>
                              <div style={{ color: '#3b82f6', marginBottom: '4px', fontWeight: 'bold' }}>{d.invoice_id}</div>
                              <div style={{ fontSize: '12px', color: '#64748b' }}>{new Date(d.created_at).toLocaleDateString('en-GB')}</div>
                            </td>
                          );
                          if (col === 'customer') return (
                            <td key={col} className="saas-td" style={tdStyle}>
                              <div style={{ color: '#334155', fontSize: '15px', marginBottom: '4px', fontWeight: 'bold' }}>{d.customer_name}</div>
                              <div style={{ color: '#64748b', fontSize: '12px' }}>📍 {d.customer_location || 'No location'}</div>
                            </td>
                          );
                          if (col === 'items') return <td key={col} className="saas-td" style={{ ...tdStyle, lineHeight: '1.6', fontSize: '13px' }}>{d.rice_types}</td>;
                          if (col === 'total') return (
                            <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'right' }}>
                              <div style={{ color: '#334155', fontSize: '15px', fontWeight: 'bold' }}>{formatRiel(totalSale)}</div>
                              {depositAmount > 0 && balanceDue > 0 && !isDoneVisual && (
                                <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 'bold', marginTop: '4px' }}>
                                  💵 Dep: {formatRiel(depositAmount)}
                                </div>
                              )}
                            </td>
                          );
                          if (col === 'status') return (
                            <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'center' }}>
                              <button 
                                onClick={() => updateInvoiceField(d.invoice_id, 'delivery_status', d.delivery_status === 'Pending' ? 'Delivered' : 'Pending')}
                                style={{
                                  padding: '6px 12px', borderRadius: '20px', border: 'none', fontSize: '12px', cursor: 'pointer',
                                  background: d.delivery_status === 'Pending' ? '#fef3c7' : '#dcfce7',
                                  color: d.delivery_status === 'Pending' ? '#d97706' : '#15803d',
                                  fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', width: 'auto', minWidth: '40px', justifyContent: 'center', margin: '0 auto'
                                }}
                              >
                                {d.delivery_status === 'Pending' ? <>🟡 <span className="desktop-text">Pending</span></> : <>🟢 <span className="desktop-text">Delivered</span></>}
                              </button>
                            </td>
                          );
                          if (col === 'method') return (
                            <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'center' }}>
                              {balanceDue > 0 && !isDoneVisual ? (
                                 <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                   {paymentState.map((row, idx) => (
                                     <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                       <select 
                                          value={row.method} 
                                          onChange={(e) => updateInlineRow(d.invoice_id, row.id, 'method', e.target.value, balanceDue)} 
                                          className="saas-input" 
                                          style={{ flex: 1, padding: '8px', cursor: 'pointer', height: '40px', width: '100%' }}
                                       >
                                          <option value="Cash ៛">💵 Cash ៛</option>
                                          <option value="Cash $">💵 Cash $</option>
                                          <option value="QR ៛">📱 QR ៛</option>
                                          <option value="QR $">📱 QR $</option>
                                          <option value="Mom QR ៛">👩 Mom QR ៛</option>
                                          <option value="Mom QR $">👩 Mom QR $</option>
                                       </select>
                                       {idx === paymentState.length - 1 ? (
                                         <button onClick={() => addInlineSplit(d.invoice_id, balanceDue)} style={{ background: '#e0f2fe', border: 'none', borderRadius: '6px', color: '#0ea5e9', width: '32px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '20px', flexShrink: 0 }}>+</button>
                                       ) : (
                                         <div style={{ width: '32px', flexShrink: 0 }} />
                                       )}
                                     </div>
                                   ))}
                                 </div>
                              ) : (
                                <div style={{ color: '#475569', fontSize: '13px' }}>{d.payment_method}</div>
                              )}
                            </td>
                          );
                          if (col === 'pay') return (
                            <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'right' }}>
                              {balanceDue > 0 && !isDoneVisual ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {paymentState.map((row) => (
                                    <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '40px' }}>
                                      <CurrencyInput 
                                        placeholder={formatRiel(balanceDue)} 
                                        value={row.amount} 
                                        onChange={(v: any) => updateInlineRow(d.invoice_id, row.id, 'amount', v, balanceDue)} 
                                        onFocus={() => { if (!row.amount || Number(String(row.amount).replace(/,/g, '')) === balanceDue) updateInlineRow(d.invoice_id, row.id, 'amount', '', balanceDue); }}
                                        onClick={() => { if (!row.amount || Number(String(row.amount).replace(/,/g, '')) === balanceDue) updateInlineRow(d.invoice_id, row.id, 'amount', '', balanceDue); }}
                                        onEnter={() => handleInlineProcess(d, paymentState)} 
                                        className="saas-input" 
                                        style={{ padding: '8px 12px', textAlign: 'right', height: '100%' }} 
                                      />
                                      {paymentState.length > 1 && (
                                        <button onClick={() => removeInlineSplit(d.invoice_id, row.id, balanceDue)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0 4px', fontWeight: 'bold' }}>✕</button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                          );
                          if (col === 'action') return (
                            <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'center' }}>
                              <button 
                                onClick={() => { if (isDoneVisual) handleUndoProcess(d); else handleInlineProcess(d, paymentState); }}
                                disabled={isProcessing}
                                className={`saas-btn ${isDoneVisual ? 'saas-btn-secondary' : 'saas-btn-primary'}`}
                                style={{ width: '100%', height: '40px' }}
                              >
                                {isProcessing ? '...' : isDoneVisual ? 'Undo' : '✔'}
                              </button>
                            </td>
                          );
                          return null;
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '20px', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
              <button onClick={() => setLoadLimit(prev => prev + 100)} className="saas-btn saas-btn-secondary" style={{ borderRadius: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                ⬇️ Load More Completed Invoices
              </button>
            </div>
          )}
        </div>
      );
    }

    // ==========================================
    // CREDIT TAB LOGIC
    // ==========================================
    const filteredOwners = activeOwners.filter(ownerName => {
      if (creditFilter === 'Mom') return ownerName === 'Mom';
      if (creditFilter === 'Jing') return ownerName === 'Jing';
      if (creditFilter === 'Pich/Both') return ['Pich', 'Both'].includes(ownerName);
      if (creditFilter === 'All') return true;
      return true;
    });

    if (isMobile) {
      const flatMobileCredit = filteredOwners
        .flatMap(ownerName => {
          const list = groupedDebtors[ownerName] || [];
          return list.flatMap((debtor: any) => 
            debtor.invoices.map((inv: any) => ({
              ...inv,
              debtorName: debtor.name,
              debtorTotalOwed: debtor.totalOwed,
              ownerName
            }))
          );
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      let lastDateKey = '';

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px', paddingBottom: '40px' }}>
          
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', overflowX: 'auto', paddingBottom: '4px' }} className="hide-scrollbar">
            {['Pich/Both', 'Jing', 'Mom', 'All'].map(status => (
              <button 
                key={status}
                onClick={() => setCreditFilter(status as any)}
                style={{
                  padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: creditFilter === status ? '#3b82f6' : '#e2e8f0',
                  color: creditFilter === status ? '#ffffff' : '#64748b',
                  boxShadow: creditFilter === status ? '0 2px 6px rgba(59, 130, 246, 0.3)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                {status}
              </button>
            ))}
          </div>

          {loading && flatMobileCredit.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', opacity: 0.7 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                  <div style={{ background: '#e2e8f0', height: '18px', width: '60%', borderRadius: '4px' }} />
                  <div style={{ background: '#e2e8f0', height: '14px', width: '40%', borderRadius: '4px' }} />
                </div>
                <div style={{ background: '#e2e8f0', height: '24px', width: '20%', borderRadius: '4px' }} />
              </div>
            ))
          ) : flatMobileCredit.length === 0 ? (
            <EmptyState icon="💰" title="All caught up!" message="No credit matches this filter!" />
          ) : (
            flatMobileCredit.map((inv: any) => {
              const invBalance = Number(inv.balance_due) || 0;
              const totalSale = Number(inv.total_sales) || 0;
              const depositAmount = totalSale - invBalance; 

              const paymentState = getInlinePaymentState(inv.invoice_id, invBalance);
              
              const daysOwed = Math.floor((new Date().getTime() - new Date(inv.created_at).getTime()) / (1000 * 3600 * 24));
              const isExpanded = expandedCredit === inv.invoice_id;

              const dateObj = new Date(inv.created_at);
              const today = new Date();
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              
              let dateKey = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
              if (dateObj.toDateString() === today.toDateString()) dateKey = 'Today';
              else if (dateObj.toDateString() === yesterday.toDateString()) dateKey = 'Yesterday';

              const showHeader = dateKey !== lastDateKey;
              lastDateKey = dateKey;

              return (
                <div key={inv.invoice_id} style={{ display: 'flex', flexDirection: 'column' }}>
                  {showHeader && (
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#64748b', marginTop: '12px', marginBottom: '4px', paddingLeft: '4px' }}>
                      {dateKey}
                    </div>
                  )}
                  <div 
                    onClick={() => setExpandedCredit(isExpanded ? null : inv.invoice_id)}
                    style={{ 
                      background: '#fff', borderRadius: '16px', padding: '16px', 
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', 
                      display: 'flex', flexDirection: 'column', gap: '16px',
                      transition: 'all 0.2s', cursor: 'pointer', marginBottom: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                        <span style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '15px' }}>👤 {inv.debtorName}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 'bold', color: '#3b82f6', fontSize: '13px' }}>#{inv.invoice_id.replace('INV-', '')}</span>
                          <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 'bold', background: '#fee2e2', padding: '4px 8px', borderRadius: '12px' }}>
                            ⏳ {daysOwed} Days
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span style={{ fontWeight: 'bold', color: '#ef4444', fontSize: '16px' }}>{formatRiel(invBalance)}</span>
                        {depositAmount > 0 && (
                          <span style={{ color: '#10b981', fontSize: '11px', fontWeight: 'bold' }}>💵 Dep: {formatRiel(depositAmount)}</span>
                        )}
                        <span style={{ color: '#3b82f6', fontSize: '12px', fontWeight: 'bold' }}>{isExpanded ? 'Close ▴' : 'Settle ▾'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div onClick={(e) => e.stopPropagation()} style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {paymentState.map((row: any, idx: number) => (
                            <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <select 
                                value={row.method} 
                                onChange={(e) => updateInlineRow(inv.invoice_id, row.id, 'method', e.target.value, invBalance)} 
                                className="saas-input" 
                                style={{ flex: 1, padding: '12px', cursor: 'pointer', height: '48px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#fff' }}
                              >
                                <option value="Cash ៛">💵 Cash ៛</option>
                                <option value="Cash $">💵 Cash $</option>
                                <option value="QR ៛">📱 QR ៛</option>
                                <option value="QR $">📱 QR $</option>
                                <option value="Mom QR ៛">👩 Mom QR ៛</option>
                                <option value="Mom QR $">👩 Mom QR $</option>
                              </select>
                              <CurrencyInput 
                                placeholder={formatRiel(invBalance)} 
                                value={row.amount} 
                                onChange={(v: any) => updateInlineRow(inv.invoice_id, row.id, 'amount', v, invBalance)} 
                                onFocus={() => { if (!row.amount || String(row.amount).replace(/,/g, '') === String(invBalance)) updateInlineRow(inv.invoice_id, row.id, 'amount', '', invBalance); }}
                                onClick={() => { if (!row.amount || String(row.amount).replace(/,/g, '') === String(invBalance)) updateInlineRow(inv.invoice_id, row.id, 'amount', '', invBalance); }}
                                onEnter={() => {}} 
                                className="saas-input" 
                                style={{ flex: 1, padding: '12px', textAlign: 'right', height: '48px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#fff' }} 
                              />
                              {idx === paymentState.length - 1 ? (
                                <button onClick={() => addInlineSplit(inv.invoice_id, invBalance)} style={{ background: '#e0f2fe', border: 'none', borderRadius: '12px', color: '#0ea5e9', width: '48px', height: '48px', fontWeight: 'bold', fontSize: '24px', flexShrink: 0 }}>+</button>
                              ) : (
                                <button onClick={() => removeInlineSplit(inv.invoice_id, row.id, invBalance)} style={{ background: '#fee2e2', border: 'none', borderRadius: '12px', color: '#ef4444', width: '48px', height: '48px', fontWeight: 'bold', fontSize: '18px', flexShrink: 0 }}>✕</button>
                              )}
                            </div>
                        ))}
                        <button 
                          onClick={() => { handleProcessCreditPayment(inv, paymentState); setExpandedCredit(null); }}
                          disabled={isProcessing}
                          className="saas-btn saas-btn-primary"
                          style={{ width: '100%', height: '48px', borderRadius: '12px', marginTop: '4px' }}
                        >
                          {isProcessing ? 'Processing...' : '✔ Confirm Payment'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      );
    }

    return (
      <div className="saas-table-wrapper" style={{ display: 'flex', flexDirection: 'column', marginTop: isMobile ? '16px' : '0' }}>
        
        <div style={{ display: 'flex', gap: '8px', padding: '16px 24px', borderBottom: '1px solid #e2e8f0', background: '#fff', borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
          <span style={{ fontWeight: 'bold', color: '#64748b', marginRight: '8px', alignSelf: 'center' }}>Filter:</span>
          {['Pich/Both', 'Jing', 'Mom', 'All'].map(status => (
            <button 
              key={status}
              onClick={() => setCreditFilter(status as any)}
              style={{
                padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold', border: 'none', cursor: 'pointer',
                background: creditFilter === status ? '#3b82f6' : '#f1f5f9',
                color: creditFilter === status ? '#ffffff' : '#64748b',
                transition: 'all 0.2s'
              }}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="saas-table-responsive hide-scrollbar" style={{ flex: 1, overflow: 'auto' }}>
          <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'fixed', width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead style={{ background: '#fff1f2' }}>
              <tr>
                {colOrder.filter(c => !hiddenCols.includes(c) && c !== 'status').map((col, index) => {
                  const isSticky = index === 0;
                  return (
                    <th 
                      key={col} 
                      className="saas-th" 
                      style={{ 
                        position: 'sticky', 
                        top: 0, 
                        left: isSticky ? 0 : undefined,
                        zIndex: isSticky ? 40 : 30,
                        backgroundColor: '#fff1f2',
                        boxShadow: isSticky ? '2px 0 5px -2px rgba(0,0,0,0.1), inset 0 -2px 0 0 #fecaca' : 'inset 0 -2px 0 0 #fecaca',
                        borderRight: '1px solid #ffe4e6',
                        borderLeft: index === 0 ? '1px solid #ffe4e6' : 'none',
                        borderTop: '1px solid #ffe4e6',
                        borderBottom: '1px solid #ffe4e6',
                        padding: 0,
                        width: colWidths[col] || DEFAULT_WIDTHS[col] || 150,
                        minWidth: colWidths[col] || DEFAULT_WIDTHS[col] || 150,
                        maxWidth: colWidths[col] || DEFAULT_WIDTHS[col] || 150,
                        color: '#be123c',
                      }}
                    >
                      <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', alignItems: 'stretch' }}>
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, col)}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => handleDrop(e, col)}
                          onClick={() => handleSort(col)}
                          style={{ 
                            flex: 1, 
                            padding: '12px 16px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: ['total', 'pay'].includes(col) ? 'flex-end' : ['method', 'action'].includes(col) ? 'center' : 'flex-start',
                            cursor: 'grab',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            userSelect: 'none',
                            fontWeight: 'bold'
                          }}
                        >
                          <span>{col === 'total' ? 'Debt (៛)' : COL_LABELS[col]}</span>
                          <span style={{ marginLeft: '6px', fontSize: '10px', opacity: sortConfig?.key === col ? 1 : 0.3 }}>
                            {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </div>
                        <div 
                          onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(e, col); }} 
                          onTouchStart={(e) => { e.stopPropagation(); handleResizeStart(e, col); }} 
                          onClick={(e) => e.stopPropagation()} 
                          style={{ 
                            position: 'absolute', right: 0, top: 0, bottom: 0, 
                            width: '14px', cursor: 'col-resize', background: 'transparent', 
                            zIndex: 50, transform: 'translateX(50%)' 
                          }} 
                        />
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            
            {loading && filteredOwners.length === 0 ? (
              <tbody>
                 <TableSkeleton columns={colOrder.filter(c => !hiddenCols.includes(c) && c !== 'status').length} rows={6} />
              </tbody>
            ) : filteredOwners.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={colOrder.filter(c => !hiddenCols.includes(c) && c !== 'status').length} style={{ padding: 0 }}>
                    <EmptyState icon="💰" title="All caught up!" message="All customers are fully paid up on their delivered orders!" />
                  </td>
                </tr>
              </tbody>
            ) : (
              filteredOwners.map(ownerName => {
                const list = groupedDebtors[ownerName];
                const ownerTotalOwed = list.reduce((sum: number, d: any) => sum + d.totalOwed, 0);
                const visibleCols = colOrder.filter(c => !hiddenCols.includes(c) && c !== 'status');
                const totalColCount = visibleCols.length;
                const debtColIndex = visibleCols.indexOf('total');
                
                return (
                  <tbody key={ownerName}>
                    {creditFilter === 'All' && (
                      <tr className="saas-tr" style={{ background: '#f1f5f9' }}>
                        {debtColIndex > 0 && (
                          <td className="saas-td" colSpan={debtColIndex} style={{ fontWeight: 'bold', verticalAlign: 'middle', position: 'sticky', left: 0, zIndex: 20, backgroundColor: '#f1f5f9', borderRight: '1px solid #e2e8f0', padding: '12px 16px' }}>
                            👤 Owner: {ownerName}
                          </td>
                        )}
                        {debtColIndex === 0 && (
                          <td className="saas-td" style={{ fontWeight: 'bold', verticalAlign: 'middle', position: 'sticky', left: 0, zIndex: 20, backgroundColor: '#f1f5f9', borderRight: '1px solid #e2e8f0', padding: '12px 16px' }}>
                            👤 Owner: {ownerName}
                          </td>
                        )}
                        {debtColIndex !== -1 ? (
                          <td className="saas-td" style={{ textAlign: 'right', color: '#334155', fontSize: '15px', fontWeight: 'bold', verticalAlign: 'middle', padding: '12px 16px' }}>
                            {formatRiel(ownerTotalOwed)}
                          </td>
                        ) : (
                          <td className="saas-td" colSpan={totalColCount > 0 ? totalColCount : 1} style={{ textAlign: 'right', color: '#334155', fontSize: '15px', fontWeight: 'bold', verticalAlign: 'middle', padding: '12px 16px' }}>
                            👤 Owner: {ownerName} - {formatRiel(ownerTotalOwed)}
                          </td>
                        )}
                        {debtColIndex !== -1 && totalColCount - debtColIndex - 1 > 0 && (
                          <td className="saas-td" colSpan={totalColCount - debtColIndex - 1} style={{ padding: '12px 16px', background: '#f1f5f9' }}></td>
                        )}
                      </tr>
                    )}
                    {list.map((debtor: any) => {
                      let sortedInvoices = [...debtor.invoices];
                      if (sortConfig) {
                         sortedInvoices.sort((a, b) => {
                           let valA = a[sortConfig.key] || '';
                           let valB = b[sortConfig.key] || '';
                           if (sortConfig.key === 'customer') { valA = a.customer_name; valB = b.customer_name; }
                           if (sortConfig.key === 'date') { valA = new Date(a.created_at).getTime(); valB = new Date(b.created_at).getTime(); }
                           if (sortConfig.key === 'total') { valA = Number(a.balance_due); valB = Number(b.balance_due); }
                           if (sortConfig.key === 'items') { valA = a.rice_types; valB = b.rice_types; }
                           if (sortConfig.key === 'method') { valA = a.payment_method; valB = b.payment_method; }
                           if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                           if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                           return 0;
                         });
                      }

                      return sortedInvoices.map((inv: any, i: number) => {
                        const invBalance = Number(inv.balance_due) || 0;
                        const totalSale = Number(inv.total_sales) || 0;
                        const depositAmount = totalSale - invBalance;
                        const paymentState = getInlinePaymentState(inv.invoice_id, invBalance);
                        
                        return (
                          <tr key={inv.invoice_id} className="saas-tr" style={{ transition: 'background 0.2s ease', backgroundColor: '#ffffff' }}>
                            {visibleCols.map((col, index) => {
                              const isSticky = index === 0;
                              const tdStyle: any = { 
                                verticalAlign: 'middle', 
                                position: isSticky ? 'sticky' : undefined,
                                left: isSticky ? 0 : undefined,
                                zIndex: isSticky ? 20 : undefined,
                                backgroundColor: isSticky ? '#ffffff' : 'inherit',
                                boxShadow: isSticky ? '2px 0 5px -2px rgba(0,0,0,0.05)' : 'none',
                                borderRight: isSticky ? '1px solid #e2e8f0' : 'none',
                                borderBottom: '1px solid #f8fafc',
                                overflow: 'hidden',
                                wordWrap: 'break-word',
                                whiteSpace: 'normal',
                                padding: '12px 16px'
                              };

                              if (col === 'customer') {
                                if (i === 0) {
                                  return (
                                    <td key={col} className="saas-td" rowSpan={debtor.invoices.length} style={{ ...tdStyle, borderBottom: '1px solid #e2e8f0' }}>
                                      <div style={{ color: '#334155', fontSize: '15px', marginBottom: '4px', fontWeight: 'bold' }}>{debtor.name}</div>
                                      <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: 'bold' }}>Total Debt: {formatRiel(debtor.totalOwed)}</div>
                                    </td>
                                  );
                                }
                                return null;
                              }

                              if (col === 'date') return (
                                <td key={col} className="saas-td" style={tdStyle}>
                                  <div style={{ color: '#3b82f6', fontWeight: 'bold', marginBottom: '4px' }}>#{inv.invoice_id.replace('INV-', '')}</div>
                                  <div style={{ fontSize: '12px', color: '#64748b' }}>{new Date(inv.created_at).toLocaleDateString('en-GB')}</div>
                                </td>
                              );

                              if (col === 'items') return (
                                <td key={col} className="saas-td" style={{ ...tdStyle, fontSize: '13px', lineHeight: '1.6', color: '#334155' }}>
                                  {inv.rice_types}
                                </td>
                              );

                              if (col === 'total') return (
                                <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'right' }}>
                                  <div style={{ color: '#ef4444', fontSize: '15px', fontWeight: 'bold' }}>{formatRiel(invBalance)}</div>
                                  {depositAmount > 0 && (
                                    <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 'bold', marginTop: '4px' }}>
                                      💵 Dep: {formatRiel(depositAmount)}
                                    </div>
                                  )}
                                </td>
                              );

                              if (col === 'method') return (
                                <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'center' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {paymentState.map((row: any, idx: number) => (
                                      <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <select 
                                          value={row.method}
                                          onChange={(e) => updateInlineRow(inv.invoice_id, row.id, 'method', e.target.value, invBalance)}
                                          className="saas-input"
                                          style={{ flex: 1, padding: '8px 12px', cursor: 'pointer', height: '40px', width: '100%' }}
                                        >
                                           <option value="Cash ៛">💵 Cash ៛</option>
                                           <option value="Cash $">💵 Cash $</option>
                                           <option value="QR ៛">📱 QR ៛</option>
                                           <option value="QR $">📱 QR $</option>
                                           <option value="Mom QR ៛">👩 Mom QR ៛</option>
                                           <option value="Mom QR $">👩 Mom QR $</option>
                                        </select>
                                        {idx === paymentState.length - 1 ? (
                                          <button onClick={() => addInlineSplit(inv.invoice_id, invBalance)} style={{ background: '#e0f2fe', border: 'none', borderRadius: '6px', color: '#0ea5e9', width: '32px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '20px', flexShrink: 0 }}>+</button>
                                        ) : (
                                          <div style={{ width: '32px', flexShrink: 0 }} />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              );

                              if (col === 'pay') return (
                                <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'right' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {paymentState.map((row: any) => (
                                      <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '40px' }}>
                                        <CurrencyInput
                                          placeholder={formatRiel(invBalance)}
                                          value={row.amount}
                                          onChange={(v: any) => updateInlineRow(inv.invoice_id, row.id, 'amount', v, invBalance)}
                                          onFocus={() => { if (!row.amount || Number(String(row.amount).replace(/,/g, '')) === invBalance) updateInlineRow(inv.invoice_id, row.id, 'amount', '', invBalance); }}
                                          onClick={() => { if (!row.amount || Number(String(row.amount).replace(/,/g, '')) === invBalance) updateInlineRow(inv.invoice_id, row.id, 'amount', '', invBalance); }}
                                          onEnter={() => handleProcessCreditPayment({ owner: debtor.owner, invoices: [inv] }, paymentState)}
                                          className="saas-input"
                                          style={{ padding: '8px 12px', textAlign: 'right', height: '100%' }}
                                        />
                                        {paymentState.length > 1 && (
                                          <button onClick={() => removeInlineSplit(inv.invoice_id, row.id, invBalance)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0 4px', fontWeight: 'bold' }}>✕</button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              );

                              if (col === 'action') return (
                                <td key={col} className="saas-td" style={{ ...tdStyle, textAlign: 'center' }}>
                                  <button 
                                    onClick={() => handleProcessCreditPayment({ owner: debtor.owner, invoices: [inv] }, paymentState)}
                                    disabled={isProcessing}
                                    className="saas-btn saas-btn-primary"
                                    style={{ width: '100%', height: '40px' }}
                                  >
                                    {isProcessing ? '...' : '✔'}
                                  </button>
                                </td>
                              );

                              return null;
                            })}
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}>
      
      <div className="header-container" style={{ flexShrink: 0, position: 'relative' }}>
        <div className="header-left">
          <h1 className="saas-page-title" style={{ margin: 0 }}>🚚 Delivery & Credit Hub</h1>
        </div>
        
        {!isMobile && (
          <div className="header-actions" style={{ marginLeft: 'auto', position: 'relative' }}>
            <button onClick={() => setShowColMenu(!showColMenu)} className="saas-btn saas-btn-secondary" style={{ fontSize: '13px', padding: '6px 12px' }}>
              ⚙️ Columns
            </button>
            {showColMenu && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#fff', border: '1px solid #e2e8f0', padding: '8px', zIndex: 999, borderRadius: '8px', width: '200px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                 {DEFAULT_DELIVERY_COLS.filter(col => activeTab === 'delivery' || col !== 'status').map(col => (
                   <label key={col} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer', fontSize: '13px', color: '#334155', borderBottom: '1px solid #f8fafc' }}>
                     <input type="checkbox" checked={!hiddenCols.includes(col)} onChange={() => toggleCol(col)} style={{ accentColor: '#3b82f6', width: '14px', height: '14px' }} />
                     {col === 'total' && activeTab === 'credit' ? 'Debt (៛)' : COL_LABELS[col]}
                   </label>
                 ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="content-container" style={{ flexShrink: 0, paddingBottom: '16px', touchAction: 'pan-x' }}>
        <div className="saas-tab-container hide-scrollbar" style={{ width: 'fit-content', border: '1px solid #e2e8f0', background: '#fff', borderRadius: '12px', padding: '6px', margin: 0, display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <button onClick={() => setActiveTab('delivery')} className={`saas-tab ${activeTab === 'delivery' ? 'active' : ''}`} style={{ flexShrink: 0, padding: '10px 24px' }}>📦 Delivery Queue</button>
          <button onClick={() => setActiveTab('credit')} className={`saas-tab ${activeTab === 'credit' ? 'active' : ''}`} style={{ flexShrink: 0, padding: '10px 24px' }}>💰 Accounts Credit ({debtorsList.length})</button>
        </div>
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', paddingBottom: '40px' }}>
        <div className="content-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {sidebarContent()}
        </div>
      </div>

      {selectedMobileDelivery && (() => {
        const d = deliveries.find(inv => inv.invoice_id === selectedMobileDelivery.invoice_id) || selectedMobileDelivery;
        const isDoneVisual = isDeliveredVisual(d);
        const balanceDue = Number(d.balance_due) || 0;
        const totalSale = Number(d.total_sales) || 0;
        const depositAmount = totalSale - balanceDue;
        const paymentState = getInlinePaymentState(d.invoice_id, balanceDue);

        return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
             <div 
               onClick={() => setSelectedMobileDelivery(null)} 
               style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)' }} 
             />
             
             <div style={{ position: 'relative', backgroundColor: '#ffffff', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', padding: '24px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 -10px 25px rgba(0,0,0,0.1)' }}>
               
               <div style={{ width: '40px', height: '5px', backgroundColor: '#e2e8f0', borderRadius: '3px', margin: '0 auto 24px' }} />
               
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                 <div>
                   <h2 style={{ margin: 0, color: '#0f172a', fontSize: '22px', fontWeight: '800' }}>{d.customer_name}</h2>
                   <div style={{ color: '#64748b', fontSize: '13px', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                     📍 {d.customer_location || 'No location provided'}
                   </div>
                 </div>
                 <button 
                   onClick={() => updateInvoiceField(d.invoice_id, 'delivery_status', d.delivery_status === 'Pending' ? 'Delivered' : 'Pending')}
                   style={{
                     padding: '8px 14px', borderRadius: '20px', border: 'none', fontSize: '13px', cursor: 'pointer',
                     background: d.delivery_status === 'Pending' ? '#fef3c7' : '#dcfce7',
                     color: d.delivery_status === 'Pending' ? '#d97706' : '#15803d',
                     fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                   }}
                 >
                   {d.delivery_status === 'Pending' ? '🟡 Pending' : '🟢 Delivered'}
                 </button>
               </div>

               <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                   <span style={{ color: '#64748b' }}>Invoice & Date</span>
                   <span style={{ fontWeight: 'bold', color: '#334155' }}>{d.invoice_id} • {new Date(d.created_at).toLocaleDateString('en-GB')}</span>
                 </div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                   <span style={{ color: '#64748b' }}>Items Ordered</span>
                   <span style={{ fontWeight: 'bold', color: '#334155', textAlign: 'right', maxWidth: '65%' }}>{d.rice_types}</span>
                 </div>
                 
                 {depositAmount > 0 && balanceDue > 0 && !isDoneVisual && (
                   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                     <span style={{ color: '#10b981', fontWeight: 'bold' }}>Deposited Upfront</span>
                     <span style={{ fontWeight: 'bold', color: '#10b981', textAlign: 'right' }}>- {formatRiel(depositAmount)}</span>
                   </div>
                 )}

                 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', marginTop: '4px', paddingTop: '16px', borderTop: '1px dashed #cbd5e1' }}>
                   <span style={{ color: '#64748b', fontWeight: 'bold' }}>Gross Total</span>
                   <span style={{ fontWeight: '800', color: '#0f172a' }}>{formatRiel(totalSale)}</span>
                 </div>
               </div>

               <div style={{ marginBottom: '8px' }}>
                 <h3 style={{ fontSize: '14px', color: '#64748b', marginBottom: '12px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Payment Collection</h3>
                 
                 {balanceDue > 0 && !isDoneVisual ? (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                     {paymentState.map((row, index) => (
                       <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                         
                         <select 
                            value={row.method} 
                            onChange={(e) => updateInlineRow(d.invoice_id, row.id, 'method', e.target.value, balanceDue)} 
                            className="saas-input" 
                            style={{ flex: 1, padding: '12px', cursor: 'pointer', height: '48px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#fff' }}
                         >
                            <option value="Cash ៛">💵 Cash ៛</option>
                            <option value="Cash $">💵 Cash $</option>
                            <option value="QR ៛">📱 QR ៛</option>
                            <option value="QR $">📱 QR $</option>
                            <option value="Mom QR ៛">👩 Mom QR ៛</option>
                            <option value="Mom QR $">👩 Mom QR $</option>
                         </select>
                         
                         <CurrencyInput 
                            placeholder={formatRiel(balanceDue)} 
                            value={row.amount} 
                            onChange={(v: any) => updateInlineRow(d.invoice_id, row.id, 'amount', v, balanceDue)} 
                            onFocus={() => { if (!row.amount || Number(String(row.amount).replace(/,/g, '')) === balanceDue) updateInlineRow(d.invoice_id, row.id, 'amount', '', balanceDue); }}
                            onClick={() => { if (!row.amount || Number(String(row.amount).replace(/,/g, '')) === balanceDue) updateInlineRow(d.invoice_id, row.id, 'amount', '', balanceDue); }}
                            onEnter={() => {}} 
                            className="saas-input" 
                            style={{ flex: 1, padding: '12px', textAlign: 'right', height: '48px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#fff' }} 
                         />
                         
                         {index === paymentState.length - 1 ? (
                           <button onClick={() => addInlineSplit(d.invoice_id, balanceDue)} style={{ background: '#e0f2fe', border: 'none', borderRadius: '12px', color: '#0ea5e9', width: '48px', height: '48px', fontWeight: 'bold', fontSize: '24px', flexShrink: 0, boxShadow: '0 2px 4px rgba(14, 165, 233, 0.1)' }}>+</button>
                         ) : (
                           <button onClick={() => removeInlineSplit(d.invoice_id, row.id, balanceDue)} style={{ background: '#fee2e2', border: 'none', borderRadius: '12px', color: '#ef4444', width: '48px', height: '48px', fontWeight: 'bold', fontSize: '18px', flexShrink: 0 }}>✕</button>
                         )}
                       </div>
                     ))}
                   </div>
                 ) : (
                   <div style={{ padding: '16px', background: '#f1f5f9', borderRadius: '12px', color: '#475569', fontSize: '15px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                     Payment fully settled via: <strong style={{ color: '#0f172a' }}>{d.payment_method}</strong>
                   </div>
                 )}
               </div>

               <button 
                 onClick={async () => { 
                   if (isDoneVisual) {
                     await handleUndoProcess(d);
                   } else {
                     await handleInlineProcess(d, paymentState); 
                     setSelectedMobileDelivery(null); 
                   }
                 }}
                 disabled={isProcessing}
                 className={`saas-btn ${isDoneVisual ? 'saas-btn-secondary' : 'saas-btn-primary'}`}
                 style={{ 
                   width: '100%', height: '56px', fontSize: '16px', marginTop: '24px', borderRadius: '16px',
                   boxShadow: isDoneVisual ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.2)'
                 }}
               >
                 {isProcessing ? 'Processing...' : isDoneVisual ? 'Undo Payment' : '✔ Confirm & Complete'}
               </button>
             </div>
          </div>
        );
      })()}

      <style jsx global>{`
        html, body {
          overscroll-behavior: none !important;
          height: 100dvh;
          width: 100vw;
          overflow: hidden;
          margin: 0;
          padding: 0;
        }

        body {
          font-variant-numeric: tabular-nums lining-nums;
        }

        input, select, button, textarea {
          font-family: inherit;
          font-variant-numeric: tabular-nums lining-nums;
        }

        .content-container {
          width: 100%;
          max-width: 1600px;
          margin: 0 auto;
          box-sizing: border-box;
          padding: 0 24px;
        }

        .header-container { 
          display: flex;
          justify-content: flex-start;
          align-items: center; 
          margin-bottom: 16px; 
          margin-top: 0;
          margin-left: 60px; 
          gap: 12px;
          min-height: 48px; 
          width: calc(100% - 60px); 
          max-width: 1600px;
          padding-right: 24px;
          box-sizing: border-box;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        input[type="text"].no-spinners::-webkit-inner-spin-button,
        input[type="text"].no-spinners::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        @media (max-width: 1023px) { 
          .desktop-text { display: none !important; }

          .content-container {
            padding: 0 !important;
          }

          .header-container { 
            margin-left: 54px !important; 
            margin-right: 0 !important;
            margin-bottom: 16px !important; 
            margin-top: 0 !important;
            display: flex !important;
            flex-direction: row !important;
            justify-content: flex-start !important;
            align-items: center !important; 
            min-height: 44px !important;
            width: calc(100% - 54px) !important;
            padding-right: 16px !important;
          }

          .header-left {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 12px !important;
          }
        }
      `}</style>
    </div>
  );
}