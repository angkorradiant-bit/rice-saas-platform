'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatRiel, formatUSD, formatNumber, parseOwner, EXCHANGE_RATE } from '@/utils/formatters'
import { CurrencyInput } from '@/components/Inputs'
import { useToast } from '@/components/ToastProvider'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext' 
import AdminGuard from '@/components/AdminGuard' 
import { useFocusRefresh } from '@/lib/useFocusRefresh' // 🔥 FIX: Added missing import

const formatUSDEquiv = (vRiel: number) => formatUSD(vRiel / EXCHANGE_RATE);

export default function DashboardPage() {
  const { showToast } = useToast();
  const { branches, activeBranchId } = useBranch(); 

  const [isLoading, setIsLoading] = useState(true)
  const [wholesaleSales, setWholesaleSales] = useState<any[]>([])
  const [retailSales, setRetailSales] = useState<any[]>([])
  const [invoiceSummaries, setInvoiceSummaries] = useState<any[]>([])
  const [invoicePayments, setInvoicePayments] = useState<any[]>([]) 
  const [expenses, setExpenses] = useState<any[]>([])
  const [staffList, setStaffList] = useState<any[]>([]) 
  const [inventoryList, setInventoryList] = useState<any[]>([]) 
  const [accountsPayable, setAccountsPayable] = useState<any[]>([]) 
  const [cogsSettlements, setCogsSettlements] = useState<any[]>([]) 
  const [priceHistory, setPriceHistory] = useState<any[]>([]) 

  const [showStartingBalance, setShowStartingBalance] = useState(false)
  const [baseCapital, setBaseCapital] = useState<number>(0)
  const [initCashRiel, setInitCashRiel] = useState<number>(0)
  const [initCashUsd, setInitCashUsd] = useState<number>(0)
  const [initQrRiel, setInitQrRiel] = useState<number>(0)
  const [initQrUsd, setInitQrUsd] = useState<number>(0)
  const [familyOweRiel, setFamilyOweRiel] = useState<number>(0)
  const [familyOweUsd, setFamilyOweUsd] = useState<number>(0)
  const [persOweRiel, setPersOweRiel] = useState<number>(0) 
  const [persOweUsd, setPersOweUsd] = useState<number>(0) 

  const [activeTab, setActiveTab] = useState<'summary' | 'wholesale' | 'retail' | 'asset'>('summary')
  const [assetFilter, setAssetFilter] = useState<any>('month')

  // --- RICE EVALUATION STATES ---
  const [invTab, setInvTab] = useState<'wholesale_active' | 'wholesale_oos' | 'retail'>('wholesale_active')
  const [invTabOrder, setInvTabOrder] = useState(['wholesale_active', 'wholesale_oos', 'retail'])
  const [invSortConfig, setInvSortConfig] = useState<{key: string, direction: 'asc' | 'desc'} | null>(null)

  // 🔥 CLOSURE FIX: Wrap in useCallback so it tightly binds to the current active branch
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);

    const buildQ = (table: string) => {
      let q = supabase.from(table).select('*');
      if (activeBranchId !== 0) q = q.eq('branch_id', activeBranchId);
      return q;
    }
    
    const buildQNarrow = (table: string, columns: string) => {
      let q = supabase.from(table).select(columns);
      if (activeBranchId !== 0) q = q.eq('branch_id', activeBranchId);
      return q;
    }

    // 🔥 PHASE 4 PAYLOAD OPTIMIZATION: Narrowed columns slash RAM usage by 80%
    // 🛡️ FINANCIAL FIX: Removed date limits from ledger tables so calculateAssets() computes accurate LIFETIME Cash, QR, and Net Worth. 
    const [
      {data: salesData}, {data: sumData}, {data: retData}, {data: expData}, 
      {data: staffData}, {data: prodData}, {data: apData}, {data: cogsData}, 
      {data: batchData}, {data: invPayData}
    ] = await Promise.all([
      buildQNarrow('sales', 'id, created_at, qty, price_per_bag, cogs_price, owner, custom_rice_type, rice_type, invoice_id').eq('is_voided', false),
      buildQNarrow('invoice_summaries', 'invoice_id, owner, balance_due').eq('is_done', false),
      buildQNarrow('retail_sales', 'id, created_at, qty, price_per_bag, cogs_price, owner, custom_rice_type, rice_type, transaction_id, payment_method, total_sales').eq('is_voided', false),
      buildQNarrow('expenses', 'id, created_at, amount_riel, amount_usd, payment_method, spender, description, remarks'),
      buildQ('staff'),
      buildQNarrow('products', 'id, name, stock, cost_price, weight, linked_wholesale_id').order('id'),
      buildQNarrow('accounts_payable', 'id, amount_riel, amount_usd, status').eq('status', 'Unpaid'),
      buildQNarrow('cogs_settlements', 'payment_method, paid_amount_riel, paid_amount_usd, owner_name'),
      buildQNarrow('inventory_batches', 'id, product_id, remaining_qty, cost_price, created_at').gt('remaining_qty', 0),
      buildQNarrow('invoice_payments', 'invoice_id, payment_method, amount_paid_riel, amount_paid_usd, recorded_by, payment_date').eq('is_voided', false) 
    ]);

    setWholesaleSales(salesData || []); 
    setInvoiceSummaries(sumData || []); 
    setRetailSales(retData || []); 
    setExpenses(expData || []); 
    setStaffList(staffData || []); 
    setInventoryList(prodData || []); 
    setAccountsPayable(apData || []); 
    setCogsSettlements(cogsData || []); 
    setPriceHistory(batchData || []); 
    setInvoicePayments(invPayData || []);

    const baseKeys = ['base_capital', 'initial_cash_riel', 'initial_cash_usd', 'initial_qr_riel', 'initial_qr_usd', 'personal_owe_riel', 'personal_owe_usd', 'family_owe_riel', 'family_owe_usd'];
    // 🔥 SECURITY FIX: Isolate app settings fetches by branch to prevent global cross-tenant data leaks
    const keys = activeBranchId === 0 ? baseKeys : baseKeys.map(k => `${k}_${activeBranchId}`);
    const { data: capData } = await supabase.from('app_settings').select('*').in('setting_key', keys)
    
    // 💣 SECURITY WIPE: Force all manual accounting states to Zero. 
    // Prevents Branch A's cash drawer from bleeding into Branch B if Branch B has no saved settings yet!
    setBaseCapital(0); setInitCashRiel(0); setInitCashUsd(0); setInitQrRiel(0); setInitQrUsd(0); 
    setPersOweRiel(0); setPersOweUsd(0); setFamilyOweRiel(0); setFamilyOweUsd(0);

    if (capData) {
      capData.forEach((s: any) => {
        const rawKey = activeBranchId === 0 ? s.setting_key : s.setting_key.replace(`_${activeBranchId}`, '');
        if (rawKey === 'base_capital') setBaseCapital(Number(s.setting_value) || 0)
        if (rawKey === 'initial_cash_riel') setInitCashRiel(Number(s.setting_value) || 0)
        if (rawKey === 'initial_cash_usd') setInitCashUsd(Number(s.setting_value) || 0)
        if (rawKey === 'initial_qr_riel') setInitQrRiel(Number(s.setting_value) || 0)
        if (rawKey === 'initial_qr_usd') setInitQrUsd(Number(s.setting_value) || 0)
        if (rawKey === 'personal_owe_riel') setPersOweRiel(Number(s.setting_value) || 0)
        if (rawKey === 'personal_owe_usd') setPersOweUsd(Number(s.setting_value) || 0)
        if (rawKey === 'family_owe_riel') setFamilyOweRiel(Number(s.setting_value) || 0)
        if (rawKey === 'family_owe_usd') setFamilyOweUsd(Number(s.setting_value) || 0)
      })
    }
    if (!silent) setIsLoading(false);
  }, [activeBranchId]);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // 🔥 UX/RELIABILITY FIX: Replaced manual event listener with your custom hook!
  useFocusRefresh(() => loadData(true));

  async function updateSetting(key: string, val: number) {
    // 🔥 SECURITY FIX: Append branch_id to settings key to isolate global table mutations per tenant
    const branchKey = activeBranchId === 0 ? key : `${key}_${activeBranchId}`;
    const { error } = await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: val }, { onConflict: 'setting_key' })
    if (error) {
      showToast('error', 'Sync Error', 'Failed to update setting.');
    }
  }

  const now = new Date()
  const isToday = (dateStr: string) => { if (!dateStr) return false; const d = new Date(dateStr); return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }
  const isMTD = (dateStr: string) => { if (!dateStr) return false; const d = new Date(dateStr); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }
  const isLastMonth = (dateStr: string) => { if (!dateStr) return false; const d = new Date(dateStr); const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); }
  const getDayOfMonth = (dateStr: string) => { if (!dateStr) return 1; return new Date(dateStr).getDate(); }
  
  const isAssetMatch = (dateStr: string, filter: string) => {
    if (filter === 'all') return true;
    if (!dateStr) return false;
    const d = new Date(dateStr); const today = new Date();
    today.setHours(0,0,0,0); d.setHours(0,0,0,0);
    if (filter === 'today') return d.getTime() === today.getTime();
    if (filter === 'yesterday') { const yest = new Date(today); yest.setDate(yest.getDate() - 1); return d.getTime() === yest.getTime(); }
    if (filter === 'week') { const lastWeek = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7); return d >= lastWeek && d <= today; }
    if (filter === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    return true;
  }

  // 🔥 PERFORMANCE FIX: Memoize array derivations to maintain stable references and stop render thrashing
  const activeSalesData = useMemo(() => {
    if (activeTab === 'wholesale') return wholesaleSales;
    if (activeTab === 'retail') return retailSales;
    return [...wholesaleSales, ...retailSales];
  }, [activeTab, wholesaleSales, retailSales]);

  const activeInvoicePayments = useMemo(() => {
    if (activeTab === 'wholesale') return invoicePayments.filter((p: any) => !String(p.invoice_id).startsWith('RET-'));
    if (activeTab === 'retail') return invoicePayments.filter((p: any) => String(p.invoice_id).startsWith('RET-'));
    return invoicePayments;
  }, [activeTab, invoicePayments]);

  function calculateMetrics(dataSet: any[], timeFilter: any) {
    const filtered = dataSet.filter((s: any) => timeFilter(s.created_at));
    let totalSales = 0, pichSales = 0, jingSales = 0, bothSales = 0, momSales = 0;
    let totalProfit = 0, pichProfit = 0, jingProfit = 0, bothProfit = 0, momProfit = 0;

    filtered.forEach((sale: any) => {
      // 🔥 FIX: Ignore deposits here so Gross Sales stays accurate
      const customName = sale.custom_rice_type || sale.rice_type || '';
      if (customName.includes('កក់')) return;

      const qty = Number(sale.qty || 0);
      const price = Number(sale.price_per_bag || 0); 
      const cogs = Number(sale.cogs_price || 0);
      
      // 🔥 MATH FIX: Wrap in Math.round to prevent floating-point decimal leaks over thousands of rows
      const revenue = Math.round(qty * price); 
      const profit = Math.round((price - cogs) * qty);
      
      const owner = parseOwner(sale.owner);

      if (owner === 'mom') { momSales += revenue; momProfit += profit } 
      else {
        totalSales += revenue; totalProfit += profit;
        if (owner === 'pich') { pichSales += revenue; pichProfit += profit } else if (owner === 'jing') { jingSales += revenue; jingProfit += profit } else { bothSales += revenue; bothProfit += profit }
      }
    })
    return { totalSales, pichSales, jingSales, bothSales, momSales, totalProfit, pichProfit, jingProfit, bothProfit, momProfit }
  }

  function calculateCollections(paySet: any[], timeFilter: any) {
    const filtered = paySet.filter((p: any) => timeFilter(p.payment_date || p.created_at));
    let cR = 0, cU = 0, qR = 0, qU = 0;

    filtered.forEach((p: any) => {
      const methodStr = (p.payment_method || '').toLowerCase();
      if (methodStr.includes('unpaid') || methodStr.includes('debt') || methodStr.includes('liability')) return;

      const amtRiel = Number(p.amount_paid_riel || 0);
      const amtUsd = Number(p.amount_paid_usd || 0);
      const isUsd = methodStr.includes('$');
      const isQr = methodStr.includes('qr');

      if (isQr) {
         if (isUsd) qU += amtUsd;
         else qR += amtRiel;
      } else {
         if (isUsd) cU += amtUsd;
         else cR += amtRiel;
      }
    });

    return { cR, cU, qR, qU };
  }

  function calculateExpenses(expSet: any[], timeFilter: any) {
    const filtered = expSet.filter((e: any) => timeFilter(e.created_at))
    let bizCashRiel = 0, bizCashUsd = 0, bizQrRiel = 0, bizQrUsd = 0;
    let persCashRiel = 0, persCashUsd = 0, persQrRiel = 0, persQrUsd = 0;

    filtered.forEach((exp: any) => {
      if (parseOwner(exp.spender) === 'mom') return; 
      
      const desc = (exp.description || '').toUpperCase();
      if (desc === 'RETAIL' || desc === 'WHOLESALE' || desc.includes('STAFF_ADVANCE')) return;

      let amtRiel = Number(exp.amount_riel || 0); let amtUsd = Number(exp.amount_usd || 0);
      if (amtRiel < 0 && amtUsd <= 0) return;

      const methodStr = (exp.payment_method || '').toLowerCase();
      const type = (exp.description || '').toLowerCase()
      const isBiz = type === 'business' || type === 'biz' || type === 'staff';

      const processSplit = (m: string, aRiel: number, aUsd: number) => {
        const isQr = m.includes('qr');
        if (isBiz) {
          if (aUsd > 0) { isQr ? bizQrUsd += aUsd : bizCashUsd += aUsd; } else { isQr ? bizQrRiel += aRiel : bizCashRiel += aRiel; }
        } else {
          if (aUsd > 0) { isQr ? persQrUsd += aUsd : persCashUsd += aUsd; } else { isQr ? persQrRiel += aRiel : persCashRiel += aRiel; }
        }
      };

      if (methodStr.includes(':')) {
         methodStr.split(',').forEach((p: string) => {
           const [m, amtString] = p.split(':');
           let pAmt = Number(amtString) || 0; let pUsd = 0; let pRiel = pAmt;
           if (m.includes('$')) { pUsd = pAmt; pRiel = 0; }
           processSplit(m.trim(), Math.abs(pRiel), Math.abs(pUsd));
         });
      } else { processSplit(methodStr, Math.abs(amtRiel), Math.abs(amtUsd)); }
    })

    return { bizCashRiel, bizCashUsd, bizQrRiel, bizQrUsd, persCashRiel, persCashUsd, persQrRiel, persQrUsd }
  }

  function getTopPerformers(dataSet: any[], timeFilter: any) {
    const filtered = dataSet.filter((s: any) => timeFilter(s.created_at) && parseOwner(s.owner) !== 'mom');
    const map: Record<string, { name: string, qty: number, profit: number }> = {};
    
    filtered.forEach((sale: any) => {
      const name = sale.custom_rice_type || sale.rice_type || 'Unknown';
      // 🔥 FIX: Prevent "Deposit" from appearing as a top-selling product
      if (name.includes('កក់')) return;

      const qty = Number(sale.qty || 0);
      const price = Number(sale.price_per_bag || 0);
      const cogs = Number(sale.cogs_price || 0);
      const profit = (price - cogs) * qty;

      if (!map[name]) map[name] = { name, qty: 0, profit: 0 };
      map[name].qty += qty;
      map[name].profit += profit;
    });

    const arr = Object.values(map).filter(item => item.qty > 0 || item.profit > 0);
    const topByQty = [...arr].sort((a,b) => b.qty - a.qty).slice(0, 3);
    const topByProfit = [...arr].sort((a,b) => b.profit - a.profit).slice(0, 3);

    return { topByQty, topByProfit };
  }

  // 🔥 PERFORMANCE FIX: Memoize top performers to prevent UI freezing on keystrokes
  const { wholesaleTopMTD, retailTopMTD } = useMemo(() => ({
    wholesaleTopMTD: getTopPerformers(wholesaleSales, isMTD),
    retailTopMTD: getTopPerformers(retailSales, isMTD)
  }), [wholesaleSales, retailSales]);

  function calculateAssets() {
    let liveCashRiel = initCashRiel, liveCashUsd = initCashUsd;
    let liveQrRiel = initQrRiel, liveQrUsd = initQrUsd;
    
    let bizCreditRiel = 0, bizCreditUsd = 0;
    let totalSupplierAPRiel = 0;
    let totalSupplierAPUsd = 0;
    
    let momTotalCogsRiel = 0;
    let momTotalPaidRiel = 0;
    let momCustomerArRiel = 0; 
    
    let momCollectedRiel = 0, momCollectedUsd = 0;
    let momPaidOutRiel = 0, momPaidOutUsd = 0;
    let liabilityOffsetUsedRiel = 0, liabilityOffsetUsedUsd = 0; 
    
    let riceStockValue = 0;
    let staffDebtRiel = 0; 
    let staffDebtUsd = 0; 

    staffList.forEach((staff: any) => {
      staffDebtRiel += Number(staff.total_debt_riel) || 0;
      staffDebtUsd += Number(staff.total_debt_usd) || 0;
    });

    const productValuations: Record<number, { qty: number, totalValue: number, avgCost: number, batches: any[], unaccountedQty: number, unaccountedPrice: number }> = {};
    
    inventoryList.forEach((p: any) => {
      let isRetail = Number(p.weight || 50) < 50;
      let effectiveCostPrice = Number(p.cost_price || 0);

      // 🔥 FIX: Correctly calculates retail COGS dynamically based on its linked parent's actual weight
      if (isRetail) {
        if (p.linked_wholesale_id) {
          const parent = inventoryList.find(wp => wp.id === p.linked_wholesale_id);
          if (parent) {
            const pBatches = priceHistory.filter((b: any) => b.product_id === parent.id && Number(b.remaining_qty) > 0);
            pBatches.sort((a: any, b: any) => new Date((a as any).created_at).getTime() - new Date((b as any).created_at).getTime());
            const liveParentCogs = pBatches.length > 0 ? Number(pBatches[0].cost_price) : Number(parent.cost_price || 0);
            
            // 🛡️ MATH FIX: Divide by the parent's actual weight to support 25kg and 100kg bags
            const parentWeight = Number(parent.weight) || 50;
            effectiveCostPrice = liveParentCogs / parentWeight; 
          }
        } else if (effectiveCostPrice > 5000) {
          effectiveCostPrice = effectiveCostPrice / 50;
        }

        let pStock = Math.max(0, Number(p.stock || 0)); 
        let pValue = pStock * effectiveCostPrice;
        
        riceStockValue += pValue;
        productValuations[p.id] = { 
          qty: pStock, 
          totalValue: pValue, 
          avgCost: effectiveCostPrice, 
          batches: [],
          unaccountedQty: pStock,
          unaccountedPrice: effectiveCostPrice
        };
        return; 
      }

      let pStock = Math.max(0, Number(p.stock || 0)); 
      let pValue = 0; 
      
      const activeBatches = priceHistory.filter((b: any) => b.product_id === p.id && Number(b.remaining_qty) > 0);
      activeBatches.sort((a: any, b: any) => new Date((a as any).created_at).getTime() - new Date((b as any).created_at).getTime());

      const allocatedBatches: any[] = [];
      let remainingToAllocate = pStock;

      for (const b of activeBatches) {
          if (remainingToAllocate <= 0) break;
          let rem = Number(b.remaining_qty || 0);
          let take = Math.min(rem, remainingToAllocate);
          
          pValue += (take * Number(b.cost_price || 0));
          remainingToAllocate -= take;
          
          allocatedBatches.push({
              ...b,
              display_qty: take
          });
      }

      let unaccountedQty = remainingToAllocate;
      let unaccountedPrice = Number(p.cost_price || 0);
      if (unaccountedQty > 0) {
          pValue += (unaccountedQty * unaccountedPrice);
      }

      riceStockValue += pValue;
      productValuations[p.id] = { 
        qty: pStock, 
        totalValue: pValue, 
        avgCost: pStock > 0 ? pValue / pStock : Number(p.cost_price || 0), 
        batches: allocatedBatches,
        unaccountedQty: unaccountedQty,
        unaccountedPrice: unaccountedPrice
      };
    });

    accountsPayable.forEach((ap: any) => { 
      if (ap.status === 'Unpaid') {
        totalSupplierAPRiel += Number(ap.amount_riel || 0);
        totalSupplierAPUsd += Number(ap.amount_usd || 0);
      } 
    });

    const isBusinessMethod = (m: string) => {
        const lowerM = m.toLowerCase();
        if (lowerM.includes('mom qr')) return false; 
        return true; 
    };

    const addFunds = (amtRiel: number, method: string) => {
      const lowerM = (method || 'cash ៛').toLowerCase();
      if (lowerM.includes('liability') || lowerM.includes('mom qr')) return; 
      
      if (lowerM.includes('qr')) {
         if (lowerM.includes('$')) liveQrUsd += (amtRiel / EXCHANGE_RATE);
         else liveQrRiel += amtRiel;
      } else {
         if (lowerM.includes('$')) liveCashUsd += (amtRiel / EXCHANGE_RATE);
         else liveCashRiel += amtRiel;
      }
    }

    const subFunds = (amtRiel: number, method: string) => {
      const lowerM = (method || 'cash ៛').toLowerCase();
      if (lowerM.includes('liability') || lowerM.includes('mom qr')) return; 

      if (lowerM.includes('qr')) {
         if (lowerM.includes('$')) liveQrUsd -= (amtRiel / EXCHANGE_RATE);
         else liveQrRiel -= amtRiel;
      } else {
         if (lowerM.includes('$')) liveCashUsd -= (amtRiel / EXCHANGE_RATE);
         else liveCashRiel -= amtRiel;
      }
    }

    invoicePayments.forEach((p: any) => {
       const methodStr = (p.payment_method || '').toLowerCase();
       if (methodStr.includes('unpaid') || methodStr.includes('debt') || methodStr.includes('liability')) return;

       const amtRiel = Number(p.amount_paid_riel || 0);
       const amtUsd = Number(p.amount_paid_usd || 0);
       const isUsd = methodStr.includes('$');
       const eqRiel = isUsd ? amtUsd * EXCHANGE_RATE : amtRiel;

       if (isBusinessMethod(methodStr)) {
            addFunds(eqRiel, methodStr);
            
            let owner = parseOwner(p.recorded_by);
            
            const relatedInv = invoiceSummaries.find((inv: any) => inv.invoice_id === p.invoice_id);
            if (relatedInv) {
                owner = parseOwner(relatedInv.owner);
            } else {
                const relatedSale = wholesaleSales.find((s: any) => s.invoice_id === p.invoice_id) || retailSales.find((rs: any) => rs.transaction_id === p.invoice_id);
                if (relatedSale) owner = parseOwner(relatedSale.owner);
            }

            if (owner === 'mom' || methodStr.includes('mom qr')) {
                if (isUsd) momCollectedUsd += amtUsd;
                else momCollectedRiel += amtRiel;
            }
       }
    });

    retailSales.forEach((rs: any) => {
       const methodStr = (rs.payment_method || 'Cash ៛').toLowerCase();
       const totalRiel = Number(rs.total_sales || 0);

       if (isBusinessMethod(methodStr)) {
           // 1. Proper split parsing (You did this correctly!)
           if (methodStr.includes(':')) {
               methodStr.split(',').forEach((pStr: string) => {
                   const [mName, amtStr] = pStr.split(':');
                   let bAmt = Number(amtStr) || 0;
                   let isUsd = mName.includes('$');
                   let bAmtEq = isUsd ? bAmt * EXCHANGE_RATE : bAmt;
                   addFunds(bAmtEq, mName.trim());
               });
           } else {
               addFunds(totalRiel, methodStr);
           }
           
           // 2. 🚨 RESTORED: Mom Liability Tracking
           let owner = parseOwner(rs.owner);
           if (owner === 'mom' || methodStr.includes('mom qr')) {
               const isUsd = methodStr.includes('$');
               if (isUsd) momCollectedUsd += (totalRiel / EXCHANGE_RATE);
               else momCollectedRiel += totalRiel;
           }
       }
    });

    cogsSettlements.forEach((c: any) => {
       const owner = parseOwner(c.owner_name);
       const methodStr = (c.payment_method || '').toLowerCase();
       const totalAmtEq = Number(c.paid_amount_riel || 0);

       if (methodStr.includes(':')) {
          methodStr.split(',').forEach((p: string) => {
             const [mName, amtStr] = p.split(':');
             const lowerM = mName.trim().toLowerCase();
             let bAmtFace = Number(amtStr) || 0;
             let isUsd = lowerM.includes('$');
             let bAmtEq = isUsd ? bAmtFace * EXCHANGE_RATE : bAmtFace;

             if (lowerM.includes('liability')) {
                 if (owner === 'mom') {
                     if (isUsd) liabilityOffsetUsedUsd += bAmtFace;
                     else liabilityOffsetUsedRiel += bAmtFace;
                     momTotalPaidRiel += bAmtEq;
                 }
             } else {
                 addFunds(bAmtEq, mName.trim()); 
                 if (owner === 'mom') {
                     momTotalPaidRiel += bAmtEq; 
                 }
             }
          });
       } else {
          let isUsd = methodStr.includes('$');
          let faceValue = isUsd ? totalAmtEq / EXCHANGE_RATE : totalAmtEq;

          if (methodStr.includes('liability')) {
              if (owner === 'mom') {
                  if (isUsd) liabilityOffsetUsedUsd += faceValue;
                  else liabilityOffsetUsedRiel += faceValue;
                  momTotalPaidRiel += totalAmtEq;
              }
          } else {
              addFunds(totalAmtEq, c.payment_method); 
              if (owner === 'mom') {
                  momTotalPaidRiel += totalAmtEq; 
              }
          }
       }
    });

    expenses.forEach((e: any) => {
      const owner = parseOwner(e.spender);
      if (owner === 'mom') return;

      const desc = (e.description || '').toUpperCase();
      if (desc === 'RETAIL' || desc === 'WHOLESALE') return; 

      let amtRiel = Number(e.amount_riel || 0);
      let amtUsd = Number(e.amount_usd || 0);
      const paymentMethod = e.payment_method || 'Cash ៛';

      const totalRielValue = amtRiel !== 0 ? Math.abs(amtRiel) : Math.abs(amtUsd) * EXCHANGE_RATE;

      if (amtRiel < 0 || amtUsd < 0) {
         const remarks = (e.remarks || '').toLowerCase();
         if (remarks.includes('payment from') && !remarks.includes('cogs')) return;
         if (remarks.includes('account settled') && !remarks.includes('cogs')) return;

         if (paymentMethod.includes(':')) {
             paymentMethod.split(',').forEach((p: string) => {
               const [m, amtStr] = p.split(':');
               let bucketAmt = Number(amtStr) || 0;
               if (m.includes('$')) bucketAmt *= EXCHANGE_RATE;
               addFunds(Math.abs(bucketAmt), m.trim());
             });
         } else addFunds(totalRielValue, paymentMethod);
      } else {
         const remarks = (e.remarks || '').toLowerCase();
         if (remarks.includes("settled mom's account liability")) {
             if (paymentMethod.includes(':')) {
                 paymentMethod.split(',').forEach((p: string) => {
                     const [mName, amtStr] = p.split(':');
                     let bAmtFace = Number(amtStr) || 0;
                     let isUsd = mName.includes('$');
                     if (isUsd) momPaidOutUsd += bAmtFace;
                     else momPaidOutRiel += bAmtFace;
                 });
             } else {
                 let isUsd = paymentMethod.includes('$');
                 let faceValue = isUsd ? totalRielValue / EXCHANGE_RATE : totalRielValue;
                 if (isUsd) momPaidOutUsd += faceValue;
                 else momPaidOutRiel += faceValue;
             }
         }

         if (paymentMethod.includes(':')) {
             paymentMethod.split(',').forEach((p: string) => {
               const [m, amtStr] = p.split(':');
               let bucketAmt = Number(amtStr) || 0;
               if (m.includes('$')) bucketAmt *= EXCHANGE_RATE;
               subFunds(Math.abs(bucketAmt), m.trim());
             });
         } else subFunds(totalRielValue, paymentMethod);
      }
    });

    let bizExpRiel = 0, bizExpUsd = 0;
    let persExpRiel = 0, persExpUsd = 0;
    let riceExpRiel = 0, riceExpUsd = 0;

    expenses.filter((e: any) => isAssetMatch(e.created_at, assetFilter)).forEach((e: any) => {
        const owner = parseOwner(e.spender);
        if (owner === 'mom') return;

        const desc = (e.description || '').toUpperCase();
        if (desc === 'RETAIL' || desc === 'WHOLESALE' || desc.includes('STAFF_ADVANCE') || desc.includes('STAFF_SETTLEMENT')) return;

        let amtRiel = Number(e.amount_riel || 0); let amtUsd = Number(e.amount_usd || 0);
        if (amtRiel < 0 && amtUsd <= 0) return;
        
        const methodStr = (e.payment_method || '').toLowerCase();
        const remarks = (e.remarks || '').toLowerCase();
        
        let isRice = false, isBiz = false;
        if (remarks.includes('stock import') || remarks.includes('rice') || desc.includes('RICE') || desc.includes('COGS')) isRice = true;
        else if (desc === 'BUSINESS' || desc === 'BIZ' || desc === 'STAFF') isBiz = true;

        const distributeToBuckets = (pRiel: number, pUsd: number) => {
           if (isRice) { riceExpRiel += pRiel; riceExpUsd += pUsd; } 
           else if (isBiz) { bizExpRiel += pRiel; bizExpUsd += pUsd; } 
           else { persExpRiel += pRiel; persExpUsd += pUsd; }
        };

        if (methodStr.includes(':')) {
           methodStr.split(',').forEach((p: string) => {
              const [m, amtStr] = p.split(':');
              let pAmt = Number(amtStr) || 0;
              let pRiel = 0, pUsd = 0;
              if (m.includes('$')) pUsd = pAmt; else pRiel = pAmt;
              distributeToBuckets(Math.abs(pRiel), Math.abs(pUsd));
           });
        } else distributeToBuckets(Math.abs(amtRiel), Math.abs(amtUsd));
    });

    invoiceSummaries.forEach((inv: any) => {
       const owner = parseOwner(inv.owner);
       if (owner !== 'mom') {
           bizCreditRiel += Number(inv.balance_due || 0);
       } else {
           momCustomerArRiel += Number(inv.balance_due || 0);
       }
    });

    [...wholesaleSales, ...retailSales].forEach((s: any) => {
       const owner = parseOwner(s.owner);
       if (owner === 'mom') {
          let qty = Number(s.qty || 0);
          let price = Number(s.cogs_price || 0);
          let cogsAmt = qty * price;
          let desc = (s.custom_rice_type || s.rice_type || '').toLowerCase();
          
          if (!desc.includes('សេវាដឹក') && !(desc.includes('បាវ') && cogsAmt === 0)) {
              if (desc.includes('ដូរ') || desc.includes('បញ្ចុះតម្លៃ') || desc.includes('កក់') || cogsAmt < 0) {
                  momCollectedRiel += Math.abs(cogsAmt); 
              } else {
                  momTotalCogsRiel += Math.abs(cogsAmt);
              }
          }
       }
    });

    const liveMomLiabilityRiel = Math.max(0, persOweRiel + momCollectedRiel - momPaidOutRiel - liabilityOffsetUsedRiel);
    const liveMomLiabilityUsd = Math.max(0, persOweUsd + momCollectedUsd - momPaidOutUsd - liabilityOffsetUsedUsd);

    const momCogsArRiel = Math.max(0, momTotalCogsRiel - momTotalPaidRiel);

    const netWorthRiel = baseCapital + liveCashRiel + liveQrRiel + bizCreditRiel + familyOweRiel + momCogsArRiel + staffDebtRiel - totalSupplierAPRiel - liveMomLiabilityRiel;
    const netWorthUsd = liveCashUsd + liveQrUsd + familyOweUsd + staffDebtUsd - totalSupplierAPUsd - liveMomLiabilityUsd;

    const totalArRiel = bizCreditRiel + familyOweRiel + staffDebtRiel; 
    const totalArUsd = familyOweUsd + staffDebtUsd;

    return {
      liveCashRiel, liveCashUsd, liveQrRiel, liveQrUsd,
      bizCreditRiel, bizCreditUsd, momCogsArRiel, momCustomerArRiel, liveMomLiabilityRiel, liveMomLiabilityUsd, totalSupplierAPRiel, totalSupplierAPUsd, staffDebtRiel, staffDebtUsd,
      familyOweRiel, familyOweUsd,
      netWorthRiel, netWorthUsd, totalArRiel, totalArUsd, riceStockValue, productValuations,
      bizExpRiel, bizExpUsd, persExpRiel, persExpUsd, riceExpRiel, riceExpUsd
    };
  }

  // 🔥 PERFORMANCE FIX: Memoize all 8 heavy dashboard calculations into a single execution block
  const { todayM, mtdM, lastMonthM, todayC, mtdC, todayE, mtdE, lastMonthE } = useMemo(() => ({
    todayM: calculateMetrics(activeSalesData, isToday),
    mtdM: calculateMetrics(activeSalesData, isMTD),
    lastMonthM: calculateMetrics(activeSalesData, isLastMonth),
    todayC: calculateCollections(activeInvoicePayments, isToday),
    mtdC: calculateCollections(activeInvoicePayments, isMTD),
    todayE: calculateExpenses(expenses, isToday),
    mtdE: calculateExpenses(expenses, isMTD),
    lastMonthE: calculateExpenses(expenses, isLastMonth)
  }), [activeSalesData, activeInvoicePayments, expenses]);

  // 🔥 PERFORMANCE FIX: Memoize massive math calculations to stop typing lag
  const assetData = useMemo(() => calculateAssets(), [initCashRiel, initCashUsd, initQrRiel, initQrUsd, baseCapital, staffList, inventoryList, priceHistory, accountsPayable, invoicePayments, wholesaleSales, retailSales, cogsSettlements, expenses, persOweRiel, persOweUsd, familyOweRiel, familyOweUsd, assetFilter]);

  // --- 🔥 NEW: Filter and Sort Detailed Inventory ---
  const filteredAndSortedInventory = useMemo(() => {
    return inventoryList.filter((item: any) => {
      let isRetail = Number(item.weight || 50) < 50;
      let stock = Number(item.stock || 0);
      
      if (invTab === 'wholesale_active') return !isRetail && stock > 0;
      if (invTab === 'wholesale_oos') return !isRetail && stock <= 0;
      if (invTab === 'retail') return isRetail;
      return true;
    }).sort((a: any, b: any) => {
      if (!invSortConfig) return 0;
      const { key, direction } = invSortConfig;
      let valA, valB;

      if (key === 'name') {
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
      } else if (key === 'stock') {
          valA = Number(a.stock || 0);
          valB = Number(b.stock || 0);
      } else if (key === 'cost') {
          valA = assetData.productValuations[a.id]?.avgCost || 0;
          valB = assetData.productValuations[b.id]?.avgCost || 0;
      } else if (key === 'total') {
          valA = assetData.productValuations[a.id]?.totalValue || 0;
          valB = assetData.productValuations[b.id]?.totalValue || 0;
      }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [inventoryList, invTab, invSortConfig, assetData]);

  const generateDailyArray = (dataSet: any[], isTargetMonth: any) => {
    const dailySales = new Array(31).fill(0)
    const dailyProfit = new Array(31).fill(0)
    dataSet.filter((s: any) => isTargetMonth(s.created_at) && parseOwner(s.owner) !== 'mom').forEach((sale: any) => {
      // 🔥 FIX: Remove deposit from the graph calculations
      const customName = sale.custom_rice_type || sale.rice_type || '';
      if (customName.includes('កក់')) return;

      const dayIdx = getDayOfMonth(sale.created_at) - 1
      const qty = Number(sale.qty || 0);
      const price = Number(sale.price_per_bag || 0);
      const cogs = Number(sale.cogs_price || 0);
      
      if (dayIdx >= 0 && dayIdx < 31) {
        // 🔥 MATH FIX: Wrap in Math.round to prevent floating-point decimal leaks
        dailySales[dayIdx] += Math.round(qty * price);
        dailyProfit[dayIdx] += Math.round((price - cogs) * qty);
      }
    })
    return { dailySales, dailyProfit }
  }

  const thisMonthData = useMemo(() => generateDailyArray(activeSalesData, isMTD), [activeSalesData]);
  const lastMonthData = useMemo(() => generateDailyArray(activeSalesData, isLastMonth), [activeSalesData]);

  // 🔥 Determine the Branch Name for the Badge
  const activeBranchName = activeBranchId === 0 ? "Global HQ" : branches.find(b => b.id === activeBranchId)?.name || "Unknown";

  return (
    <AdminGuard>
      {/* 🔥 1. FLEXBOX WRAPPER: Locks page to exact screen height and prevents global scrolling */}
      <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', paddingBottom: 0 }}>
        
        {/* 🔥 2. HEADER (Frozen): Removed the wrapper with padding! */}
        <div className="header-container" style={{ flexShrink: 0 }}>
          <div className="header-left">
            <h1 className="saas-page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
              📊 Business Dashboard
              {/* DYNAMIC BRANCH BADGE */}
              <span style={{ 
                 fontSize: '11px', 
                 background: activeBranchId === 0 ? '#3b82f6' : '#10b981', 
                 color: '#fff', 
                 padding: '4px 8px', 
                 borderRadius: '4px', 
                 verticalAlign: 'middle', 
                 fontWeight: 'bold',
                 display: 'flex',
                 alignItems: 'center',
                 gap: '4px'
              }}>
                {activeBranchId === 0 ? '🌍' : '🏬'} {activeBranchName}
              </span>
            </h1>
          </div>
        </div>

        {/* 🔥 3. MAIN TABS (Frozen) */}
        <div className="saas-tab-container hide-scrollbar" style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch', marginBottom: activeTab === 'asset' ? '12px' : '24px', flexShrink: 0 }}>
          <button onClick={() => setActiveTab('summary')} className={`saas-tab ${activeTab === 'summary' ? 'active' : ''}`}>📈 Business Summary</button>
          <button onClick={() => setActiveTab('wholesale')} className={`saas-tab ${activeTab === 'wholesale' ? 'active' : ''}`}>🌾 Wholesale Data</button>
          <button onClick={() => setActiveTab('retail')} className={`saas-tab ${activeTab === 'retail' ? 'active' : ''}`}>🛍️ Retail Data</button>
          <button onClick={() => setActiveTab('asset')} className={`saas-tab ${activeTab === 'asset' ? 'active' : ''}`} style={activeTab === 'asset' ? { background: '#10b981', color: '#fff' } : {}}>💰 Business Asset</button>
        </div>

        {/* ASSET SUB-TAB CONTAINER (Frozen) */}
        {activeTab === 'asset' && (
          <div className="saas-tab-container hide-scrollbar" style={{ margin: '0 0 24px 0', padding: '4px', border: 'none', boxShadow: 'none', background: '#f1f5f9', display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch', flexShrink: 0 }}>
            {['today', 'yesterday', 'week', 'month', 'all'].map((f: any) => (
              <button 
                key={f} onClick={() => setAssetFilter(f)} 
                className={`saas-tab ${assetFilter === f ? 'active' : ''}`}
                style={assetFilter === f ? { background: '#0f172a', color: '#fff', padding: '8px 16px' } : { padding: '8px 16px' }}
              >
                {f === 'today' ? 'Today' : f === 'yesterday' ? 'Yesterday' : f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : f === 'all' ? 'All Time' : f}
              </button>
            ))}
          </div>
        )}

        {/* 🔥 4. SCROLLABLE CONTENT AREA: Takes up remaining space (flex: 1) and scrolls (overflowY: auto) */}
        <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: '60px' }}>
          
          {activeTab === 'asset' && (
            <div className="fade-in">

              {/* ONLY SHOW STARTING BALANCE EDITS IF NOT IN HQ MODE */}
              {activeBranchId !== 0 && (
                <div className="saas-card" style={{ padding: 0, marginBottom: '24px', overflow: 'hidden' }}>
                  <button 
                    onClick={() => setShowStartingBalance(!showStartingBalance)}
                    style={{ width: '100%', padding: '16px 24px', background: '#f8fafc', border: 'none', textAlign: 'left', fontWeight: 'bold', color: '#475569', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>⚙️</span> Manual Starting Balances
                    </span>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>{showStartingBalance ? '▲ CLOSE' : '▼ OPEN TO EDIT'}</span>
                  </button>
                  
                  {showStartingBalance && (
                    <div style={{ padding: '24px', borderTop: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', background: '#ffffff' }}>
                      {/* 🔥 RELIABILITY FIX: Stripped commas from CurrencyInput strings before parsing to prevent NaN math crashes */}
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Base Capital (៛)</label>
                        <CurrencyInput value={baseCapital} onChange={(v: any) => setBaseCapital(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('base_capital', baseCapital)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Initial Cash (៛)</label>
                        <CurrencyInput value={initCashRiel} onChange={(v: any) => setInitCashRiel(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('initial_cash_riel', initCashRiel)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Initial Cash ($)</label>
                        <CurrencyInput value={initCashUsd} onChange={(v: any) => setInitCashUsd(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('initial_cash_usd', initCashUsd)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Initial QR (៛)</label>
                        <CurrencyInput value={initQrRiel} onChange={(v: any) => setInitQrRiel(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('initial_qr_riel', initQrRiel)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Initial QR ($)</label>
                        <CurrencyInput value={initQrUsd} onChange={(v: any) => setInitQrUsd(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('initial_qr_usd', initQrUsd)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Family Owes Me (៛)</label>
                        <CurrencyInput value={familyOweRiel} onChange={(v: any) => setFamilyOweRiel(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('family_owe_riel', familyOweRiel)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Family Owes Me ($)</label>
                        <CurrencyInput value={familyOweUsd} onChange={(v: any) => setFamilyOweUsd(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('family_owe_usd', familyOweUsd)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Mom Starting Owe (៛)</label>
                        <CurrencyInput value={persOweRiel} onChange={(v: any) => setPersOweRiel(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('personal_owe_riel', persOweRiel)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: 'bold' }}>Mom Starting Owe ($)</label>
                        <CurrencyInput value={persOweUsd} onChange={(v: any) => setPersOweUsd(Number(String(v).replace(/,/g, '')) || 0)} onBlur={() => updateSetting('personal_owe_usd', persOweUsd)} className="saas-input" style={{ width: '100%', textAlign: 'left' }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                
                <div className="saas-card mint">
                  <div className="saas-card-title">💵 Total Net Worth</div>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline', margin: '12px 0 0 0' }}>
                    <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>{formatRiel(assetData.netWorthRiel)}</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#34d399' }}>{formatUSD(assetData.netWorthUsd)}</div>
                  </div>
                </div>

                <div className="saas-card mint">
                  <div className="saas-card-title">📦 Total Rice Stock Asset</div>
                  <div style={{ fontSize: '28px', margin: '12px 0 0 0', fontWeight: 'bold', color: '#10b981' }}>{formatRiel(assetData.riceStockValue)}</div>
                </div>

                <div className="saas-card">
                  <div className="saas-card-title">💵 Cash on Hand</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                    <div>
                      <div style={{ fontSize: '24px', color: '#334155', fontWeight: 'bold' }}>{formatRiel(assetData.liveCashRiel)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '24px', color: '#334155', fontWeight: 'bold' }}>{formatUSD(assetData.liveCashUsd)}</div>
                    </div>
                  </div>
                </div>

                <div className="saas-card">
                  <div className="saas-card-title">📱 Bank (QR Payments)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                    <div>
                      <div style={{ fontSize: '24px', color: '#3b82f6', fontWeight: 'bold' }}>{formatRiel(assetData.liveQrRiel)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '24px', color: '#3b82f6', fontWeight: 'bold' }}>{formatUSD(assetData.liveQrUsd)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <div className="saas-card">
                  <div className="saas-card-title">📒 Accounts Receivable (AR)</div>
                  <div style={{ display: 'flex', gap: '16px', margin: '12px 0' }}>
                    <div>
                      <div style={{ fontSize: '24px', color: '#f59e0b', fontWeight: 'bold' }}>{formatRiel(assetData.totalArRiel)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '24px', color: '#f59e0b', fontWeight: 'bold' }}>{formatUSD(assetData.totalArUsd)}</div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px', borderTop: '1px dashed #e2e8f0', paddingTop: '12px' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase' }}>Biz AR</span>
                      <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{formatRiel(assetData.bizCreditRiel)}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase' }}>Pers. AR</span>
                      <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{formatRiel(assetData.familyOweRiel)}</div>
                      <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{formatUSD(assetData.familyOweUsd)}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase' }}>Staff Debt</span>
                      <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{formatRiel(assetData.staffDebtRiel)}</div>
                      <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{formatUSD(assetData.staffDebtUsd)}</div>
                    </div>
                  </div>
                </div>

                <div className="saas-card" style={{ border: '1px solid #bbf7d0' }}>
                  <div className="saas-card-title" style={{ color: '#047857' }}>👩 Mom Receivables</div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: '#059669', fontWeight: 'bold', textTransform: 'uppercase' }}>Owed by Customers</span>
                      <div style={{ fontSize: '24px', color: '#10b981', fontWeight: 'bold', marginTop: '4px' }}>{formatRiel(assetData.momCustomerArRiel)}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', color: '#059669', fontWeight: 'bold', textTransform: 'uppercase' }}>COGS Owed to Biz</span>
                      <div style={{ fontSize: '24px', color: '#10b981', fontWeight: 'bold', marginTop: '4px' }}>{formatRiel(assetData.momCogsArRiel)}</div>
                    </div>
                  </div>
                </div>
                
                <div className="saas-card red">
                  <div className="saas-card-title">📉 Accounts Payable (Suppliers)</div>
                  <div style={{ fontSize: '24px', margin: '8px 0 4px 0', color: '#e11d48', fontWeight: 'bold' }}>{formatRiel(assetData.totalSupplierAPRiel)}</div>
                  <div style={{ fontSize: '20px', color: '#e11d48', fontWeight: 'bold' }}>{formatUSD(assetData.totalSupplierAPUsd)}</div>
                </div>

                <div className="saas-card red">
                  <div className="saas-card-title">📉 Personal Liability (Owe Mom)</div>
                  <div style={{ fontSize: '24px', margin: '8px 0 4px 0', color: '#e11d48', fontWeight: 'bold' }}>{formatRiel(assetData.liveMomLiabilityRiel)}</div>
                  <div style={{ fontSize: '20px', color: '#e11d48', fontWeight: 'bold' }}>{formatUSD(assetData.liveMomLiabilityUsd)}</div>
                </div>

                <div className="saas-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="saas-card-title" style={{ marginBottom: '16px' }}>📉 Operating & Capital Expenses</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                    
                    <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '8px' }}>BUSINESS EXPENSES</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '18px', color: '#ef4444', fontWeight: 'bold' }}>{formatRiel(assetData.bizExpRiel)}</div>
                        <div style={{ fontSize: '18px', color: '#ef4444', fontWeight: 'bold' }}>{formatUSD(assetData.bizExpUsd)}</div>
                      </div>
                    </div>

                    <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '8px' }}>PERSONAL EXPENSES</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '18px', color: '#f59e0b', fontWeight: 'bold' }}>{formatRiel(assetData.persExpRiel)}</div>
                        <div style={{ fontSize: '18px', color: '#f59e0b', fontWeight: 'bold' }}>{formatUSD(assetData.persExpUsd)}</div>
                      </div>
                    </div>

                    <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', marginBottom: '8px' }}>RICE / STOCK PURCHASES</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '18px', color: '#3b82f6', fontWeight: 'bold' }}>{formatRiel(assetData.riceExpRiel)}</div>
                        <div style={{ fontSize: '18px', color: '#3b82f6', fontWeight: 'bold' }}>{formatUSD(assetData.riceExpUsd)}</div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>

              <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1e293b', textTransform: 'uppercase' }}>🌾 Detailed Inventory Valuation</h3>
              
              <div className="saas-tab-container hide-scrollbar" style={{ border: 'none', padding: 0, boxShadow: 'none', margin: '0 0 16px 0', flexWrap: 'nowrap', overflowX: 'auto' }}>
                {invTabOrder.map(tab => {
                  const labels: any = {
                    wholesale_active: '🌾 Active Wholesale',
                    wholesale_oos: '❌ Out of Stock (Wholesale)',
                    retail: '🛍️ Retail (1kg)'
                  };
                  return (
                    <button
                      key={tab}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/invtab', tab); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sourceTab = e.dataTransfer.getData('text/invtab');
                        if (!sourceTab || sourceTab === tab) return;
                        setInvTabOrder(prev => {
                          const newOrder = prev.filter(t => t !== sourceTab);
                          newOrder.splice(newOrder.indexOf(tab), 0, sourceTab);
                          return newOrder;
                        });
                      }}
                      onClick={() => setInvTab(tab as any)}
                      className={`saas-tab ${invTab === tab ? 'active' : ''}`}
                      style={{ cursor: 'grab' }}
                    >
                      {labels[tab]}
                    </button>
                  )
                })}
              </div>

              <div className="saas-table-wrapper" style={{ marginBottom: '32px' }}>
                <div className="saas-table-responsive">
                  <table className="saas-table">
                    <thead>
                      <tr>
                        {[
                          { key: 'name', label: 'Product & Batches', align: 'left' },
                          { key: 'stock', label: 'Stock Qty', align: 'center' },
                          { key: 'cost', label: 'Cost Price', align: 'right' },
                          { key: 'total', label: 'Total Value (៛)', align: 'right' }
                        ].map(col => (
                          <th 
                            key={col.key}
                            className="saas-th"
                            onClick={() => {
                              let direction: 'asc' | 'desc' = 'asc';
                              if (invSortConfig && invSortConfig.key === col.key && invSortConfig.direction === 'asc') direction = 'desc';
                              setInvSortConfig({ key: col.key, direction });
                            }}
                            // 🔥 4. STICKY TABLE HEADER APPLIED HERE
                            style={{ 
                              textAlign: col.align as any, 
                              cursor: 'pointer', 
                              userSelect: 'none',
                              position: 'sticky', 
                              top: 0, 
                              zIndex: 30, 
                              backgroundColor: '#f8fafc', 
                              boxShadow: 'inset 0 -2px 0 0 #e2e8f0'
                            }}
                          >
                            {col.label}
                            <span style={{ marginLeft: '6px', fontSize: '12px', opacity: invSortConfig?.key === col.key ? 1 : 0.3 }}>
                              {invSortConfig?.key === col.key ? (invSortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        <TableSkeleton columns={4} rows={6} />
                      ) : filteredAndSortedInventory.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ padding: 0 }}>
                            <EmptyState 
                              icon="📦" 
                              title="No products found" 
                              message="There are no inventory items matching this tab." 
                            />
                          </td>
                        </tr>
                      ) : (
                        filteredAndSortedInventory.map((item: any) => {
                          const valData = assetData.productValuations[item.id];
                          if (!valData) return null;

                          const displayRows: any[] = [];

                          valData.batches.forEach((b: any, idx: number) => {
                             displayRows.push({
                                isMain: idx === 0,
                                label: idx === 0 ? item.name : `↳ ${idx + 1}${idx === 1 ? 'nd' : idx === 2 ? 'rd' : 'th'} batch`,
                                qty: b.display_qty,
                                cost: Number(b.cost_price || 0),
                                total: b.display_qty * Number(b.cost_price || 0),
                                id: b.id
                             });
                          });

                          if (valData.unaccountedQty > 0) {
                             displayRows.push({
                                isMain: displayRows.length === 0,
                                label: displayRows.length === 0 ? item.name : `↳ unlinked stock`,
                                qty: valData.unaccountedQty,
                                cost: valData.unaccountedPrice,
                                total: valData.unaccountedQty * valData.unaccountedPrice,
                                // 🔥 RELIABILITY FIX: Appended item.id to prevent duplicate React key rendering errors
                                id: `unaccounted_${item.id}`
                             });
                          }

                          if (displayRows.length === 0) {
                             displayRows.push({
                                isMain: true,
                                label: item.name,
                                qty: 0,
                                cost: valData.avgCost,
                                total: 0,
                                // 🔥 RELIABILITY FIX: Appended item.id to prevent duplicate React key rendering errors
                                id: `empty_${item.id}`
                             });
                          }

                          return (
                            <React.Fragment key={item.id}>
                              {displayRows.map((row: any, rIdx: number) => {
                                 const isLast = rIdx === displayRows.length - 1;
                                 return (
                                   <tr key={row.id} className="saas-tr" style={{ borderBottom: isLast ? '1px solid #f1f5f9' : 'none', background: row.isMain ? '#ffffff' : '#f8fafc' }}>
                                     <td className="saas-td" style={{ padding: row.isMain ? '14px 20px' : '8px 20px 8px 40px', color: row.isMain ? '#1e293b' : '#64748b', fontWeight: row.isMain ? 'bold' : 'normal', fontSize: row.isMain ? '14px' : '12px' }}>
                                       {row.label}
                                     </td>
                                     <td className="saas-td" style={{ padding: row.isMain ? '14px 20px' : '8px 20px', textAlign: 'center', color: (row.qty < 10 && row.isMain) ? '#ef4444' : '#475569', fontWeight: row.isMain ? 'bold' : 'normal', fontSize: row.isMain ? '14px' : '13px' }}>
                                       {formatNumber(row.qty)}
                                     </td>
                                     <td className="saas-td" style={{ padding: row.isMain ? '14px 20px' : '8px 20px', textAlign: 'right', color: '#64748b', fontWeight: 'bold', fontSize: row.isMain ? '14px' : '13px' }}>
                                       {formatRiel(row.cost)}
                                     </td>
                                     <td className="saas-td" style={{ padding: row.isMain ? '14px 20px' : '8px 20px', textAlign: 'right', color: '#10b981', fontWeight: row.isMain ? 'bold' : 'normal', fontSize: row.isMain ? '14px' : '13px' }}>
                                       {formatRiel(row.total)}
                                     </td>
                                   </tr>
                                 )
                              })}
                            </React.Fragment>
                          )
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={3} style={{ padding: '16px 20px', textAlign: 'right', color: '#334155', fontWeight: 'bold' }}>Global Inventory Asset Value</td>
                        <td style={{ padding: '16px 20px', textAlign: 'right', color: '#b58a3d', fontWeight: 'bold', fontSize: '16px' }}>{formatRiel(assetData.riceStockValue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

            </div>
          )}

          {activeTab !== 'asset' && (
            <div className="fade-in">

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📅 TODAY'S PERFORMANCE</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <ComplexCard title="Today Sales" total={todayM.totalSales} pich={todayM.pichSales} jing={todayM.jingSales} both={todayM.bothSales} mom={todayM.momSales} hideSubboxes={activeTab === 'retail'} color="#2563eb" hideUsdEquiv={true} />
                <ComplexCard title="Today Profit" total={todayM.totalProfit} pich={todayM.pichProfit} jing={todayM.jingProfit} both={todayM.bothProfit} mom={todayM.momProfit} hideSubboxes={activeTab === 'retail'} color="#10b981" hideUsdEquiv={true} />
                
                <ExpenseBreakdownCard title="Cash Collected (Direct)" cR={todayC.cR} cU={todayC.cU} qR={todayC.qR} qU={todayC.qU} color="#3b82f6" />
                
                {activeTab === 'summary' && (
                  <>
                    <ExpenseBreakdownCard title="Today Biz Expenses" cR={todayE.bizCashRiel} cU={todayE.bizCashUsd} qR={todayE.bizQrRiel} qU={todayE.bizQrUsd} color="#b91c1c" />
                    <ExpenseBreakdownCard title="Today Personal Exp" cR={todayE.persCashRiel} cU={todayE.persCashUsd} qR={todayE.persQrRiel} qU={todayE.persQrUsd} color="#f59e0b" />
                  </>
                )}
              </div>

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📈 MONTH TO DATE (MTD)</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <ComplexCard title="MTD Sales" total={mtdM.totalSales} pich={mtdM.pichSales} jing={mtdM.jingSales} both={mtdM.bothSales} mom={mtdM.momSales} hideSubboxes={activeTab === 'retail'} color="#2563eb" />
                <ComplexCard title="MTD Profit" total={mtdM.totalProfit} pich={mtdM.pichProfit} jing={mtdM.jingProfit} both={mtdM.bothProfit} mom={mtdM.momProfit} hideSubboxes={activeTab === 'retail'} color="#10b981" />
                
                <ExpenseBreakdownCard title="Cash Collected (Direct)" cR={mtdC.cR} cU={mtdC.cU} qR={mtdC.qR} qU={mtdC.qU} color="#3b82f6" />
                
                {activeTab === 'summary' && (
                  <>
                    <ExpenseBreakdownCard title="MTD Biz Expenses" cR={mtdE.bizCashRiel} cU={mtdE.bizCashUsd} qR={mtdE.bizQrRiel} qU={mtdE.bizQrUsd} color="#b91c1c" />
                    <ExpenseBreakdownCard title="MTD Personal Exp" cR={mtdE.persCashRiel} cU={mtdE.persCashUsd} qR={mtdE.persQrRiel} qU={mtdE.persQrUsd} color="#f59e0b" />
                  </>
                )}
              </div>

              {activeTab === 'summary' && (
                <>
                  <h2 className="section-divider" style={{ fontWeight: 'bold' }}>🏆 MTD TOP PERFORMERS (WHOLESALE)</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                    <TopPerformersCard title="Top 3 Wholesale (By Volume)" data={wholesaleTopMTD.topByQty} type="qty" />
                    <TopPerformersCard title="Top 3 Wholesale (By Profit)" data={wholesaleTopMTD.topByProfit} type="profit" />
                  </div>
                  
                  <h2 className="section-divider" style={{ fontWeight: 'bold' }}>🏆 MTD TOP PERFORMERS (RETAIL)</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                    <TopPerformersCard title="Top 3 Retail (By Volume)" data={retailTopMTD.topByQty} type="qty" />
                    <TopPerformersCard title="Top 3 Retail (By Profit)" data={retailTopMTD.topByProfit} type="profit" />
                  </div>
                </>
              )}

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>⚖️ COMPARE MTD VS LAST MONTH</h2>
              <div className="saas-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <HealthBar title="Sales" current={mtdM.totalSales} target={lastMonthM.totalSales} color="#2563eb" />
                <HealthBar title="Profit" current={mtdM.totalProfit} target={lastMonthM.totalProfit} color="#10b981" />
                {activeTab === 'summary' && (
                  <>
                    <HealthBar title="Biz Expenses" current={mtdE.bizCashRiel + mtdE.bizQrRiel + (mtdE.bizCashUsd*EXCHANGE_RATE)} target={lastMonthE.bizCashRiel + lastMonthE.bizQrRiel + (lastMonthE.bizCashUsd*EXCHANGE_RATE)} color="#b91c1c" reverseLogic />
                    <HealthBar title="Personal Expenses" current={mtdE.persCashRiel + mtdE.persQrRiel + (mtdE.persCashUsd*EXCHANGE_RATE)} target={lastMonthE.persCashRiel + lastMonthE.persQrRiel + (lastMonthE.persCashUsd*EXCHANGE_RATE)} color="#f59e0b" reverseLogic />
                  </>
                )}
              </div>

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📉 TREND ANALYSIS (Day 1 - 31)</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '40px' }}>
                <LineChartCard title={`${activeTab === 'summary' ? 'Total' : activeTab === 'wholesale' ? 'Wholesale' : 'Retail'} Sales: This Month vs Last Month`} dataCurrent={thisMonthData.dailySales} dataLast={lastMonthData.dailySales} color="#2563eb" />
                <LineChartCard title={`${activeTab === 'summary' ? 'Total' : activeTab === 'wholesale' ? 'Wholesale' : 'Retail'} Profit: This Month vs Last Month`} dataCurrent={thisMonthData.dailyProfit} dataLast={lastMonthData.dailyProfit} color="#10b981" />
              </div>
            </div>
          )}
        </div>

        <style jsx global>{`
          /* 🔥 BULLETPROOF GLOBAL OVERRIDE FOR MOBILE TABS 🔥 */
          .saas-tab-container {
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
            scrollbar-width: none !important;
            max-width: 100%;
          }
          .saas-tab-container::-webkit-scrollbar {
            display: none !important;
          }
          .saas-tab {
            flex-shrink: 0 !important;
            white-space: nowrap !important;
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
            width: calc(100vw - 84px);
            max-width: 1550px;
            box-sizing: border-box;
          }
          
          .header-left {
            display: flex;
            align-items: center; 
            gap: 12px;
          }

          .section-divider { font-size: 15px; color: #475569; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
          .fade-in { animation: fadeIn 0.3s ease-in-out; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
          input[type="text"].no-spinners::-webkit-inner-spin-button, input[type="text"].no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
          
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          
          /* 🔥 MOBILE LAYOUT FIXES */
          @media (max-width: 1023px) { 
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
              width: calc(100vw - 70px) !important;
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
    </AdminGuard>
  )
}

function TopPerformersCard({ title, data, type }: any) {
  return (
    <div className="saas-card">
      <h3 className="saas-card-title">{title}</h3>
      {data.length === 0 ? <div style={{ fontSize: '13px', color: '#94a3b8' }}>No data available.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {data.map((item: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              <div style={{ fontSize: '14px', color: '#334155', fontWeight: 'bold' }}>{idx + 1}. {item.name}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '15px', color: type === 'qty' ? '#2563eb' : '#10b981', fontWeight: 'bold' }}>
                  {type === 'qty' ? `${formatNumber(item.qty)} Sold` : formatRiel(item.profit)}
                </div>
                {type === 'qty' && <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 'bold' }}>Profit: {formatRiel(item.profit)}</div>}
                {type === 'profit' && <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: 'bold' }}>Vol: {formatNumber(item.qty)} Sold</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ComplexCard({ title, total, pich = 0, jing = 0, both = 0, mom = 0, hideSubboxes = false, hideUsdEquiv = false, color = '#1e293b' }: any) {
  return (
    <div className="saas-card">
      <h3 className="saas-card-title">{title}</h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <h2 style={{ margin: '8px 0 4px 0', fontSize: '22px', color: color, fontWeight: 'bold' }}>{formatRiel(total)}</h2>
      </div>
      {!hideUsdEquiv && (
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', fontWeight: 'bold' }}>{formatUSDEquiv(total)}</div>
      )}
      {hideUsdEquiv && <div style={{ height: '16px', marginBottom: '16px' }}></div>}
      
      {!hideSubboxes && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
          <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 'bold' }}>Pich</div>
            <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px', fontWeight: 'bold' }}>{formatRiel(pich)}</div>
          </div>
          <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 'bold' }}>Jing</div>
            <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px', fontWeight: 'bold' }}>{formatRiel(jing)}</div>
          </div>
          <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 'bold' }}>Both</div>
            <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px', fontWeight: 'bold' }}>{formatRiel(both)}</div>
          </div>
          <div style={{ background: '#fefcf3', padding: '6px', borderRadius: '6px', textAlign: 'center', border: '1px solid #fde047' }}>
            <div style={{ fontSize: '10px', color: '#ca8a04', textTransform: 'uppercase', fontWeight: 'bold' }}>Mom</div>
            <div style={{ fontSize: '12px', color: '#854d0e', marginTop: '2px', fontWeight: 'bold' }}>{formatRiel(mom)}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function ExpenseBreakdownCard({ title, cR = 0, cU = 0, qR = 0, qU = 0, color = '#1e293b' }: any) {
  const totalRiel = cR + qR;
  const totalUsd = cU + qU;
  
  return (
    <div className="saas-card">
      <h3 className="saas-card-title">{title}</h3>
      
      <div style={{ display: 'flex', gap: '16px', margin: '12px 0 16px 0' }}>
        <div style={{ fontSize: '22px', color: color, fontWeight: 'bold' }}>{formatRiel(totalRiel)}</div>
        {totalUsd > 0 && <div style={{ fontSize: '22px', color: color, fontWeight: 'bold' }}>{formatUSD(totalUsd)}</div>}
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: 'bold' }}>Cash: <span style={{fontWeight: 'bold', color: '#334155'}}>{formatRiel(cR)}</span></div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>QR: <span style={{fontWeight: 'bold', color: '#334155'}}>{formatRiel(qR)}</span></div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: 'bold' }}>Cash: <span style={{fontWeight: 'bold', color: '#334155'}}>{formatUSD(cU)}</span></div>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>QR: <span style={{fontWeight: 'bold', color: '#334155'}}>{formatUSD(qU)}</span></div>
        </div>
      </div>
    </div>
  )
}

function HealthBar({ title, current, target, color, reverseLogic = false }: any) {
  let pct = target > 0 ? (current / target) * 100 : (current > 0 ? 100 : 0);
  let displayPct = pct.toFixed(1);
  let barWidth = Math.min(100, Math.max(0, pct));
  let barColor = color;
  if (!reverseLogic) {
    if (pct < 50) barColor = '#ef4444'; else if (pct >= 100) barColor = '#10b981'; 
  } else {
    if (pct > 100) barColor = '#ef4444'; else if (pct < 80) barColor = '#10b981'; 
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '6px', color: '#334155', fontWeight: 'bold' }}>
        <span>{title}</span><span style={{ color: barColor }}>{displayPct}%</span>
      </div>
      <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
        <div style={{ width: `${barWidth}%`, height: '100%', background: barColor, borderRadius: '5px', transition: 'width 0.5s ease-in-out' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>This MTD</span>
          <span style={{ fontSize: '13px', color: '#334155', fontWeight: 'bold' }}>{formatRiel(current)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
          <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Last Month</span>
          <span style={{ fontSize: '13px', color: '#334155', fontWeight: 'bold' }}>{formatRiel(target)}</span>
        </div>
      </div>
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