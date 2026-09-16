'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import * as htmlToImage from 'html-to-image'
import { useFocusRefresh } from '@/lib/useFocusRefresh'
import { useToast } from '@/components/ToastProvider'
import { formatRiel, parseOwner, EXCHANGE_RATE } from '@/utils/formatters'
import { CurrencyInput } from '@/components/Inputs'
import { PaymentRow } from '@/types'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext' // 🔥 GLOBAL MEMORY IMPORTED

export default function CogsReportPage() {
  const { showToast } = useToast();
  const { activeBranchId } = useBranch(); // 🔥 TUNED INTO RADIO TOWER

  const [sales, setSales] = useState<any[]>([])
  const [retailSales, setRetailSales] = useState<any[]>([])
  const [cogsSettlements, setCogsSettlements] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // App Settings (Liability to Mom)
  const [persOweRiel, setPersOweRiel] = useState<number>(0)
  const [persOweUsd, setPersOweUsd] = useState<number>(0)
  const [liveMomLiability, setLiveMomLiability] = useState<number>(0) 

  // Navigation States
  const [activeMainTab, setActiveMainTab] = useState<'report' | 'pending' | 'history'>('report')
  const [activeOwnerTab, setActiveOwnerTab] = useState<'mom' | 'others'>('mom')
  const [timeFilter, setTimeFilter] = useState<'today' | 'week' | 'month' | 'all'>('month')
  
  const [isCapturing, setIsCapturing] = useState(false)
  const [isSendingTelegram, setIsSendingTelegram] = useState(false)
  
  const reportRef = useRef<HTMLDivElement>(null)

  // Report Specific Dates
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  // Bulk Settlement States
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkPaymentRows, setBulkPaymentRows] = useState<PaymentRow[]>([{ id: Date.now(), method: 'Mom Liability ៛', amount: '' }]);
  const [isProcessing, setIsProcessing] = useState(false)

  // Inline History States
  const [inlinePayments, setInlinePayments] = useState<Record<string, PaymentRow[]>>({})

  useEffect(() => {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, 10);
    setFromDate(localISOTime);
    setToDate(localISOTime);
  }, [])

  // 🔥 CLOSURE FIX: Wrap fetchReportData in useCallback so it dynamically binds to the active branch
  const fetchReportData = useCallback(async () => {
    setLoading(true)
    
    // 1. Dynamically calculate the Database Date Range based on the active tab
    let queryStart = `${fromDate}T00:00:00`;
    let queryEnd = `${toDate}T23:59:59`;

    if (activeMainTab !== 'report') {
      const today = new Date();
      today.setHours(0,0,0,0);
      const todayStr = today.toISOString().split('T')[0];
      queryEnd = `${todayStr}T23:59:59`;

      if (timeFilter === 'today') {
          queryStart = `${todayStr}T00:00:00`;
      } else if (timeFilter === 'week') {
          const lastWeek = new Date(today);
          lastWeek.setDate(lastWeek.getDate() - 7);
          queryStart = `${lastWeek.toISOString().split('T')[0]}T00:00:00`;
      } else if (timeFilter === 'month') {
          queryStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;
      } else {
          queryStart = '2020-01-01T00:00:00'; // All time fallback
      }
    }

    const startJustDate = queryStart.split('T')[0];
    const endJustDate = queryEnd.split('T')[0];

    // 🔥 NEW PHASE 4: HIGH-SPEED RPC AGGREGATION ENGINE 🔥
    // Instead of downloading everything just to do the math, we ask Supabase to do it for us
    await supabase.rpc('get_optimized_sales_metrics', {
      p_branch_id: activeBranchId,
      p_start_date: queryStart
    });

    // 2. Fetch Visual Data (Only what we explicitly need to render the screen)
    const [
      { data: sData }, 
      { data: rDataView }, 
      { data: cDataView }, 
      { data: liabilityData }
    ] = await Promise.all([
        // 🔥 VIEW DATA: Only fetches exact date range required
        supabase.from('sales').select('*').gte('created_at', queryStart).lte('created_at', queryEnd).eq('branch_id', activeBranchId).order('created_at', { ascending: false }),
        supabase.from('retail_sales').select('*').gte('created_at', queryStart).lte('created_at', queryEnd).eq('branch_id', activeBranchId).order('created_at', { ascending: false }),
        supabase.from('cogs_settlements').select('*').gte('settlement_date', startJustDate).lte('settlement_date', endJustDate).eq('branch_id', activeBranchId).order('created_at', { ascending: false }),
        
        // ⚖️ LIABILITY DATA: Offloaded entirely to Postgres for instant calculation!
        supabase.rpc('get_mom_liability', { p_branch_id: activeBranchId })
    ]);

    // Populate View State
    setSales(sData || [])
    setRetailSales(rDataView || [])
    setCogsSettlements(cDataView || [])

    // Set Lightning-Fast Liability
    setLiveMomLiability(Number(liabilityData) || 0);

    setLoading(false)
  }, [fromDate, toDate, activeMainTab, timeFilter, activeBranchId]);

  // 🔥 Automatically refetches optimal data when you change tabs, dates, OR BRANCHES!
  useEffect(() => {
    // 💣 SECURITY WIPE: Destroy active bulk selections and inline payment forms 
    // when switching branches to prevent Cross-Tenant Ghost Settlements!
    setSelectedDays([]);
    setInlinePayments({});
    setBulkPaymentRows([{ id: Date.now(), method: 'Mom Liability ៛', amount: '' }]);
    setBulkModalOpen(false);

    if (fromDate && toDate) {
      fetchReportData();
    }
  }, [fetchReportData, fromDate, toDate]) 

  useFocusRefresh(fetchReportData);

  // 🟢 Downloads the exact A4 PDF document directly from your API route (passing screen records)
  const handleDownload = async () => {
    if (isCapturing || isSendingTelegram) return;
    setIsCapturing(true);
    showToast('info', 'Generating PDF...', 'Building and downloading exact A4 PDF report...');

    try {
      // 🔥 STABILITY FIX: Strip unused heavy columns to prevent Vercel 4MB Payload Too Large crashes on big months
      const minimalRecords = reportSales.map(r => ({
        invoice_id: r.invoice_id, customer_name: r.customer_name, rice_type: r.rice_type, custom_rice_type: r.custom_rice_type, 
        qty: r.qty, cogs_price: r.cogs_price, created_at: r.created_at, owner: r.owner
      }));

      const res = await fetch('/api/telegram/send-cogs-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDate,
          toDate,
          ownerTab: activeOwnerTab,
          downloadOnly: true,
          records: minimalRecords,
          branch_id: activeBranchId // 👈 🔥 Added!
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.slice(0, 150) || 'Failed to generate PDF download');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `COGS-${activeOwnerTab.toUpperCase()}-${fromDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showToast('success', 'PDF Downloaded!', 'Exact A4 PDF document downloaded successfully!');
    } catch (err: any) {
      console.error('Download Error:', err);
      showToast('error', 'Download Failed', err.message || 'Could not download PDF');
    } finally {
      setIsCapturing(false);
    }
  };

  // 🟢 Send Current Tab's A4 Report PDF to Telegram (passing screen records)
  const handleSendToTelegram = async () => {
    if (isSendingTelegram || isCapturing) return;
    setIsSendingTelegram(true);
    showToast('info', 'Generating PDF...', 'Building A4 PDF report and sending to Telegram...');

    try {
      // 🔥 STABILITY FIX: Strip unused heavy columns to prevent Vercel 4MB Payload Too Large crashes
      const minimalRecords = reportSales.map(r => ({
        invoice_id: r.invoice_id, customer_name: r.customer_name, rice_type: r.rice_type, custom_rice_type: r.custom_rice_type, 
        qty: r.qty, cogs_price: r.cogs_price, created_at: r.created_at, owner: r.owner
      }));

      const res = await fetch('/api/telegram/send-cogs-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDate,
          toDate,
          ownerTab: activeOwnerTab,
          records: minimalRecords,
          branch_id: activeBranchId // 👈 🔥 Added!
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.slice(0, 150) || 'Failed to send PDF to Telegram');
      }

      showToast('success', 'PDF Sent!', 'A4 PDF document delivered to your Telegram group!');
    } catch (err: any) {
      console.error('Telegram PDF Send Error:', err);
      showToast('error', 'Send Failed', err.message || 'Could not send PDF to Telegram');
    } finally {
      setIsSendingTelegram(false);
    }
  };

  const isWithinTimeFilter = (dateStr: string, filter: string) => {
    if (filter === 'all') return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0,0,0,0); d.setHours(0,0,0,0);
    
    if (filter === 'today') return d.getTime() === today.getTime();
    if (filter === 'week') {
      const lastWeek = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7);
      return d >= lastWeek && d <= today;
    }
    if (filter === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    return true;
  }

  const processSellerData = (sellerSales: any[]) => {
    const customerGroups: Record<string, any[]> = {};
    
    sellerSales.forEach(row => {
      const customer = row.customer_name || 'Walk-in';
      if (!customerGroups[customer]) customerGroups[customer] = [];
      customerGroups[customer].push(row);
    });

    const finalRows: any[] = [];
    let sellerGrandTotal = 0;

    Object.keys(customerGroups).forEach(customer => {
      const group = customerGroups[customer];
      let normalRows: any[] = [];
      let douRows: any[] = [];
      let consumedRows: any[] = [];
      let specialRows: any[] = [];

      group.forEach(item => {
        const desc = item.custom_rice_type || item.rice_type || '';
        const price = Number(item.cogs_price || 0);

        if (desc.includes('សេវាដឹក')) return;
        if (desc.includes('បាវ') && price === 0) return;

        if (desc.includes('ដូរ') || desc.includes('បញ្ចុះតម្លៃ') || desc.includes('កក់')) douRows.push(item);
        else if (desc.includes('បានប្រើ') || desc.includes('អង្ករខ្វះ')) consumedRows.push(item);
        else if (desc.includes('ថ្លៃបាវ')) specialRows.push(item);
        else normalRows.push(item);
      });

      specialRows.sort((a, b) => (a.rice_type || '').localeCompare(b.rice_type || ''));
      const sortedGroup = [...normalRows, ...specialRows, ...douRows, ...consumedRows];

      sortedGroup.forEach((item, index) => {
        const qty = Number(item.qty || 0);
        const price = Number(item.cogs_price || 0);
        let amount = qty * price;

        const descForMath = item.custom_rice_type || item.rice_type || '';
        const isNegative = descForMath.includes('ដូរ') || descForMath.includes('បញ្ចុះតម្លៃ') || descForMath.includes('កក់');
        
        if (isNegative) amount = -Math.abs(amount);
        else amount = Math.abs(amount);

        sellerGrandTotal += amount;

        finalRows.push({
          ...item,
          calculatedAmount: amount,
          isNegative,
          isFirstOfCustomer: index === 0,
          rowSpan: index === 0 ? sortedGroup.length : 0
        });
      });
    });

    return { rows: finalRows, sellerGrandTotal };
  };

  // 🔥 PERFORMANCE FIX: Memoize report sales to prevent UI lag and render-phase mutations
  const { reportSales, groupedBySeller, combinedGrandTotal } = useMemo(() => {
    const rSales = [...sales, ...retailSales].filter(s => {
      if (!s.created_at) return false;
      const d = s.created_at.substring(0, 10);
      return d >= fromDate && d <= toDate;
    }).filter(s => {
      const owner = parseOwner(s.owner || s.customer_name);
      if (activeOwnerTab === 'mom') return owner === 'mom';
      else return owner !== 'mom';
    });

    const grouped: Record<string, any[]> = {};
    rSales.forEach(s => {
      let seller = parseOwner(s.owner || s.customer_name);
      seller = seller.charAt(0).toUpperCase() + seller.slice(1);
      if (!grouped[seller]) grouped[seller] = [];
      grouped[seller].push(s);
    });

    let grandTotal = 0;
    Object.keys(grouped).forEach(seller => {
      const { sellerGrandTotal } = processSellerData(grouped[seller]);
      grandTotal += sellerGrandTotal;
    });

    return { reportSales: rSales, groupedBySeller: grouped, combinedGrandTotal: grandTotal };
  }, [sales, retailSales, fromDate, toDate, activeOwnerTab]);

  // 🔥 PERFORMANCE FIX: Memoize daily aggregations for Pending/History tabs
  const { dailyMap, pendingDays, historyDays } = useMemo(() => {
    const dMap: Record<string, any> = {};
    
    [...sales, ...retailSales].forEach(s => {
      const owner = parseOwner(s.owner || s.customer_name);
      const isMomTab = activeOwnerTab === 'mom';
      const isMomOwner = owner === 'mom';
      
      if (isMomTab !== isMomOwner) return;

      const date = s.created_at.substring(0, 10);
      const displayOwner = owner.charAt(0).toUpperCase() + owner.slice(1);
      const key = `${date}_${displayOwner}`;

      if (!dMap[key]) {
        dMap[key] = { key, date, owner: displayOwner, totalCogs: 0, totalPaid: 0, methods: new Set<string>() };
      }

      let qty = Number(s.qty || 0);
      let price = Number(s.cogs_price || 0);
      let amount = qty * price;
      let desc = s.custom_rice_type || s.rice_type || '';
      
      if (desc.includes('សេវាដឹក')) return;
      if (desc.includes('បាវ') && price === 0) return;
      if (desc.includes('ដូរ') || desc.includes('បញ្ចុះតម្លៃ') || desc.includes('កក់')) amount = -Math.abs(amount);
      else amount = Math.abs(amount);

      dMap[key].totalCogs += amount;
    });

    cogsSettlements.forEach(c => {
      const owner = parseOwner(c.owner_name);
      const displayOwner = owner.charAt(0).toUpperCase() + owner.slice(1);
      const key = `${c.settlement_date}_${displayOwner}`;
      if (dMap[key]) {
        const rielPaid = Number(c.paid_amount_riel || 0);
        const usdPaid = Number(c.paid_amount_usd || 0) * EXCHANGE_RATE;
        dMap[key].totalPaid += (rielPaid + usdPaid);
        
        if (c.payment_method) dMap[key].methods.add(c.payment_method);
      }
    });

    const allDays = Object.values(dMap).sort((a,b) => b.date.localeCompare(a.date));
    const filteredDays = allDays.filter(d => isWithinTimeFilter(d.date, timeFilter));
    
    return {
      dailyMap: dMap,
      pendingDays: filteredDays.filter(d => d.totalCogs > d.totalPaid + 0.1),
      historyDays: filteredDays.filter(d => d.totalPaid > 0)
    };
  }, [sales, retailSales, cogsSettlements, activeOwnerTab, timeFilter]);

  const handleSelectDay = (key: string) => {
    if (selectedDays.includes(key)) setSelectedDays(selectedDays.filter(k => k !== key));
    else setSelectedDays([...selectedDays, key]);
  }
  const handleSelectAll = () => {
    if (selectedDays.length === pendingDays.length) setSelectedDays([]);
    else setSelectedDays(pendingDays.map(d => d.key));
  }

  async function processPayments(rows: PaymentRow[], targetDays: any[], isBulk: boolean) {
    if (isProcessing) return;

    let totalAppliedRielEq = 0;
    let liabilityUsedRiel = 0;
    let liabilityUsedUsd = 0;
    let methodStrings: string[] = [];

    let totalUsdFace = 0;
    let totalRielFace = 0;

    const totalDue = targetDays.reduce((sum, d) => sum + (d.totalCogs - d.totalPaid), 0);

    for (const r of rows) {
       // 🔥 RELIABILITY FIX: Strip commas from CurrencyInput to prevent NaN math crashes
       const amt = Number(String(r.amount).replace(/,/g, '')) || 0;
       if (amt <= 0) continue;
       methodStrings.push(`${r.method}: ${amt}`);

       if (r.method === 'Mom Liability ៛') {
         liabilityUsedRiel += amt;
         totalAppliedRielEq += amt;
         totalRielFace += amt;
       } else if (r.method === 'Mom Liability $') {
         liabilityUsedUsd += amt;
         totalAppliedRielEq += (amt * EXCHANGE_RATE);
         totalUsdFace += amt;
       } else if (r.method.includes('$')) {
         totalAppliedRielEq += (amt * EXCHANGE_RATE);
         totalUsdFace += amt;
       } else {
         totalAppliedRielEq += amt;
         totalRielFace += amt;
       }
    }

    if (totalAppliedRielEq <= 0) return;
    if (totalAppliedRielEq > totalDue + 0.1) {
      showToast('error', 'Overpayment', 'Cannot pay more than the total COGS balance.');
      return;
    }
    
    const liabilityUsedRielEqSum = liabilityUsedRiel + (liabilityUsedUsd * EXCHANGE_RATE);
    if (liabilityUsedRielEqSum > liveMomLiability + 0.1) {
        showToast('error', 'Insufficient Liability', `Not enough Mom Liability available! You only have ${formatRiel(liveMomLiability)}`);
        setIsProcessing(false);
        return; 
    }

    setIsProcessing(true);

    try {
      let remainingToDistribute = totalAppliedRielEq;
      const settlesToInsert = [];
      const daysToSettle = [...targetDays].sort((a,b) => a.date.localeCompare(b.date));

      for (const day of daysToSettle) {
         if (remainingToDistribute <= 0) break;
         const owed = day.totalCogs - day.totalPaid;
         const apply = Math.min(owed, remainingToDistribute);

         const pctOfTotal = apply / totalAppliedRielEq;
         const allocatedUsd = totalUsdFace * pctOfTotal;
         const allocatedRiel = totalRielFace * pctOfTotal;

         settlesToInsert.push({
           settlement_date: day.date,
           owner_name: day.owner,
           source_type: 'Batch',
           paid_amount_usd: allocatedUsd,
           paid_amount_riel: allocatedRiel,
           payment_method: methodStrings.join(', '),
           status: apply >= owed ? 'Settled' : 'Partial',
           remarks: isBulk ? `Bulk via COGS Dashboard` : `Inline via COGS Dashboard`,
           branch_id: activeBranchId // 🔥 STAMPED
         });

         remainingToDistribute -= apply;
      }

      // 🚀 ONE SECURE TRIP TO POSTGRES (Atomic Execution)
      const { error } = await supabase.rpc('process_cogs_payment', { 
        p_payload: { 
          branch_id: activeBranchId, 
          settlements: settlesToInsert 
        } 
      });
      if (error) throw error;
      
      if (isBulk) {
        setBulkModalOpen(false);
        setSelectedDays([]);
        setBulkPaymentRows([{ id: Date.now(), method: 'Mom Liability ៛', amount: '' }]);
      } else {
        setInlinePayments(prev => { const n = {...prev}; delete n[targetDays[0].key]; return n; });
      }

      showToast('success', 'Payment Logged', 'The COGS payment has been settled successfully.');
      fetchReportData(); 

    } catch (err: any) {
      showToast('error', 'Processing Error', err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleProcessCreditPayment(day: any, paymentRows: PaymentRow[]) {
    await processPayments(paymentRows, [day], false);
  }

  const bulkTotalDue = selectedDays.reduce((sum, k) => sum + (dailyMap[k].totalCogs - dailyMap[k].totalPaid), 0);
  const liveBulkReceived = bulkPaymentRows.reduce((sum, row) => {
    // 🔥 RELIABILITY FIX: Strip commas to prevent NaN UI calculation crashes
    const amt = Number(String(row.amount).replace(/,/g, '')) || 0;
    if (row.method === 'Mom Liability $') return sum + (amt * EXCHANGE_RATE);
    if (row.method === 'Mom Liability ៛') return sum + amt;
    if (row.method.includes('$')) return sum + (amt * EXCHANGE_RATE);
    return sum + amt;
  }, 0);
  const liveBulkRemaining = bulkTotalDue - liveBulkReceived;

  const getInlinePaymentState = (key: string, owed: number) => {
    return inlinePayments[key] || [{ id: 1, method: 'Mom Liability ៛', amount: owed }];
  }
  const updateInlineRow = (key: string, rowId: number, field: string, value: any, owed: number) => {
    setInlinePayments(prev => {
      const rows = prev[key] ? [...prev[key]] : [{ id: 1, method: 'Mom Liability ៛', amount: owed }];
      const newRows = rows.map(r => r.id === rowId ? { ...r, [field]: value } : r);
      return { ...prev, [key]: newRows };
    });
  }
  const addInlineSplit = (key: string, owed: number) => {
    setInlinePayments(prev => {
      const rows = prev[key] ? [...prev[key]] : [{ id: 1, method: 'Mom Liability ៛', amount: owed }];
      return { ...prev, [key]: [...rows, { id: Date.now(), method: 'Mom Liability ៛', amount: '' }] };
    });
  }
  const removeInlineSplit = (key: string, rowId: number, owed: number) => {
    setInlinePayments(prev => {
      const rows = prev[key] ? [...prev[key]] : [{ id: 1, method: 'Mom Liability ៛', amount: owed }];
      return { ...prev, [key]: rows.filter(r => r.id !== rowId) };
    });
  }

  return (
    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      
      {/* HEADER CONTAINER (Frozen) */}
      <div className="header-container" style={{ flexShrink: 0 }}>
        <div className="header-left">
          <h1 className="saas-page-title">🌾 COGS Accounting</h1>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {activeMainTab === 'report' && (
            <>
              {/* Telegram Send Button */}
              <button 
                onClick={handleSendToTelegram} 
                disabled={isSendingTelegram || isCapturing} 
                className="saas-btn" 
                style={{ 
                  background: '#229ED9', 
                  color: '#fff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  padding: '8px 12px'
                }}
                title="Send to Telegram"
              >
                {isSendingTelegram ? '⏳' : (
                  <>
                    <span>✈️</span>
                    <span className="desktop-btn-text">Send to Telegram</span>
                  </>
                )}
              </button>

              {/* Download A4 PDF Button */}
              <button 
                onClick={handleDownload} 
                disabled={isCapturing || isSendingTelegram} 
                className="saas-btn" 
                style={{ 
                  background: '#b58a3d', 
                  color: '#fff',
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  padding: '8px 12px'
                }}
                title="Download A4 PDF"
              >
                {isCapturing ? '⏳' : (
                  <>
                    <span>⬇️</span>
                    <span className="desktop-btn-text">Download A4</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* MAIN SAAS TABS (Frozen) */}
      <div className="saas-tab-container" style={{ padding: '8px', border: '1px solid #e2e8f0', background: '#fff', flexShrink: 0, marginBottom: '16px' }}>
        <button 
          onClick={() => setActiveMainTab('report')} 
          className={`saas-tab ${activeMainTab === 'report' ? 'active' : ''}`}
          style={{ flex: 1, textAlign: 'center' }}
        >
          📊 COGS Report
        </button>
        <button 
          onClick={() => setActiveMainTab('pending')} 
          className={`saas-tab ${activeMainTab === 'pending' ? 'active' : ''}`}
          style={activeMainTab === 'pending' ? { background: '#ef4444', color: '#fff', flex: 1, textAlign: 'center' } : { flex: 1, textAlign: 'center' }}
        >
          ⏳ Pending Settlements
        </button>
        <button 
          onClick={() => setActiveMainTab('history')} 
          className={`saas-tab ${activeMainTab === 'history' ? 'active' : ''}`}
          style={activeMainTab === 'history' ? { background: '#10b981', color: '#fff', flex: 1, textAlign: 'center' } : { flex: 1, textAlign: 'center' }}
        >
          📚 Settlement History
        </button>
      </div>

      {/* FILTERS CARD (Frozen) */}
      <div className="saas-card filter-card-layout" style={{ padding: '16px 20px', marginBottom: '16px', flexShrink: 0 }}>
        {activeMainTab === 'report' ? (
          <div className="hide-scrollbar" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'nowrap', maxWidth: '100%', overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              <label style={{ fontWeight: 'bold', fontSize: '13px', color: '#64748b' }}>From:</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="saas-input" style={{ width: '135px', padding: '8px' }} />
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              <label style={{ fontWeight: 'bold', fontSize: '13px', color: '#64748b' }}>To:</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="saas-input" style={{ width: '135px', padding: '8px' }} />
            </div>
          </div>
        ) : (
          <div className="saas-tab-container hide-scrollbar" style={{ margin: 0, padding: '4px', border: 'none', boxShadow: 'none', background: '#f1f5f9', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' }}>
            {['today', 'week', 'month', 'all'].map(f => (
              <button 
                key={f} onClick={() => setTimeFilter(f as any)} 
                className={`saas-tab ${timeFilter === f ? 'active' : ''}`}
                style={timeFilter === f ? { background: '#0f172a', color: '#fff', padding: '8px 16px', flexShrink: 0 } : { padding: '8px 16px', flexShrink: 0 }}
              >
                {f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : f === 'all' ? 'All Time' : f}
              </button>
            ))}
          </div>
        )}
        
        <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} className="desktop-only-divider" />
        
        <div className="saas-tab-container hide-scrollbar" style={{ margin: 0, padding: '4px', border: 'none', boxShadow: 'none', background: '#f1f5f9', flexShrink: 0, display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <button 
            onClick={() => setActiveOwnerTab('mom')} 
            className={`saas-tab ${activeOwnerTab === 'mom' ? 'active' : ''}`}
            style={{ padding: '8px 16px', flexShrink: 0 }}
          >
            Mom COGS
          </button>
          <button 
            onClick={() => setActiveOwnerTab('others')} 
            className={`saas-tab ${activeOwnerTab === 'others' ? 'active' : ''}`}
            style={{ padding: '8px 16px', flexShrink: 0 }}
          >
            Pich / Jing / Both
          </button>
        </div>
      </div>

      {/* 🔥 MAIN CONTENT AREA (Scrolls Internally) */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: '40px', display: 'flex', flexDirection: 'column' }}>

        {/* A4 REPORT TAB */}
        {activeMainTab === 'report' && (
          <>
            <div className="a4-paper-scroller">
              <div className="a4-paper-container" ref={reportRef}>
                <img className="center-logo" src="https://i.imgur.com/s0hg3MQ.png" alt="Logo" crossOrigin="anonymous" />
                
                <div className="a4-content">
                  <h1 style={{ textAlign: 'center', fontSize: '22px', color: 'green', margin: '0 0 20px 0', fontFamily: "'Noto Sans Khmer', Arial, sans-serif", fontWeight: 'normal' }}>
                    🌾 អង្ករត្រូវទូទាត់ 🧾
                  </h1>

                  {loading ? (
                    <p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>Loading records...</p>
                  ) : reportSales.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No sales records found for this date range.</p>
                  ) : (
                    <>
                      {Object.keys(groupedBySeller).map((seller) => {
                        const { rows, sellerGrandTotal } = processSellerData(groupedBySeller[seller]);

                        return (
                          <div key={seller} style={{ marginBottom: '30px' }}>
                            <h2 style={{ fontSize: '16px', margin: '0 0 8px 0', color: '#333', fontFamily: "'Noto Sans Khmer', Arial, sans-serif", fontWeight: 'normal' }}>
                              ថៅកែ {seller.toUpperCase()}
                            </h2>
                            <table className="report-table">
                              <thead>
                                <tr style={{ backgroundColor: '#fffacd' }}>
                                  <th style={{ width: '12%' }}>INV</th>
                                  <th style={{ width: '18%' }}>អតិថិជន</th>
                                  <th style={{ width: '18%' }}>ប្រភេទអង្ករ</th>
                                  <th style={{ width: '16%' }}>ឈ្មោះក្នុងប៊ុង</th>
                                  <th style={{ width: '8%' }}>ចំនួន</th>
                                  <th style={{ width: '13%' }}>តម្លៃ</th>
                                  <th style={{ width: '15%' }}>សរុប</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, idx) => (
                                  <tr key={idx}>
                                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                      {row.invoice_id ? String(row.invoice_id).replace(/\D/g, '') : ''}
                                    </td>
                                    {row.isFirstOfCustomer && (
                                      <td rowSpan={row.rowSpan} style={{ verticalAlign: 'middle' }}>
                                        {row.customer_name}
                                      </td>
                                    )}
                                    <td>
                                      <div style={{ color: '#0f172a' }}>{row.rice_type}</div>
                                    </td>
                                    <td>{row.custom_rice_type || ''}</td>
                                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{row.qty.toLocaleString('en-US')}</td>
                                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{Number(row.cogs_price).toLocaleString('en-US')}</td>
                                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: row.isNegative ? 'red' : 'inherit' }}>
                                      {Math.round(row.calculatedAmount).toLocaleString('en-US')}
                                    </td>
                                  </tr>
                                ))}
                                
                                <tr style={{ backgroundColor: '#fffacd' }}>
                                  <td colSpan={6} className="summary-label" style={{ paddingRight: '10px' }}>សរុប</td>
                                  <td className="summary-value">
                                    {Math.round(sellerGrandTotal).toLocaleString('en-US')} ៛
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        );
                      })}

                      <div style={{ marginTop: '40px' }}>
                        <table className="combined-summary-table" style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #000' }}>
                          <tbody>
                            <tr style={{ backgroundColor: '#fffacd' }}>
                              <td className="summary-label" style={{ width: '80%', padding: '10px', border: '1px solid #000' }}>
                                សរុបរួមទាំងអស់
                              </td>
                              <td className="summary-value" style={{ width: '20%', padding: '10px', border: '1px solid #000', textAlign: 'center' }}>
                                {Math.round(combinedGrandTotal).toLocaleString('en-US')} ៛
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div style={{ textAlign: 'right', marginTop: '20px', fontSize: '12px', color: '#64748b' }}>
                        Generated on: {new Date().toLocaleString('en-GB')}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* PENDING SETTLEMENTS TAB */}
        {activeMainTab === 'pending' && (
          <div className="saas-table-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginBottom: 0 }}>
            <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
              <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fef2f2', boxShadow: 'inset 0 -2px 0 0 #fecaca', textAlign: 'center', width: '50px', color: '#991b1b' }}>
                      <input type="checkbox" onChange={handleSelectAll} checked={selectedDays.length > 0 && selectedDays.length === pendingDays.length} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                    </th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fef2f2', boxShadow: 'inset 0 -2px 0 0 #fecaca', color: '#991b1b' }}>COGS Date</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fef2f2', boxShadow: 'inset 0 -2px 0 0 #fecaca', color: '#991b1b' }}>Owner</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fef2f2', boxShadow: 'inset 0 -2px 0 0 #fecaca', textAlign: 'right', color: '#991b1b' }}>Total COGS (៛)</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fef2f2', boxShadow: 'inset 0 -2px 0 0 #fecaca', textAlign: 'right', color: '#991b1b' }}>Remaining Debt (៛)</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                     <TableSkeleton columns={5} rows={5} />
                  ) : pendingDays.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <EmptyState 
                          icon="🎉" 
                          title="All caught up!" 
                          message="No pending COGS! You are all settled up!" 
                        />
                      </td>
                    </tr>
                  ) : (
                    pendingDays.map((d: any) => {
                      const remaining = d.totalCogs - d.totalPaid;
                      const isSelected = selectedDays.includes(d.key);
                      
                      return (
                        <tr key={d.key} className={`saas-tr ${isSelected ? 'selected' : ''}`} onClick={() => handleSelectDay(d.key)} style={{ cursor: 'pointer' }}>
                          <td className="saas-td" style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={isSelected} readOnly style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                          </td>
                          <td className="saas-td" style={{ fontWeight: 'bold' }}>
                            {new Date(d.date).toLocaleDateString('en-GB')}
                          </td>
                          <td className="saas-td" style={{ fontWeight: 'bold' }}>{d.owner}</td>
                          <td className="saas-td" style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatRiel(d.totalCogs)}</td>
                          <td className="saas-td" style={{ textAlign: 'right', color: '#ef4444', fontWeight: 'bold', fontSize: '16px' }}>{formatRiel(remaining)}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {selectedDays.length > 0 && (
              <div style={{ position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)', background: '#1e293b', padding: '16px 32px', borderRadius: '50px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)', display: 'flex', gap: '24px', alignItems: 'center', zIndex: 100 }}>
                <div style={{ color: '#fff', fontSize: '15px' }}>
                  <span style={{ color: '#94a3b8' }}>Selected: </span> <b>{selectedDays.length} Days</b>
                </div>
                <div style={{ color: '#fff', fontSize: '15px' }}>
                  <span style={{ color: '#94a3b8' }}>Total COGS Due: </span> 
                  <b style={{ color: '#f87171', fontSize: '18px' }}>
                    {formatRiel(selectedDays.reduce((sum, k) => sum + (dailyMap[k].totalCogs - dailyMap[k].totalPaid), 0))}
                  </b>
                </div>
                <button 
                  onClick={() => setBulkModalOpen(true)}
                  className="saas-btn saas-btn-primary"
                  style={{ borderRadius: '30px', boxShadow: '0 4px 10px rgba(16,185,129,0.3)', padding: '12px 24px', fontSize: '15px' }}
                >
                  Settle Selected
                </button>
              </div>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {activeMainTab === 'history' && (
          <div className="saas-table-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginBottom: 0 }}>
            <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
              <table className="saas-table" style={{ minWidth: '1050px', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0' }}>COGS Date & Owner</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', textAlign: 'right' }}>Total COGS (៛)</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', textAlign: 'center' }}>Methods Applied</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', textAlign: 'right' }}>Paid Amount (៛)</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', textAlign: 'right' }}>Remaining Debt (៛)</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', textAlign: 'center', width: '200px' }}>Settle Remaining</th>
                    <th className="saas-th" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', textAlign: 'center', width: '120px' }}>Complete</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                     <TableSkeleton columns={7} rows={5} />
                  ) : historyDays.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <EmptyState 
                          icon="📚" 
                          title="No history found" 
                          message="No settled records found for this view." 
                        />
                      </td>
                    </tr>
                  ) : (
                    historyDays.map((d: any) => {
                      const remaining = d.totalCogs - d.totalPaid;
                      const isDone = remaining <= 0;
                      const paymentState = getInlinePaymentState(d.key, remaining);
                      
                      return (
                        <tr key={d.key} className="saas-tr" style={{ opacity: isDone ? 0.7 : 1 }}>
                          <td className="saas-td">
                            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{new Date(d.date).toLocaleDateString('en-GB')}</div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>Owner: <span style={{color: '#0f172a'}}>{d.owner}</span></div>
                          </td>
                          <td className="saas-td" style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatRiel(d.totalCogs)}</td>
                          <td className="saas-td" style={{ textAlign: 'center', color: '#3b82f6', fontWeight: 'bold', fontSize: '12px' }}>
                            {Array.from(d.methods).join(', ') || '-'}
                          </td>
                          <td className="saas-td" style={{ textAlign: 'right', color: '#10b981', fontWeight: 'bold' }}>{formatRiel(d.totalPaid)}</td>
                          
                          <td className="saas-td" style={{ textAlign: 'right', color: '#ef4444', fontWeight: 'bold', fontSize: '15px' }}>
                            {remaining > 0 ? formatRiel(remaining) : ''}
                          </td>

                          <td className="saas-td" style={{ textAlign: 'right' }}>
                            {remaining > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {paymentState.map(row => (
                                  <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <select 
                                        value={row.method}
                                        onChange={(e) => updateInlineRow(d.key, row.id, 'method', e.target.value, remaining)}
                                        className="saas-input"
                                        style={{ padding: '8px', flex: 1, fontWeight: 'bold', cursor: 'pointer' }}
                                      >
                                        <option value="Mom Liability ៛">📉 Mom Liability ៛</option>
                                        <option value="Mom Liability $">📉 Mom Liability $</option>
                                        <option value="Cash ៛">💵 Cash ៛</option>
                                        <option value="Cash $">💵 Cash $</option>
                                        <option value="QR ៛">📱 QR ៛</option>
                                        <option value="QR $">📱 QR $</option>
                                      </select>
                                      {paymentState.length > 1 && (
                                        <button onClick={() => removeInlineSplit(d.key, row.id, remaining)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}>✕</button>
                                      )}
                                    </div>
                                    <CurrencyInput
                                      placeholder={formatRiel(remaining)}
                                      value={row.amount}
                                      onChange={(v: any) => updateInlineRow(d.key, row.id, 'amount', v, remaining)}
                                      onEnter={() => handleProcessCreditPayment(d, paymentState)}
                                      className="saas-input"
                                      style={{ padding: '8px', textAlign: 'right' }}
                                    />
                                  </div>
                                ))}
                                <button onClick={() => addInlineSplit(d.key, remaining)} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', textAlign: 'right', fontWeight: 'bold' }}>+ Add Split</button>
                              </div>
                            ) : (
                              <div style={{ color: '#10b981', fontSize: '13px', fontWeight: 'bold', textAlign: 'center' }}>Fully Settled</div>
                            )}
                          </td>

                          <td className="saas-td" style={{ textAlign: 'center' }}>
                            {!isDone && (
                              <button 
                                onClick={() => handleProcessCreditPayment(d, paymentState)}
                                className="saas-btn saas-btn-primary"
                                style={{ width: '100%', padding: '8px 12px' }}
                              >
                                ✔ Done
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div> {/* END OF MAIN CONTENT SCROLLER */}

      {/* BULK SETTLE MODAL */}
      {bulkModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', boxSizing: 'border-box' }} onMouseDown={() => setBulkModalOpen(false)}>
          <div style={{ backgroundColor: '#ffffff', width: '100%', maxWidth: '450px', borderRadius: '16px', padding: '24px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' }} onMouseDown={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#334155', fontSize: '18px', fontWeight: 'bold' }}>💸 Bulk Settle COGS</h3>
              <button onClick={() => setBulkModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '14px', color: '#475569', fontWeight: 'bold' }}>
              <span>Settling: <b>{selectedDays.length} Days</b></span>
            </div>

            <div style={{ background: '#fff1f2', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: '1px solid #fecaca', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#be123c', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 'bold' }}>Total COGS Due</div>
              <div style={{ fontSize: '28px', color: '#e11d48', fontWeight: 'bold' }}>{formatRiel(bulkTotalDue)}</div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <label style={{ fontSize: '13px', color: '#475569', fontWeight: 'bold' }}>Payment Method(s)</label>
                <button onClick={() => setBulkPaymentRows([...bulkPaymentRows, { id: Date.now(), method: 'Mom Liability ៛', amount: '' }])} style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: '4px', fontSize: '12px', padding: '6px 10px', cursor: 'pointer', fontWeight: 'bold' }}>+ Split</button>
              </div>

              {bulkPaymentRows.map((row, index) => (
                <div key={row.id} style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
                  <select 
                    value={row.method} 
                    onChange={e => {
                      const newRows = [...bulkPaymentRows];
                      newRows[index].method = e.target.value;
                      setBulkPaymentRows(newRows);
                    }}
                    className="saas-input"
                    style={{ width: '50%', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    <option value="Mom Liability ៛">📉 Mom Liability ៛</option>
                    <option value="Mom Liability $">📉 Mom Liability $</option>
                    <option value="Cash ៛">💵 Cash ៛</option>
                    <option value="Cash $">💵 Cash $</option>
                    <option value="QR ៛">📱 QR ៛</option>
                    <option value="QR $">📱 QR $</option>
                  </select>
                  
                  <div style={{ flex: 1 }}>
                    <CurrencyInput 
                      placeholder="" 
                      value={row.amount} 
                      onChange={(val: any) => {
                        const newRows = [...bulkPaymentRows];
                        newRows[index].amount = val;
                        setBulkPaymentRows(newRows);
                      }}
                      className="saas-input"
                      style={{ textAlign: 'right' }}
                    />
                  </div>
                  
                  {bulkPaymentRows.length > 1 && (
                    <button onClick={() => setBulkPaymentRows(bulkPaymentRows.filter(r => r.id !== row.id))} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '18px', cursor: 'pointer', padding: '0 4px', fontWeight: 'bold' }}>✕</button>
                  )}
                </div>
              ))}

              {activeOwnerTab === 'mom' && (
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '12px', padding: '8px', background: '#f8fafc', borderRadius: '6px', border: '1px dashed #cbd5e1', fontWeight: 'bold' }}>
                  <b>💡 Tip:</b> Select <i>"Mom Liability"</i> to pay this COGS using the money you collected from Mom's deliveries. 
                  <br/><br/>
                  <b>Available Liability:</b> <span style={{color: '#b58a3d', fontWeight: 'bold'}}>{formatRiel(liveMomLiability)}</span>
                </div>
              )}
            </div>

            {bulkPaymentRows.some(r => Number(r.amount) > 0) && (
              <div style={{ marginBottom: '24px', paddingTop: '16px', borderTop: '1px dashed #cbd5e1', fontSize: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontWeight: 'bold' }}>
                  <span style={{ color: '#64748b' }}>Total Processed:</span>
                  <span style={{ color: '#334155' }}>{formatRiel(liveBulkReceived)}</span>
                </div>
                {liveBulkRemaining < 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span style={{ color: '#ef4444' }}>Overpaid By:</span>
                    <span style={{ color: '#dc2626' }}>{formatRiel(Math.abs(liveBulkRemaining))}</span>
                  </div>
                ) : liveBulkRemaining > 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span style={{ color: '#d97706' }}>Still Owes:</span>
                    <span style={{ color: '#b45309' }}>{formatRiel(liveBulkRemaining)}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                    <span style={{ color: '#166534' }}>Balance:</span>
                    <span style={{ color: '#15803d' }}>Perfectly Cleared ✅</span>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setBulkModalOpen(false)} className="saas-btn saas-btn-secondary" style={{ padding: '12px 16px', fontSize: '15px' }}>Cancel</button>
              <button onClick={() => processPayments(bulkPaymentRows, selectedDays.map(k => dailyMap[k]), true)} disabled={isProcessing} className="saas-btn saas-btn-primary" style={{ padding: '12px 16px', fontSize: '15px' }}>
                {isProcessing ? 'Processing...' : 'Confirm Bulk Settle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- PAGE-SPECIFIC CSS (A4 REPORT) --- */}
      <style jsx global>{`
        .filter-card-layout {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .a4-paper-scroller {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: 12px;
        }

        .a4-paper-container {
          width: 794px;
          min-width: 794px;
          min-height: 1123px; 
          margin: 0 auto;
          background: #ffffff;
          padding: 40px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          border-radius: 4px;
          position: relative;
          overflow: hidden;
          box-sizing: border-box;
        }

        .center-logo {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 300px;
          opacity: 0.04; 
          z-index: 0;
          pointer-events: none;
        }

        .a4-content {
          position: relative;
          z-index: 1;
        }

        .report-table {
          width: 100%;
          border-collapse: collapse;
          font-family: 'Noto Sans Khmer', Arial, sans-serif;
          font-size: 13px;
        }

        .report-table th, .report-table td {
          border: 1px solid #000;
          padding: 8px 10px;
        }

        .report-table th {
          font-weight: bold;
          text-align: center;
        }

        .summary-label {
          font-family: 'Noto Sans Khmer', Arial, sans-serif;
          font-size: 14px;
          font-weight: normal;
          text-align: right;
          color: #1e293b;
        }

        .summary-value {
          font-size: 15px;
          font-weight: bold;
          color: #b58a3d;
          white-space: nowrap;
          text-align: right;
        }

        .header-container {
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 24px; 
          margin-top: 0; 
          margin-left: 60px; 
          gap: 12px; 
          min-height: 42px; 
          width: calc(100% - 60px); 
          max-width: 1600px;
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

        @media print {
          body * { visibility: hidden; }
          .a4-paper-container, .a4-paper-container * { visibility: visible; }
          .a4-paper-container {
            position: absolute; left: 0; top: 0; margin: 0; padding: 20px; box-shadow: none; width: 100%;
          }
          @page { size: A4 portrait; margin: 10mm; }
        }

        @media (max-width: 768px) {
          .desktop-btn-text {
            display: none !important;
          }

          .header-container {
            margin-left: 54px !important;
            width: calc(100% - 54px) !important;
          }

          .desktop-only-divider { 
            display: none !important; 
          }
          
          .filter-card-layout {
            flex-wrap: wrap !important;
          }

          .a4-paper-scroller {
            width: 100%;
            overflow: hidden !important;
          }

          .a4-paper-container {
            width: 100% !important;
            min-width: 100% !important;
            max-width: 100% !important;
            padding: 16px 8px !important;
            min-height: auto !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
          }

          .report-table {
            font-size: 9.5px !important;
          }

          .report-table th, 
          .report-table td {
            padding: 4px 2px !important;
            word-break: break-word;
          }

          .summary-label {
            font-size: 11px !important;
            padding: 6px 4px !important;
          }

          .summary-value {
            font-size: 12px !important;
            padding: 6px 4px !important;
          }

          .a4-content h1 {
            font-size: 16px !important;
            margin-bottom: 12px !important;
          }

          .a4-content h2 {
            font-size: 12px !important;
            margin-bottom: 6px !important;
          }
        }
      `}</style>
    </div>
  )
}

