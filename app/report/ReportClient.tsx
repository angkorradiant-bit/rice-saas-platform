'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatRiel, formatUSD, formatNumber, parseOwner, EXCHANGE_RATE } from '@/utils/formatters'
import { useToast } from '@/components/ToastProvider'
import TableSkeleton from '@/components/TableSkeleton'
import { TELEGRAM_CONFIG } from '@/lib/telegramConfig'
import { useBranch } from '@/components/BranchContext' 
import AdminGuard from '@/components/AdminGuard' 

const formatUSDEquiv = (vRiel: number) => formatUSD(vRiel / EXCHANGE_RATE);

export default function ReportControlPage() {
  const { showToast } = useToast()
  const { activeBranchId } = useBranch() 

  const [loading, setLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [activeReportTab, setActiveReportTab] = useState<'daily' | 'monthly'>('daily')

  const [wholesaleSales, setWholesaleSales] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [retailSales, setRetailSales] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [invoicePayments, setInvoicePayments] = useState<any[]>([])

  useEffect(() => {
    // 💣 SECURITY WIPE: Clear all report arrays instantly on branch switch
    // to prevent "Ghost Dashboards" from showing Branch A's data while Branch B loads.
    setWholesaleSales([])
    setInvoices([])
    setRetailSales([])
    setExpenses([])
    setInvoicePayments([])

    fetchReportData()

    // 📡 WEBSOCKET ISOLATION: Append activeBranchId to the channel
    // to prevent Branch A's transactions from triggering Branch B's refetches!
    const reportSyncChannel = supabase.channel(`report-live-sync-${activeBranchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => fetchReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retail_sales' }, () => fetchReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => fetchReportData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_payments' }, () => fetchReportData())
      .subscribe();

    return () => {
      supabase.removeChannel(reportSyncChannel);
    }
  }, [activeBranchId])

  // --- 1. FETCH SUPABASE DATA (OPTIMIZED PAYLOADS) ---
  async function fetchReportData() {
    setLoading(true)
    try {
      const now = new Date()
      const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()

      const buildQNarrow = (table: string, columns: string) => {
        let q = supabase.from(table).select(columns);
        if (activeBranchId !== 0) q = q.eq('branch_id', activeBranchId);
        return q;
      }

      const [
        { data: salesData },
        { data: invData },
        { data: retData },
        { data: expData },
        { data: payData }
      ] = await Promise.all([
        buildQNarrow('sales', 'id, created_at, qty, price_per_bag, cogs_price, owner, custom_rice_type, rice_type').gte('created_at', firstDayOfLastMonth),
        
        // 🔥 FIX 1: Added 'delivery_status' to the SELECT query so we can identify voids
        buildQNarrow('invoice_summaries', 'invoice_id, created_at, owner, total_sales, total_profit, delivery_status').gte('created_at', firstDayOfLastMonth),
        
        buildQNarrow('retail_sales', 'id, created_at, qty, price_per_bag, cogs_price, owner, custom_rice_type, rice_type').gte('created_at', firstDayOfLastMonth),
        // 🛡️ BUG FIX: Changed 'category' to 'remarks' to prevent 400 Bad Request database crash
        buildQNarrow('expenses', 'id, created_at, amount_riel, amount_usd, spender, remarks, description, expense_date').gte('created_at', firstDayOfLastMonth),
        buildQNarrow('invoice_payments', 'invoice_id, amount_paid_usd, amount_paid_riel, payment_method, payment_date').gte('payment_date', firstDayOfLastMonth)
      ])

      setWholesaleSales(salesData || [])
      
      // 🔥 FIX 2: Strictly filter out any invoice marked as 'Voided' before saving to state
      const activeInvoices = (invData || []).filter((inv: any) => inv.delivery_status !== 'Voided');
      setInvoices(activeInvoices);
      
      setRetailSales(retData || [])
      setExpenses(expData || [])
      setInvoicePayments(payData || [])
    } catch (err: any) {
      showToast('error', 'Fetch Error', 'Failed to load report data.')
    } finally {
      setLoading(false)
    }
  }

  // --- 2. DATE HELPER FUNCTIONS ---
  const now = new Date()
  const isToday = (dateStr: string) => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }
  const isMTD = (dateStr: string) => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }
  const isLastMonth = (dateStr: string) => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear()
  }
  const getDayOfMonth = (dateStr: string) => {
    if (!dateStr) return 1
    return new Date(dateStr).getDate()
  }

  // --- 3. TELEGRAM NUMBER CRUNCHING ENGINE ---
  const reportMetrics = useMemo(() => {
    const calculateSlice = (invSlice: any[], retSlice: any[], expSlice: any[]) => {
      let totalSales = 0
      let totalProfit = 0
      const profitByOwner = { Pich: 0, Jing: 0, Both: 0 }

      invSlice.forEach(inv => {
        const owner = parseOwner(inv.owner);
        if (owner === 'mom') return; // 🚫 Completely exclude Mom

        const sales = Number(inv.total_sales) || 0
        const profit = Number(inv.total_profit) || 0
        totalSales += sales
        totalProfit += profit

        if (owner === 'pich') profitByOwner.Pich += profit;
        else if (owner === 'jing') profitByOwner.Jing += profit;
        else profitByOwner.Both += profit;
      })

      retSlice.forEach(ret => {
        const owner = parseOwner(ret.owner);
        if (owner === 'mom') return; // 🚫 Completely exclude Mom

        const customName = ret.custom_rice_type || ret.rice_type || '';
        // 🔥 FIX: Ignore deposits here so Gross Sales stays accurate
        if (customName.includes('កក់')) return;

        const qty = Number(ret.qty) || 0
        const price = Number(ret.price_per_bag) || 0
        const cogs = Number(ret.cogs_price) || 0
        
        // 🔥 FIX: Prevent floating-point decimal leaks
        let sales = Math.round(qty * price);
        let profit = Math.round((price - cogs) * qty);

        // 🔥 FIX: Subtract refunds and discounts instead of adding them
        const isNegativeItem = customName.includes('ដូរ') || customName.includes('បញ្ចុះតម្លៃ');
        if (isNegativeItem) {
           sales = -Math.abs(sales);
           profit = -Math.abs(profit);
        }

        totalSales += sales
        totalProfit += profit
        
        if (owner === 'pich') profitByOwner.Pich += profit;
        else if (owner === 'jing') profitByOwner.Jing += profit;
        else profitByOwner.Both += profit;
      })

      // 🔥 Split expenses into Business vs Personal
      const expenseBySpender = {
        Pich: { bizRiel: 0, bizUsd: 0, persRiel: 0, persUsd: 0 },
        Jing: { bizRiel: 0, bizUsd: 0, persRiel: 0, persUsd: 0 },
        Both: { bizRiel: 0, bizUsd: 0, persRiel: 0, persUsd: 0 }
      }

      let totalBizExpRiel = 0, totalBizExpUsd = 0;
      let totalPersExpRiel = 0, totalPersExpUsd = 0;
      const categoryBreakdown: Record<string, { riel: number; usd: number }> = {}

      expSlice.forEach(exp => {
        const spender = parseOwner(exp.spender);
        if (spender === 'mom') return; // 🚫 Completely exclude Mom

        const riel = Number(exp.amount_riel) || 0
        const usd = Number(exp.amount_usd) || 0
        
        let expKey: 'Pich' | 'Jing' | 'Both' = 'Both';
        if (spender === 'pich') expKey = 'Pich';
        else if (spender === 'jing') expKey = 'Jing';

        const type = (exp.description || '').toLowerCase()
        const isBiz = type === 'business' || type === 'biz' || type === 'staff'

        if (isBiz) {
          expenseBySpender[expKey].bizRiel += riel
          expenseBySpender[expKey].bizUsd += usd
          totalBizExpRiel += riel
          totalBizExpUsd += usd
        } else {
          expenseBySpender[expKey].persRiel += riel
          expenseBySpender[expKey].persUsd += usd
          totalPersExpRiel += riel
          totalPersExpUsd += usd
        }

        // 🛡️ BUG FIX: Mapping to 'remarks' instead of the non-existent 'category'
        const cat = exp.remarks || exp.description || 'Uncategorized'
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { riel: 0, usd: 0 }
        categoryBreakdown[cat].riel += riel
        categoryBreakdown[cat].usd += usd
      })

      return {
        totalSales,
        totalProfit,
        profitByOwner,
        expenseBySpender,
        totalBizExpRiel,
        totalBizExpUsd,
        totalPersExpRiel,
        totalPersExpUsd,
        totalExpRiel: totalBizExpRiel + totalPersExpRiel, // Kept for UI dashboard compatibility
        totalExpUsd: totalBizExpUsd + totalPersExpUsd,    // Kept for UI dashboard compatibility
        categoryBreakdown
      }
    }

    const monthSlice = calculateSlice(
      invoices.filter(i => isMTD(i.created_at)),
      retailSales.filter(r => isMTD(r.created_at)),
      expenses.filter(e => isMTD(e.expense_date || e.created_at))
    )
    const todaySlice = calculateSlice(
      invoices.filter(i => isToday(i.created_at)),
      retailSales.filter(r => isToday(r.created_at)),
      expenses.filter(e => isToday(e.expense_date || e.created_at))
    )

    return { month: monthSlice, today: todaySlice }
  }, [invoices, retailSales, expenses])

  // --- 4. BUSINESS SUMMARY CALCULATIONS ---
  const activeSalesData = useMemo(() => [...wholesaleSales, ...retailSales], [wholesaleSales, retailSales])

  function calculateMetrics(dataSet: any[], timeFilter: any) {
    const filtered = dataSet.filter((s: any) => timeFilter(s.created_at))
    let totalSales = 0, pichSales = 0, jingSales = 0, bothSales = 0, momSales = 0
    let totalProfit = 0, pichProfit = 0, jingProfit = 0, bothProfit = 0, momProfit = 0

    filtered.forEach((sale: any) => {
      const customName = sale.custom_rice_type || sale.rice_type || '';
      if (customName.includes('កក់')) return;

      const qty = Number(sale.qty || 0)
      const price = Number(sale.price_per_bag || 0)
      const cogs = Number(sale.cogs_price || 0)
      
      let revenue = Math.round(qty * price);
      let profit = Math.round((price - cogs) * qty);
      
      const isNegativeItem = customName.includes('ដូរ') || customName.includes('បញ្ចុះតម្លៃ');
      if (isNegativeItem) {
          revenue = -Math.abs(revenue);
          profit = -Math.abs(profit);
      }
      
      const owner = parseOwner(sale.owner)

      if (owner === 'mom') { momSales += revenue; momProfit += profit }
      else {
        totalSales += revenue; totalProfit += profit
        if (owner === 'pich') { pichSales += revenue; pichProfit += profit } else if (owner === 'jing') { jingSales += revenue; jingProfit += profit } else { bothSales += revenue; bothProfit += profit }
      }
    })
    return { totalSales, pichSales, jingSales, bothSales, momSales, totalProfit, pichProfit, jingProfit, bothProfit, momProfit }
  }

  function calculateCollections(paySet: any[], timeFilter: any) {
    const filtered = paySet.filter((p: any) => timeFilter(p.payment_date || p.created_at))
    let cR = 0, cU = 0, qR = 0, qU = 0

    filtered.forEach((p: any) => {
      const methodStr = (p.payment_method || '').toLowerCase()
      if (methodStr.includes('unpaid') || methodStr.includes('debt') || methodStr.includes('liability')) return

      const amtRiel = Number(p.amount_paid_riel || 0)
      const amtUsd = Number(p.amount_paid_usd || 0)
      const isUsd = methodStr.includes('$')
      const isQr = methodStr.includes('qr')

      if (isQr) {
        if (isUsd) qU += amtUsd; else qR += amtRiel
      } else {
        if (isUsd) cU += amtUsd; else cR += amtRiel
      }
    })

    return { cR, cU, qR, qU }
  }

  function calculateExpensesSummary(expSet: any[], timeFilter: any) {
    const filtered = expSet.filter((e: any) => timeFilter(e.created_at))
    let bizCashRiel = 0, bizCashUsd = 0, bizQrRiel = 0, bizQrUsd = 0
    let persCashRiel = 0, persCashUsd = 0, persQrRiel = 0, persQrUsd = 0

    filtered.forEach((exp: any) => {
      if (parseOwner(exp.spender) === 'mom') return
      
      const desc = (exp.description || '').toUpperCase()
      if (desc === 'RETAIL' || desc === 'WHOLESALE' || desc.includes('STAFF_ADVANCE') || desc.includes('STAFF_SETTLEMENT')) return

      let amtRiel = Number(exp.amount_riel || 0); let amtUsd = Number(exp.amount_usd || 0)
      if (amtRiel < 0 && amtUsd <= 0) return

      const methodStr = (exp.payment_method || '').toLowerCase()
      const type = (exp.description || '').toLowerCase()
      const isBiz = type === 'business' || type === 'biz' || type === 'staff'

      const processSplit = (m: string, aRiel: number, aUsd: number) => {
        const isQr = m.includes('qr')
        if (isBiz) {
          if (aUsd > 0) { isQr ? bizQrUsd += aUsd : bizCashUsd += aUsd } else { isQr ? bizQrRiel += aRiel : bizCashRiel += aRiel }
        } else {
          if (aUsd > 0) { isQr ? persQrUsd += aUsd : persCashUsd += aUsd } else { isQr ? persQrRiel += aRiel : persCashRiel += aRiel }
        }
      }

      if (methodStr.includes(':')) {
         methodStr.split(',').forEach((p: string) => {
           const [m, amtString] = p.split(':')
           let pAmt = Number(amtString) || 0; let pUsd = 0; let pRiel = pAmt
           if (m.includes('$')) { pUsd = pAmt; pRiel = 0 }
           processSplit(m.trim(), Math.abs(pRiel), Math.abs(pUsd))
         })
      } else { processSplit(methodStr, Math.abs(amtRiel), Math.abs(amtUsd)) }
    })

    return { bizCashRiel, bizCashUsd, bizQrRiel, bizQrUsd, persCashRiel, persCashUsd, persQrRiel, persQrUsd }
  }

  function getTopPerformers(dataSet: any[], timeFilter: any) {
    const filtered = dataSet.filter((s: any) => timeFilter(s.created_at) && parseOwner(s.owner) !== 'mom')
    const map: Record<string, { name: string, qty: number, profit: number }> = {}
    
    filtered.forEach((sale: any) => {
      const name = sale.custom_rice_type || sale.rice_type || 'Unknown'
      if (name.includes('កក់')) return;

      const qty = Number(sale.qty || 0)
      const price = Number(sale.price_per_bag || 0)
      const cogs = Number(sale.cogs_price || 0)
      
      let profit = Math.round((price - cogs) * qty);
      let finalQty = qty;

      const isNegativeItem = name.includes('ដូរ') || name.includes('បញ្ចុះតម្លៃ');
      if (isNegativeItem) {
          profit = -Math.abs(profit);
          finalQty = -Math.abs(finalQty);
      }

      if (!map[name]) map[name] = { name, qty: 0, profit: 0 }
      map[name].qty += finalQty
      map[name].profit += profit
    })

    const arr = Object.values(map).filter(item => item.qty > 0 || item.profit > 0)
    const topByQty = [...arr].sort((a, b) => b.qty - a.qty).slice(0, 3)
    const topByProfit = [...arr].sort((a, b) => b.profit - a.profit).slice(0, 3)

    return { topByQty, topByProfit }
  }

  const todayM = calculateMetrics(activeSalesData, isToday)
  const mtdM = calculateMetrics(activeSalesData, isMTD)
  const lastMonthM = calculateMetrics(activeSalesData, isLastMonth)

  const todayC = calculateCollections(invoicePayments, isToday)
  const mtdC = calculateCollections(invoicePayments, isMTD)

  const todayE = calculateExpensesSummary(expenses, isToday)
  const mtdE = calculateExpensesSummary(expenses, isMTD)
  const lastMonthE = calculateExpensesSummary(expenses, isLastMonth)

  const wholesaleTopMTD = getTopPerformers(wholesaleSales, isMTD)
  const retailTopMTD = getTopPerformers(retailSales, isMTD)

  const generateDailyArray = (dataSet: any[], isTargetMonth: any) => {
    const dailySales = new Array(31).fill(0)
    const dailyProfit = new Array(31).fill(0)
    dataSet.filter((s: any) => isTargetMonth(s.created_at) && parseOwner(s.owner) !== 'mom').forEach((sale: any) => {
      const customName = sale.custom_rice_type || sale.rice_type || '';
      if (customName.includes('កក់')) return;

      const dayIdx = getDayOfMonth(sale.created_at) - 1
      const qty = Number(sale.qty || 0)
      const price = Number(sale.price_per_bag || 0)
      const cogs = Number(sale.cogs_price || 0)
      
      let revenue = Math.round(qty * price);
      let profit = Math.round((price - cogs) * qty);

      const isNegativeItem = customName.includes('ដូរ') || customName.includes('បញ្ចុះតម្លៃ');
      if (isNegativeItem) {
          revenue = -Math.abs(revenue);
          profit = -Math.abs(profit);
      }
      
      if (dayIdx >= 0 && dayIdx < 31) {
        dailySales[dayIdx] += revenue
        dailyProfit[dayIdx] += profit
      }
    })
    return { dailySales, dailyProfit }
  }

  const thisMonthData = generateDailyArray(activeSalesData, isMTD)
  const lastMonthData = generateDailyArray(activeSalesData, isLastMonth)

  // --- 5. TELEGRAM MESSAGE GENERATOR (DAILY) ---
  const generateTelegramMessage = () => {
    const { today, month } = reportMetrics
    const cleanUSD = (val: number) => (val === 0 ? '$0' : formatUSD(val))
    const branchLabel = activeBranchId === 0 ? '🌍 GLOBAL HQ' : `🏬 BRANCH: ${activeBranchId}`

    return (
`📊 RICE BUSINESS REPORT (${branchLabel})

📆 THIS MONTH
💰 Sales      ${formatRiel(month.totalSales)}
📈 Profit     ${formatRiel(month.totalProfit)}
🏢 Biz Exp    ${formatRiel(month.totalBizExpRiel)} / ${cleanUSD(month.totalBizExpUsd)}
🏠 Pers Exp   ${formatRiel(month.totalPersExpRiel)} / ${cleanUSD(month.totalPersExpUsd)}

👤 MONTH PROFIT
🟢 Pich       ${formatRiel(month.profitByOwner.Pich)}
🔵 Jing       ${formatRiel(month.profitByOwner.Jing)}
🟡 Both       ${formatRiel(month.profitByOwner.Both)}

🏢 MONTH BIZ EXPENSE
🟢 Pich       ${formatRiel(month.expenseBySpender.Pich.bizRiel)} / ${cleanUSD(month.expenseBySpender.Pich.bizUsd)}
🔵 Jing       ${formatRiel(month.expenseBySpender.Jing.bizRiel)} / ${cleanUSD(month.expenseBySpender.Jing.bizUsd)}
🟡 Both       ${formatRiel(month.expenseBySpender.Both.bizRiel)} / ${cleanUSD(month.expenseBySpender.Both.bizUsd)}

🏠 MONTH PERS EXPENSE
🟢 Pich       ${formatRiel(month.expenseBySpender.Pich.persRiel)} / ${cleanUSD(month.expenseBySpender.Pich.persUsd)}
🔵 Jing       ${formatRiel(month.expenseBySpender.Jing.persRiel)} / ${cleanUSD(month.expenseBySpender.Jing.persUsd)}
🟡 Both       ${formatRiel(month.expenseBySpender.Both.persRiel)} / ${cleanUSD(month.expenseBySpender.Both.persUsd)}

━━━━━━━━━━━━━━━

📅 TODAY
💰 Sales      ${formatRiel(today.totalSales)}
📈 Profit     ${formatRiel(today.totalProfit)}
🏢 Biz Exp    ${formatRiel(today.totalBizExpRiel)} / ${cleanUSD(today.totalBizExpUsd)}
🏠 Pers Exp   ${formatRiel(today.totalPersExpRiel)} / ${cleanUSD(today.totalPersExpUsd)}

👤 TODAY PROFIT
🟢 Pich       ${formatRiel(today.profitByOwner.Pich)}
🔵 Jing       ${formatRiel(today.profitByOwner.Jing)}
🟡 Both       ${formatRiel(today.profitByOwner.Both)}

🏢 TODAY BIZ EXPENSE
🟢 Pich       ${formatRiel(today.expenseBySpender.Pich.bizRiel)} / ${cleanUSD(today.expenseBySpender.Pich.bizUsd)}
🔵 Jing       ${formatRiel(today.expenseBySpender.Jing.bizRiel)} / ${cleanUSD(today.expenseBySpender.Jing.bizUsd)}
🟡 Both       ${formatRiel(today.expenseBySpender.Both.bizRiel)} / ${cleanUSD(today.expenseBySpender.Both.bizUsd)}

🏠 TODAY PERS EXPENSE
🟢 Pich       ${formatRiel(today.expenseBySpender.Pich.persRiel)} / ${cleanUSD(today.expenseBySpender.Pich.persUsd)}
🔵 Jing       ${formatRiel(today.expenseBySpender.Jing.persRiel)} / ${cleanUSD(today.expenseBySpender.Jing.persUsd)}
🟡 Both       ${formatRiel(today.expenseBySpender.Both.persRiel)} / ${cleanUSD(today.expenseBySpender.Both.persUsd)}`
    )
  }

  // --- 6. AUTOMATED INSIGHTS GENERATOR ---
  const monthlyInsights = useMemo(() => {
    const { month } = reportMetrics
    const totalExpenseRielEq = month.totalExpRiel + (month.totalExpUsd * EXCHANGE_RATE)
    const netCashFlowRiel = month.totalProfit - totalExpenseRielEq
    const margin = month.totalSales > 0 ? ((month.totalProfit / month.totalSales) * 100).toFixed(1) : '0.0'
    
    let topCat = 'None'
    let topCatAmount = 0
    Object.entries(month.categoryBreakdown).forEach(([cat, val]) => {
      const eq = val.riel + (val.usd * EXCHANGE_RATE)
      if (eq > topCatAmount) {
        topCatAmount = eq
        topCat = cat
      }
    })

    return {
      totalExpenseRielEq,
      netCashFlowRiel,
      margin,
      topCat,
      topCatAmount
    }
  }, [reportMetrics])

  const { month } = reportMetrics
  const currentMonthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // --- 7. DISPATCH TO TELEGRAM (DAILY TEXT) ---
  async function handleSendTelegram() {
    const activeBotToken = TELEGRAM_CONFIG.botToken
    const activeChatId = TELEGRAM_CONFIG.chatId

    if (!activeBotToken || !activeChatId) {
      showToast('error', 'Missing Info', 'Please add your credentials to lib/telegramConfig.ts first.')
      return
    }

    setIsSending(true)
    const textToSend = generateTelegramMessage()

    try {
      const response = await fetch(`https://api.telegram.org/bot${activeBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: activeChatId,
          text: textToSend
        })
      })

      const result = await response.json()
      if (result.ok) {
        showToast('success', 'Sent to Telegram!', 'The report summary has been dispatched.')
      } else {
        throw new Error(result.description || 'Telegram API rejected the request.')
      }
    } catch (e: any) {
      showToast('error', 'Telegram Failed', e.message)
    } finally {
      setIsSending(false)
    }
  }

  // --- 8. 🔥 ORIGINAL BACKEND PDF ENGINE (TELEGRAM) ---
  async function handleSendMonthlyTelegram() {
    setIsSending(true)
    showToast('info', 'Generating PDF...', 'Server is building your crisp, vector A4 report...')
    try {
      const response = await fetch('/api/telegram/send-monthly-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sends your branch preference and requests Telegram Delivery
        body: JSON.stringify({ branch_id: activeBranchId, downloadOnly: false }) 
      })
      const result = await response.json()

      if (response.ok && result.success) {
        showToast('success', 'PDF Sent!', 'The multi-page executive PDF report has been dispatched to Telegram.')
      } else {
        throw new Error(result.error || 'Failed to dispatch PDF.')
      }
    } catch (e: any) {
      showToast('error', 'Telegram Failed', e.message)
      console.error(e)
    } finally {
      setIsSending(false)
    }
  }

  // --- 9. 🔥 ORIGINAL BACKEND PDF ENGINE (LOCAL DOWNLOAD) ---
  async function handleDownloadPDF() {
    setIsSending(true)
    showToast('info', 'Generating PDF...', 'Server is building exact A4 PDF report...')

    try {
      const res = await fetch('/api/telegram/send-monthly-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Passing downloadOnly: true tells your API route to return the file instead of sending to Telegram
        body: JSON.stringify({ branch_id: activeBranchId, downloadOnly: true })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.slice(0, 150) || 'Failed to generate PDF download');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Monthly_Report_Branch_${activeBranchId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showToast('success', 'PDF Downloaded!', 'Crisp A4 PDF document downloaded successfully!');
    } catch (err: any) {
      console.error('Download Error:', err);
      showToast('error', 'Download Failed', err.message || 'Could not download PDF');
    } finally {
      setIsSending(false)
    }
  }

  const copyToClipboard = () => {
    const msg = generateTelegramMessage()
    navigator.clipboard.writeText(msg)
    showToast('success', 'Copied!', 'Formatted report copied to clipboard.')
  }

  return (
    <AdminGuard>
      <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
        
        <div className="header-container no-print" style={{ flexShrink: 0 }}>
          <div className="header-left">
            {/* 🔥 UPDATED PAGE TITLE WITH STANDARD ALIGNMENT STYLE */}
            <h1 className="saas-page-title" style={{ margin: 0 }}>📄 Business Report</h1>
          </div>
          <div className="header-actions">
            <button onClick={fetchReportData} className="saas-btn saas-btn-secondary" title="Refresh Numbers">
              <span className="desktop-only-inline">{loading ? '🔄 Loading...' : '🔄 Refresh Numbers'}</span>
              <span className="mobile-only-inline">{loading ? '⏳' : '🔄'}</span>
            </button>
          </div>
        </div>

        <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingBottom: '60px' }}>

          <div className="saas-card no-print" style={{ padding: '20px', marginBottom: '24px' }}>
            <div className="controls-header">
              
              <div className="saas-tab-container controls-tabs" style={{ margin: 0, padding: 0, border: 'none', background: '#f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setActiveReportTab('daily')}
                  className={`saas-tab ${activeReportTab === 'daily' ? 'active' : ''}`}
                  style={{ padding: '10px 20px', fontWeight: 'bold' }}
                >
                  <span className="desktop-only-inline">📅 Daily Telegram Format</span>
                  <span className="mobile-only-inline">📅 Daily Format</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReportTab('monthly')}
                  className={`saas-tab ${activeReportTab === 'monthly' ? 'active' : ''}`}
                  style={{ padding: '10px 20px', fontWeight: 'bold' }}
                >
                  <span className="desktop-only-inline">📄 Full Monthly Business Report</span>
                  <span className="mobile-only-inline">📄 Monthly Report</span>
                </button>
              </div>

              <div className="controls-actions">
                {activeReportTab === 'daily' ? (
                  <>
                    <button
                      onClick={copyToClipboard}
                      className="saas-btn saas-btn-secondary controls-btn-secondary"
                      style={{ fontWeight: 'bold' }}
                    >
                      <span className="desktop-only-inline">📋 Copy Text</span>
                      <span className="mobile-only-inline">📋 Copy</span>
                    </button>
                    <button
                      onClick={handleSendTelegram}
                      disabled={isSending || loading}
                      className="saas-btn saas-btn-primary controls-btn-primary"
                      style={{ background: '#0088cc', borderColor: '#0077b5', color: '#fff', fontWeight: 'bold' }}
                    >
                      <span className="desktop-only-inline">{isSending ? '🚀 Dispatching...' : '🚀 Send Daily Report to Telegram'}</span>
                      <span className="mobile-only-inline">{isSending ? '🚀 Sending...' : '🚀 Send Daily'}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleDownloadPDF}
                      disabled={isSending || loading}
                      className="saas-btn saas-btn-secondary controls-btn-secondary"
                      style={{ fontWeight: 'bold' }}
                    >
                      <span className="desktop-only-inline">📥 Download A4 PDF</span>
                      <span className="mobile-only-inline">📥 Download PDF</span>
                    </button>
                    <button
                      onClick={handleSendMonthlyTelegram}
                      disabled={isSending || loading}
                      className="saas-btn saas-btn-primary controls-btn-primary"
                      style={{ background: '#0088cc', borderColor: '#0077b5', color: '#fff', fontWeight: 'bold' }}
                    >
                      <span className="desktop-only-inline">{isSending ? '📄 Creating PDF...' : '📄 Send Monthly PDF to Telegram'}</span>
                      <span className="mobile-only-inline">{isSending ? '📄 Sending...' : '📄 Send PDF'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {activeReportTab === 'daily' && (
              <div style={{ marginTop: '20px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Exact Daily Telegram Preview
                </label>
                
                {loading ? (
                  <div style={{
                    background: '#0f172a',
                    padding: '20px',
                    borderRadius: '12px',
                    border: '1px solid #1e293b',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          height: '14px',
                          width: `${((i * 17) % 40) + 40}%`,
                          background: '#1e293b',
                          borderRadius: '4px'
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <pre style={{
                    background: '#0f172a',
                    color: '#38bdf8',
                    padding: '20px',
                    borderRadius: '12px',
                    overflowX: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    border: '1px solid #1e293b',
                    margin: 0
                  }}>
                    {generateTelegramMessage()}
                  </pre>
                )}
              </div>
            )}
          </div>

          {activeReportTab === 'monthly' && (
            <div 
              className="a4-report-container fade-in" 
              style={{
                background: '#ffffff',
                width: '100%',
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '24px',
                borderRadius: '12px',
                boxSizing: 'border-box',
                // 🔥 THE FONT FIX: Clean, sharp, modern text everywhere!
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Noto Sans Khmer"'
            }}>
              
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '16px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 6px 0', textTransform: 'uppercase', color: '#0f172a' }}>
                    Rice Business Monthly Report
                  </h1>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>
                    Comprehensive Financial Statement & Operational Insights
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#b58a3d' }}>{currentMonthName}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Generated: {new Date().toLocaleDateString('en-GB')}</div>
                </div>
              </div>

              <h3 className="section-divider" style={{ fontWeight: 'bold' }}>📌 EXECUTIVE SUMMARY & KEY INSIGHTS</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                
                <div className="saas-card" style={{ borderLeft: '4px solid #10b981' }}>
                  <div className="saas-card-title">Gross Profit Margin</div>
                  <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981', margin: '12px 0 4px 0' }}>
                    {monthlyInsights.margin}%
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Based on monthly gross sales</div>
                </div>

                <div className="saas-card" style={{ borderLeft: '4px solid #3b82f6' }}>
                  <div className="saas-card-title">Net Retained Cash Flow</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: monthlyInsights.netCashFlowRiel >= 0 ? '#10b981' : '#ef4444', margin: '12px 0 4px 0' }}>
                    {formatRiel(monthlyInsights.netCashFlowRiel)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>After all operational & personal expenses</div>
                </div>

                <div className="saas-card" style={{ borderLeft: '4px solid #f59e0b' }}>
                  <div className="saas-card-title">Largest Expense Category</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155', margin: '12px 0 4px 0' }}>
                    {monthlyInsights.topCat}
                  </div>
                  <div style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 'bold' }}>
                    {formatRiel(monthlyInsights.topCatAmount)}
                  </div>
                </div>
              </div>

              <div className="saas-card" style={{ background: '#f8fafc', marginBottom: '32px', border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: '13px', color: '#334155', margin: 0, lineHeight: '1.6' }}>
                  <b>Operational Conclusion:</b> During {currentMonthName}, the business achieved total sales of <b>{formatRiel(month.totalSales)}</b> with a gross profit of <b>{formatRiel(month.totalProfit)}</b>. After accounting for all operational and personal expenses of <b>{formatRiel(monthlyInsights.totalExpenseRielEq)}</b> (converted equivalent), the net retained cash flow stands at <b>{formatRiel(monthlyInsights.netCashFlowRiel)}</b>.
                </p>
              </div>

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📅 TODAY'S PERFORMANCE</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <ComplexCard title="Today Sales" total={todayM.totalSales} pich={todayM.pichSales} jing={todayM.jingSales} both={todayM.bothSales} color="#2563eb" hideUsdEquiv={true} />
                <ComplexCard title="Today Profit" total={todayM.totalProfit} pich={todayM.pichProfit} jing={todayM.jingProfit} both={todayM.bothProfit} color="#10b981" hideUsdEquiv={true} />
                <ExpenseBreakdownCard title="Cash Collected (Direct)" cR={todayC.cR} cU={todayC.cU} qR={todayC.qR} qU={todayC.qU} color="#3b82f6" />
                <ExpenseBreakdownCard title="Today Biz Expenses" cR={todayE.bizCashRiel} cU={todayE.bizCashUsd} qR={todayE.bizQrRiel} qU={todayE.bizQrUsd} color="#b91c1c" />
                <ExpenseBreakdownCard title="Today Personal Exp" cR={todayE.persCashRiel} cU={todayE.persCashUsd} qR={todayE.persQrRiel} qU={todayE.persQrUsd} color="#f59e0b" />
              </div>

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📈 MONTH TO DATE (MTD) PERFORMANCE</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                <ComplexCard title="MTD Sales" total={mtdM.totalSales} pich={mtdM.pichSales} jing={mtdM.jingSales} both={mtdM.bothSales} color="#2563eb" />
                <ComplexCard title="MTD Profit" total={mtdM.totalProfit} pich={mtdM.pichProfit} jing={mtdM.jingProfit} both={mtdM.bothProfit} color="#10b981" />
                <ExpenseBreakdownCard title="Cash Collected (Direct)" cR={mtdC.cR} cU={mtdC.cU} qR={mtdC.qR} qU={mtdC.qU} color="#3b82f6" />
                <ExpenseBreakdownCard title="MTD Biz Expenses" cR={mtdE.bizCashRiel} cU={mtdE.bizCashUsd} qR={mtdE.bizQrRiel} qU={mtdE.bizQrUsd} color="#b91c1c" />
                <ExpenseBreakdownCard title="MTD Personal Exp" cR={mtdE.persCashRiel} cU={mtdE.persCashUsd} qR={mtdE.persQrRiel} qU={mtdE.persQrUsd} color="#f59e0b" />
              </div>

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

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>⚖️ COMPARE MTD VS LAST MONTH</h2>
              <div className="saas-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <HealthBar title="Sales" current={mtdM.totalSales} target={lastMonthM.totalSales} color="#2563eb" />
                <HealthBar title="Profit" current={mtdM.totalProfit} target={lastMonthM.totalProfit} color="#10b981" />
                <HealthBar title="Biz Expenses" current={mtdE.bizCashRiel + mtdE.bizQrRiel + (mtdE.bizCashUsd*EXCHANGE_RATE)} target={lastMonthE.bizCashRiel + lastMonthE.bizQrRiel + (lastMonthE.bizCashUsd*EXCHANGE_RATE)} color="#b91c1c" reverseLogic />
                <HealthBar title="Personal Expenses" current={mtdE.persCashRiel + mtdE.persQrRiel + (mtdE.persCashUsd*EXCHANGE_RATE)} target={lastMonthE.persCashRiel + lastMonthE.persQrRiel + (lastMonthE.persCashUsd*EXCHANGE_RATE)} color="#f59e0b" reverseLogic />
              </div>

              <h2 className="section-divider" style={{ fontWeight: 'bold' }}>📉 TREND ANALYSIS (Day 1 - 31)</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', marginBottom: '40px' }}>
                <LineChartCard title="Total Sales: This Month vs Last Month" dataCurrent={thisMonthData.dailySales} dataLast={lastMonthData.dailySales} color="#2563eb" />
                <LineChartCard title="Total Profit: This Month vs Last Month" dataCurrent={thisMonthData.dailyProfit} dataLast={lastMonthData.dailyProfit} color="#10b981" />
              </div>

              <h3 className="section-divider" style={{ fontWeight: 'bold' }}>📂 EXPENSE CATEGORIZATION ANALYSIS</h3>
              <div className="saas-table-wrapper" style={{ marginBottom: '40px' }}>
                <div className="saas-table-responsive">
                  <table className="saas-table">
                    <thead>
                      <tr>
                        <th className="saas-th">Category / Function</th>
                        <th className="saas-th" style={{ textAlign: 'right' }}>Total (KHR ៛)</th>
                        <th className="saas-th" style={{ textAlign: 'right' }}>Total (USD $)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(month.categoryBreakdown).length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                            No expenses recorded this month.
                          </td>
                        </tr>
                      ) : (
                        Object.entries(month.categoryBreakdown)
                          .sort((a, b) => (b[1].riel + b[1].usd * EXCHANGE_RATE) - (a[1].riel + a[1].usd * EXCHANGE_RATE))
                          .map(([cat, val]) => (
                            <tr key={cat} className="saas-tr">
                              <td className="saas-td" style={{ fontWeight: 'bold', color: '#334155' }}>{cat}</td>
                              <td className="saas-td" style={{ textAlign: 'right', fontWeight: 'bold', color: '#ef4444' }}>{formatRiel(val.riel)}</td>
                              <td className="saas-td" style={{ textAlign: 'right', fontWeight: 'bold', color: '#ef4444' }}>{formatUSD(val.usd)}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', paddingTop: '20px', borderTop: '1px dashed #cbd5e1' }}>
                <div>
                  <div style={{ marginBottom: '30px', fontWeight: 'bold', color: '#0f172a' }}>Prepared By: ___________________</div>
                  <div style={{ color: '#64748b' }}>Accountant / POS System</div>
                </div>
                <div>
                  <div style={{ marginBottom: '30px', fontWeight: 'bold', color: '#0f172a' }}>Approved By: ___________________</div>
                  <div style={{ color: '#64748b' }}>Business Ownership</div>
                </div>
              </div>

            </div>
          )}

        </div>

        <style jsx global>{`
          .fade-in { animation: fadeIn 0.3s ease-in-out; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

          .header-container { 
            display: flex;
            justify-content: space-between;
            align-items: center; 
            margin-bottom: 24px; 
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

          .header-actions {
            display: flex;
            gap: 10px;
            margin-left: auto;
          }

          .section-divider { 
            font-size: 15px; 
            color: #475569; 
            margin-bottom: 16px; 
            border-bottom: 1px solid #e2e8f0; 
            padding-bottom: 6px; 
          }

          .controls-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 16px;
          }

          .controls-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }

          .desktop-only-inline { display: inline; }
          .mobile-only-inline { display: none; }

          @media (max-width: 1023px) { 
            .desktop-only-inline { display: none !important; }
            .mobile-only-inline { display: inline !important; }

            .header-container { 
              margin-left: 54px !important;
              margin-right: 0 !important;
              margin-bottom: 20px !important; 
              margin-top: 0 !important;
              display: flex !important;
              flex-direction: row !important;
              justify-content: space-between !important;
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

            .header-actions {
              margin-left: auto !important;
            }

            .controls-header {
              flex-direction: column !important;
              align-items: stretch !important;
              gap: 14px !important;
            }

            .controls-tabs {
              display: flex !important;
              width: 100% !important;
            }

            .controls-tabs .saas-tab {
              flex: 1 !important;
              text-align: center !important;
              justify-content: center !important;
              padding: 10px 12px !important;
            }

            .controls-actions {
              display: flex !important;
              width: 100% !important;
              gap: 10px !important;
            }

            .controls-btn-secondary {
              flex: 0 0 auto !important;
              padding: 10px 16px !important;
              text-align: center !important;
            }

            .controls-btn-primary {
              flex: 1 !important;
              padding: 10px 16px !important;
              text-align: center !important;
              justify-content: center !important;
            }
          }

          @media (max-width: 480px) {
            .saas-btn {
              padding: 8px 12px !important;
              font-size: 13px !important;
            }
            .saas-tab {
              padding: 8px 10px !important;
              font-size: 13px !important;
            }
          }

          @media print {
            body { background: #ffffff !important; }
            .no-print { display: none !important; }
            .main-wrapper {
              padding: 0 !important;
              margin: 0 !important;
              box-shadow: none !important;
              height: auto !important;
              overflow: visible !important;
              display: block !important;
            }
            .a4-report-container {
              box-shadow: none !important;
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 !important;
              margin: 0 !important;
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

function ComplexCard({ title, total, pich = 0, jing = 0, both = 0, hideSubboxes = false, hideUsdEquiv = false, color = '#1e293b' }: any) {
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
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
        </div>
      )}
    </div>
  )
}

function ExpenseBreakdownCard({ title, cR = 0, cU = 0, qR = 0, qU = 0, color = '#1e293b' }: any) {
  const totalRiel = cR + qR
  const totalUsd = cU + qU
  
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
  let pct = target > 0 ? (current / target) * 100 : (current > 0 ? 100 : 0)
  let displayPct = pct.toFixed(1)
  let barWidth = Math.min(100, Math.max(0, pct))
  let barColor = color
  if (!reverseLogic) {
    if (pct < 50) barColor = '#ef4444'; else if (pct >= 100) barColor = '#10b981'
  } else {
    if (pct > 100) barColor = '#ef4444'; else if (pct < 80) barColor = '#10b981'
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
      const x = (idx / 30) * 1000; const y = 200 - ((val / maxVal) * 200); return `${x},${y}`
    }).join(' ')
  }
  const currentPoints = formatPoints(dataCurrent); const lastPoints = formatPoints(dataLast)
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
            const x = (idx / 30) * 1000; const y = 200 - ((val / maxVal) * 200)
            return val > 0 ? <circle key={idx} cx={x} cy={y} r="4" fill="#ffffff" stroke={color} strokeWidth="2" /> : null
          })}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', color: '#94a3b8', fontSize: '11px', fontWeight: 'bold' }}>
          <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span><span>25</span><span>31</span>
        </div>
      </div>
    </div>
  )
}