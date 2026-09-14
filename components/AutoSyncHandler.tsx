'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useToast } from '@/components/ToastProvider'

// Helper: Always get accurate YYYY-MM-DD in Cambodia Local Time (UTC+7)
const getCambodiaDateStr = (dateObj = new Date()) => {
  return dateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' })
}

// Helper: Get current hour (0 - 23) in Cambodia Local Time
const getCambodiaHour = () => {
  const hourStr = new Date().toLocaleTimeString('en-US', {
    timeZone: 'Asia/Phnom_Penh',
    hour12: false,
    hour: '2-digit'
  })
  return parseInt(hourStr, 10)
}

export default function AutoSyncHandler() {
  const { showToast } = useToast()

  useEffect(() => {
    const checkAndSync = async () => {
      try {
        const savedDate = localStorage.getItem('expense_ledger_date')
        if (!savedDate) return

        const todayCambodia = getCambodiaDateStr()
        const currentHour = getCambodiaHour()

        // 🔥 CRITERIA 1: Is the saved ledger from a PREVIOUS day? (e.g., opened next morning)
        const isPreviousDay = savedDate < todayCambodia

        // 🔥 CRITERIA 2: Is it TODAY and AFTER 10:00 PM (22:00)?
        const isAfter10PM = savedDate === todayCambodia && currentHour >= 22

        // If neither condition is met, do not auto-submit
        if (!isPreviousDay && !isAfter10PM) return

        let allValid: any[] = [];
        let keysToRemove: string[] = [];

        // 🔥 FIX: Loop through possible branch IDs (0 to 50) to catch all active drafts
        for (let branchId = 0; branchId <= 50; branchId++) {
          const persKey = `expense_ledger_personal_${branchId}`;
          const bizKey = `expense_ledger_business_${branchId}`;
          
          const rawPers = localStorage.getItem(persKey);
          const rawBiz = localStorage.getItem(bizKey);

          const persList: any[] = rawPers ? JSON.parse(rawPers) : [];
          const bizList: any[] = rawBiz ? JSON.parse(rawBiz) : [];

          // Filter out empty/placeholder rows
          const validPers = persList.filter(
            exp => exp.remarks?.trim() !== '' && exp.payments?.some((p: any) => Number(p.amount) > 0)
          );
          const validBiz = bizList.filter(
            exp => exp.remarks?.trim() !== '' && exp.payments?.some((p: any) => Number(p.amount) > 0)
          );

          if (validPers.length > 0 || validBiz.length > 0) {
            keysToRemove.push(persKey);
            keysToRemove.push(bizKey);
          }

          // Add the branch ID directly to the payload map
          allValid.push(
            ...validPers.map(item => ({ ...item, tabType: 'PERSONAL', branch_id: branchId })),
            ...validBiz.map(item => ({ ...item, tabType: 'BUSINESS', branch_id: branchId }))
          );
        }

        // If there are no valid expenses waiting, just clean up old dates and exit
        if (allValid.length === 0) {
          if (isPreviousDay) {
            localStorage.setItem('expense_ledger_date', todayCambodia)
          }
          return
        }

        // Build payload for Supabase using the SAVED date (so yesterday's expenses stay on yesterday's date!)
        const payloadArray = allValid.map(exp => {
          const activePayments = exp.payments.filter((r: any) => (Number(r.amount) || 0) > 0)

          let combinedMethod = activePayments[0].method
          if (activePayments.length > 1) {
            combinedMethod = activePayments.map((r: any) => `${r.method}:${r.amount}`).join(',')
          }

          let totalUsd = 0
          let totalRiel = 0

          for (const row of activePayments) {
            // 🔥 RELIABILITY FIX: Strip commas from CurrencyInput strings to prevent NaN database corruption
            const rawAmount = Number(String(row.amount).replace(/,/g, '')) || 0;
            if (row.method.includes('$')) {
              totalUsd += rawAmount
            } else {
              totalRiel += rawAmount
            }
          }

          return {
            expense_date: savedDate, // 🔥 Uses savedDate so next-day sync logs under yesterday!
            spender: exp.spender,
            payment_method: combinedMethod,
            remarks: exp.remarks,
            amount_usd: totalUsd,
            amount_riel: totalRiel,
            description: exp.tabType,
            branch_id: exp.branch_id // 🔥 STAMPS THE EXACT BRANCH ID IT WAS FOUND IN
          }
        })

        // Insert into Supabase
        const { error } = await supabase.from('expenses').insert(payloadArray.reverse())
        if (error) throw error

        // Clear local branch-specific queues after successful sync
        keysToRemove.forEach(key => localStorage.removeItem(key));
        localStorage.setItem('expense_ledger_date', todayCambodia)

        // Notify user and trigger form reset in ExpenseDashboard
        showToast(
          'success',
          '✅ Auto-Synced!',
          `Automatically logged ${allValid.length} offline expense(s) for ${savedDate}.`
        )

        window.dispatchEvent(new Event('expense_ledger_synced'))
      } catch (err: any) {
        console.error('AutoSyncHandler Error:', err)
      }
    }

    // Run check 1 second after Safari loads to prevent race conditions
    const timer = setTimeout(checkAndSync, 1000)
    return () => clearTimeout(timer)
  }, [showToast])

  return null
}