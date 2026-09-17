// app/api/cron/telegram/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TELEGRAM_CONFIG } from '@/lib/telegramConfig'
// @ts-ignore
import { generateAndSendCogsReport } from '@/lib/cogsReportSender'

const EXCHANGE_RATE = 4000
const formatRiel = (val: number) => `${Math.round(val || 0).toLocaleString()}៛`
const formatUSD = (val: number) => `$${Number(val || 0).toFixed(2)}`

// 🔥 MULTI-TENANT FIX: Define which branches the cron job should loop through
// 1 = SMC, 2 = Chukmeas
const ACTIVE_BRANCHES = [1, 2];

export async function GET(request: Request) {
  try {
    // 1. Optional Security Check: Verify Vercel Cron Secret
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Validate Supabase Environment Variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase URL or Key' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 3. Load Telegram Credentials
    const botToken = TELEGRAM_CONFIG.botToken
    const chatId = TELEGRAM_CONFIG.chatId
    const sendDaily = TELEGRAM_CONFIG.autoSendDaily
    const sendMonthly = TELEGRAM_CONFIG.autoSendMonthly

    if (!botToken || !chatId) {
      return NextResponse.json({ error: 'Missing Telegram credentials' }, { status: 400 })
    }

    // 4. CAMBODIA TIMEZONE DATE LOGIC (Asia/Phnom_Penh | UTC+7)
    const now = new Date()

    const getCambodiaDateParts = (d: Date) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Phnom_Penh',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      }).formatToParts(d)
      const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
      return { year: get('year'), month: get('month'), day: get('day') }
    }

    const nowCam = getCambodiaDateParts(now)
    const startOfMonth = `${nowCam.year}-${String(nowCam.month).padStart(2, '0')}-01T00:00:00+07:00`

    const isToday = (dateStr: string) => {
      if (!dateStr) return false
      const d = getCambodiaDateParts(new Date(dateStr))
      return d.day === nowCam.day && d.month === nowCam.month && d.year === nowCam.year
    }

    const isMTD = (dateStr: string) => {
      if (!dateStr) return false
      const d = getCambodiaDateParts(new Date(dateStr))
      return d.month === nowCam.month && d.year === nowCam.year
    }

    const tomorrowCam = getCambodiaDateParts(new Date(now.getTime() + 86400000))
    const isLastDayOfMonth = tomorrowCam.day === 1

    // 🔥 MASTER RESULTS OBJECT
    const cronResults: any = {}
    const parseOwner = (val: string) => val ? val.toLowerCase().trim() : 'unassigned';

    // 5. 🔥 MULTI-TENANT LOOP: Run the entire report engine for EACH branch
    for (const targetBranch of ACTIVE_BRANCHES) {
      
      const [
        { data: invData, error: invError },
        { data: retData, error: retError },
        { data: expData, error: expError }
      ] = await Promise.all([
        supabase.from('invoice_summaries').select('*').eq('branch_id', targetBranch).gte('created_at', startOfMonth).neq('delivery_status', 'Voided'),
        supabase.from('retail_sales').select('*').eq('branch_id', targetBranch).gte('created_at', startOfMonth).eq('is_voided', false),
        supabase.from('expenses').select('*').eq('branch_id', targetBranch).gte('created_at', startOfMonth)
      ])

      if (invError || retError || expError) {
        console.error(`Database query failed for branch ${targetBranch}`)
        continue; // Skip this branch and try the next one
      }

      const invoices = invData || []
      const retailSales = retData || []
      const expenses = expData || []

      // 6. 🔥 NUMBER CRUNCHING ENGINE
      const calculateSlice = (invSlice: any[], retSlice: any[], expSlice: any[]) => {
        let totalSales = 0
        let totalProfit = 0
        const profitByOwner = { Pich: 0, Jing: 0, Both: 0 }

        invSlice.forEach(inv => {
          const owner = parseOwner(inv.owner);
          if (owner === 'mom') return; 

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
          if (owner === 'mom') return; 

          const customName = ret.custom_rice_type || ret.rice_type || '';
          if (customName.includes('កក់')) return; 

          const qty = Number(ret.qty) || 0
          const price = Number(ret.price_per_bag) || 0
          const cogs = Number(ret.cogs_price) || 0

          let sales = Math.round(qty * price);
          let profit = Math.round((price - cogs) * qty);

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

        const expenseBySpender = {
          Pich: { bizRiel: 0, bizUsd: 0, persRiel: 0, persUsd: 0 },
          Jing: { bizRiel: 0, bizUsd: 0, persRiel: 0, persUsd: 0 },
          Both: { bizRiel: 0, bizUsd: 0, persRiel: 0, persUsd: 0 }
        }

        let totalBizExpRiel = 0, totalBizExpUsd = 0;
        let totalPersExpRiel = 0, totalPersExpUsd = 0;

        expSlice.forEach(exp => {
          const spender = parseOwner(exp.spender);
          if (spender === 'mom') return; 

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
        })

        return { totalSales, totalProfit, profitByOwner, expenseBySpender, totalBizExpRiel, totalBizExpUsd, totalPersExpRiel, totalPersExpUsd }
      }

      const month = calculateSlice(
        invoices.filter(i => isMTD(i.created_at)),
        retailSales.filter(r => isMTD(r.created_at)),
        expenses.filter(e => isMTD(e.expense_date || e.created_at))
      )

      const today = calculateSlice(
        invoices.filter(i => isToday(i.created_at)),
        retailSales.filter(r => isToday(r.created_at)),
        expenses.filter(e => isToday(e.expense_date || e.created_at))
      )

      let dailyTelegramResponse = null
      let monthlyTelegramResponse = null
      let cogsMomResult: any = null
      let cogsOthersResult: any = null

      // 🚦 TOPIC ROUTER: Get the exact Topic Thread ID for this specific branch
      const targetThreadId = (TELEGRAM_CONFIG as any).reportTopics?.[targetBranch];
      const branchNameLabel = targetBranch === 1 ? 'SMC BRANCH' : targetBranch === 2 ? 'CHUKMEAS BRANCH' : `BRANCH ${targetBranch}`;

      // 7. DISPATCH DAILY REPORT
      if (sendDaily) {
        const cleanUSD = (val: number) => (val === 0 ? '$0' : formatUSD(val))

        const dailyText =
`📊 RICE BUSINESS REPORT (${branchNameLabel})

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

        const payload: any = {
          chat_id: chatId,
          text: dailyText
        };
        // Inject the topic folder ID!
        if (targetThreadId) payload.message_thread_id = targetThreadId;

        const dailyRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        dailyTelegramResponse = await dailyRes.json()
      }

      // 8. DISPATCH FULL MONTHLY PDF REPORT ON LAST DAY OF MONTH
      if (isLastDayOfMonth && sendMonthly) {
        const rawBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || 
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
        const baseUrl = rawBaseUrl.replace(/\/$/, '')

        const monthlyRes = await fetch(`${baseUrl}/api/telegram/send-monthly-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch_id: targetBranch }) // 🔥 Passes current loop branch
        })

        monthlyTelegramResponse = await monthlyRes.json()
      }

      // 9. DISPATCH COGS A4 PDF REPORTS
      if (sendDaily) {
        const todayIsoStr = `${nowCam.year}-${String(nowCam.month).padStart(2, '0')}-${String(nowCam.day).padStart(2, '0')}`

        try {
          cogsMomResult = await generateAndSendCogsReport({
            fromDate: todayIsoStr,
            toDate: todayIsoStr,
            ownerTab: 'mom',
            branch_id: targetBranch // 🔥 Passes current loop branch
          })
        } catch (err: any) {
          console.error(`Mom COGS failed for branch ${targetBranch}:`, err.message)
        }

        try {
          cogsOthersResult = await generateAndSendCogsReport({
            fromDate: todayIsoStr,
            toDate: todayIsoStr,
            ownerTab: 'others',
            branch_id: targetBranch // 🔥 Passes current loop branch
          })
        } catch (err: any) {
          console.error(`Others COGS failed for branch ${targetBranch}:`, err.message)
        }
      }

      // Store results for this branch in our master object
      cronResults[`branch_${targetBranch}`] = {
        daily: dailyTelegramResponse,
        monthly: monthlyTelegramResponse,
        cogsMom: cogsMomResult,
        cogsOthers: cogsOthersResult
      }
    } // End of Active Branches Loop

    return NextResponse.json({
      success: true,
      dailySent: sendDaily,
      monthlySent: isLastDayOfMonth && sendMonthly,
      telegramResults: cronResults
    })
  } catch (error: any) {
    console.error('Telegram Cron Job Uncaught Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}