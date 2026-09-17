import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TELEGRAM_CONFIG } from '@/lib/telegramConfig'
import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  Font,
  Svg,
  Path
} from '@react-pdf/renderer'

export const runtime = 'nodejs'

// --- 1. REGISTER MODERN UI FONTS ---
// We register Roboto to perfectly match the sleek Sans-Serif look of your frontend UI
Font.register({
  family: 'Roboto',
  fonts: [
    {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf',
      fontWeight: 'normal'
    },
    {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf',
      fontWeight: 'bold'
    }
  ]
})

const EXCHANGE_RATE = 4000
const formatKHR = (val: number) => `${Math.round(val || 0).toLocaleString()} KHR`
const formatUSD = (val: number) => `$${Number(val || 0).toFixed(2)}`
const formatNum = (val: number) => Number(val || 0).toLocaleString()

// --- 2. LIGHT, MODERN SAAS STYLESHEET ---
const styles = StyleSheet.create({
  page: {
    padding: 35,
    paddingBottom: 45,
    fontFamily: 'Roboto', // 🔥 THE FIX: Using the sleek modern font instead of Khmer Serif
    backgroundColor: '#ffffff',
    color: '#0f172a'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 10,
    marginBottom: 16
  },
  brandTitle: { fontSize: 8, color: '#64748b', textTransform: 'uppercase' },
  docTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginTop: 2 },
  monthBadge: { fontSize: 12, fontWeight: 'bold', color: '#b58a3d' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#334155',
    backgroundColor: '#f8fafc',
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 10,
    marginTop: 14,
    borderRadius: 4
  },

  // Grid & Card Layouts
  grid2: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  grid3: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  card: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff'
  },
  cardHighlight: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderLeftWidth: 3
  },
  cardLabel: { fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  cardValue: { fontSize: 13, fontWeight: 'bold', color: '#0f172a' },
  cardSubValue: { fontSize: 8, color: '#64748b', marginBottom: 8 },

  // Pich / Jing / Both / Mom 4-box Subgrid
  subBoxGrid: { flexDirection: 'row', gap: 4, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 6 },
  subBox: {
    flex: 1,
    padding: 4,
    borderRadius: 4,
    backgroundColor: '#f8fafc',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  subBoxMom: {
    flex: 1,
    padding: 4,
    borderRadius: 4,
    backgroundColor: '#fefcf3',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#fde047'
  },
  subBoxLabel: { fontSize: 7, color: '#64748b', textTransform: 'uppercase' },
  subBoxVal: { fontSize: 8, color: '#334155', marginTop: 1 },

  // Expense Cash/QR Split Grid
  expSplitGrid: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 6, marginTop: 4 },
  expSplitCol: { width: '48%' },
  expSplitText: { fontSize: 8, color: '#64748b', marginBottom: 2 },

  // Tables & Rows
  tableHeader: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingVertical: 5, paddingHorizontal: 8 },
  colCat: { flex: 2, fontSize: 8, color: '#334155' },
  colAmt: { flex: 1, fontSize: 8, textAlign: 'right', color: '#334155' },

  // Health Bar Comparison
  barContainer: { height: 5, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden', marginVertical: 5 },
  barFill: { height: '100%', borderRadius: 3 },

  footer: {
    position: 'absolute',
    bottom: 15,
    left: 35,
    right: 35,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8
  },
  footerText: { fontSize: 8, color: '#94a3b8' }
})

// --- HELPER COMPONENT: COMPLEX SAAS CARD WITH 4 OWNER SUB-BOXES ---
const ComplexCardPDF = ({ title, total, pich = 0, jing = 0, both = 0, mom = 0, color = '#1e293b' }: any) => (
  <View style={styles.card} wrap={false}>
    <Text style={styles.cardLabel}>{title}</Text>
    <Text style={[styles.cardValue, { color }]}>{formatKHR(total)}</Text>
    <Text style={styles.cardSubValue}>{formatUSD(total / EXCHANGE_RATE)}</Text>
    <View style={styles.subBoxGrid}>
      <View style={styles.subBox}>
        <Text style={styles.subBoxLabel}>Pich</Text>
        <Text style={styles.subBoxVal}>{formatKHR(pich)}</Text>
      </View>
      <View style={styles.subBox}>
        <Text style={styles.subBoxLabel}>Jing</Text>
        <Text style={styles.subBoxVal}>{formatKHR(jing)}</Text>
      </View>
      <View style={styles.subBox}>
        <Text style={styles.subBoxLabel}>Both</Text>
        <Text style={styles.subBoxVal}>{formatKHR(both)}</Text>
      </View>
      <View style={styles.subBoxMom}>
        <Text style={[styles.subBoxLabel, { color: '#ca8a04' }]}>Mom</Text>
        <Text style={[styles.subBoxVal, { color: '#854d0e' }]}>{formatKHR(mom)}</Text>
      </View>
    </View>
  </View>
)

// --- HELPER COMPONENT: EXPENSE CARD WITH CASH / QR BREAKDOWN ---
const ExpenseBreakdownCardPDF = ({ title, cR = 0, cU = 0, qR = 0, qU = 0, color = '#1e293b' }: any) => {
  const totalRiel = (Number(cR) || 0) + (Number(qR) || 0)
  const totalUsd = (Number(cU) || 0) + (Number(qU) || 0)
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.cardLabel}>{title}</Text>
      <Text style={[styles.cardValue, { color }]}>{formatKHR(totalRiel)}</Text>
      {totalUsd > 0 ? (
        <Text style={[styles.cardSubValue, { color }]}>{formatUSD(totalUsd)}</Text>
      ) : (
        <Text style={styles.cardSubValue}>$0.00</Text>
      )}
      <View style={styles.expSplitGrid}>
        <View style={styles.expSplitCol}>
          <Text style={styles.expSplitText}>
            Cash: <Text style={{ color: '#334155' }}>{formatKHR(cR)}</Text>
          </Text>
          <Text style={styles.expSplitText}>
            QR: <Text style={{ color: '#334155' }}>{formatKHR(qR)}</Text>
          </Text>
        </View>
        <View style={styles.expSplitCol}>
          <Text style={styles.expSplitText}>
            Cash: <Text style={{ color: '#334155' }}>{formatUSD(cU)}</Text>
          </Text>
          <Text style={styles.expSplitText}>
            QR: <Text style={{ color: '#334155' }}>{formatUSD(qU)}</Text>
          </Text>
        </View>
      </View>
    </View>
  )
}

// --- HELPER COMPONENT: HEALTH BAR COMPARISON ---
const HealthBarPDF = ({ title, current, target, color, reverseLogic = false }: any) => {
  const safeTarget = Number(target) || 0
  const safeCurrent = Number(current) || 0
  let pct = safeTarget > 0 ? (safeCurrent / safeTarget) * 100 : (safeCurrent > 0 ? 100 : 0)
  let displayPct = pct.toFixed(1)
  let barWidth = Math.min(100, Math.max(0, Math.round(pct)))
  let barColor = color
  if (!reverseLogic) {
    if (pct < 50) barColor = '#ef4444'; else if (pct >= 100) barColor = '#10b981'
  } else {
    if (pct > 100) barColor = '#ef4444'; else if (pct < 80) barColor = '#10b981'
  }
  return (
    <View style={[styles.card, { marginBottom: 8 }]} wrap={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 8, color: '#334155' }}>{title}</Text>
        <Text style={{ fontSize: 8, color: barColor }}>{displayPct}%</Text>
      </View>
      <View style={styles.barContainer}>
        <View style={[styles.barFill, { width: `${barWidth}%`, backgroundColor: barColor }]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontSize: 7, color: '#64748b' }}>
          This MTD: <Text style={{ color: '#334155' }}>{formatKHR(safeCurrent)}</Text>
        </Text>
        <Text style={{ fontSize: 7, color: '#64748b' }}>
          Last Mth: <Text style={{ color: '#334155' }}>{formatKHR(safeTarget)}</Text>
        </Text>
      </View>
    </View>
  )
}

// --- HELPER COMPONENT: BULLETPROOF SVG TREND LINE CHART ---
const LineChartCardPDF = ({ title, dataCurrent, dataLast, color }: any) => {
  const safeCurrent = (Array.isArray(dataCurrent) && dataCurrent.length > 0)
    ? dataCurrent.map(v => Number(v) || 0)
    : new Array(31).fill(0)
  const safeLast = (Array.isArray(dataLast) && dataLast.length > 0)
    ? dataLast.map(v => Number(v) || 0)
    : new Array(31).fill(0)

  const maxVal = Math.max(...safeCurrent, ...safeLast, 1) || 1

  const getSafePath = (arr: number[]) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return 'M 0 80 L 450 80'
    const len = Math.max(arr.length - 1, 1)
    const coords = arr.map((val, idx) => {
      const numVal = Number(val) || 0
      const x = Math.round((idx / len) * 450)
      const y = Math.round(80 - (numVal / maxVal) * 70)
      return `${x} ${y}`
    })
    return coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt}`).join(' ')
  }

  const currentPath = getSafePath(safeCurrent)
  const lastPath = getSafePath(safeLast)

  return (
    <View style={[styles.card, { marginBottom: 10 }]} wrap={false}>
      <Text style={[styles.cardLabel, { marginBottom: 8 }]}>{title}</Text>
      <Svg viewBox="0 0 450 85" width="450" height="65" style={{ width: '100%', height: 65 }}>
        <Path d="M 0 20 L 450 20" stroke="#f1f5f9" strokeWidth="1" />
        <Path d="M 0 50 L 450 50" stroke="#f1f5f9" strokeWidth="1" />
        <Path d="M 0 80 L 450 80" stroke="#cbd5e1" strokeWidth="1" />
        <Path d={lastPath} fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="3,3" />
        <Path d={currentPath} fill="none" stroke={color} strokeWidth="2" />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontSize: 7, color: color }}>━ This Month Trend</Text>
        <Text style={{ fontSize: 7, color: '#94a3b8' }}>- - Last Month Trend</Text>
      </View>
    </View>
  )
}

// --- FULL MULTI-PAGE DOCUMENT COMPONENT ---
const MonthlyReportPDF = ({ monthName, mtd, lastMonth, wholesaleTop, retailTop, categoryBreakdown, charts }: any) => {
  const safeSales = Number(mtd?.totalSales) || 0
  const safeProfit = Number(mtd?.totalProfit) || 0
  const margin = safeSales > 0 ? ((safeProfit / safeSales) * 100).toFixed(1) : '0.0'
  const totalExpEq = (Number(mtd?.totalExpRiel) || 0) + ((Number(mtd?.totalExpUsd) || 0) * EXCHANGE_RATE)
  const netCashFlow = safeProfit - totalExpEq

  const categories = Object.entries(categoryBreakdown || {}).sort(
    (a: any, b: any) =>
      ((Number(b[1]?.riel) || 0) + (Number(b[1]?.usd) || 0) * EXCHANGE_RATE) -
      ((Number(a[1]?.riel) || 0) + (Number(a[1]?.usd) || 0) * EXCHANGE_RATE)
  )

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap={true}>
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandTitle}>Rice Business Financial Report</Text>
            <Text style={styles.docTitle}>Executive Monthly Statement</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.monthBadge}>{monthName}</Text>
            <Text style={{ fontSize: 8, color: '#94a3b8', marginTop: 3 }}>Generated: {new Date().toLocaleDateString('en-GB')}</Text>
          </View>
        </View>

        {/* SECTION 1: EXECUTIVE SUMMARY */}
        <Text style={styles.sectionTitle}>1. EXECUTIVE SUMMARY & KEY INSIGHTS</Text>
        <View style={styles.grid3} wrap={false}>
          <View style={[styles.cardHighlight, { borderLeftColor: '#10b981' }]}>
            <Text style={styles.cardLabel}>Gross Profit Margin</Text>
            <Text style={[styles.cardValue, { color: '#10b981' }]}>{margin}%</Text>
            <Text style={styles.cardSubValue}>Based on monthly gross sales</Text>
          </View>
          <View style={[styles.cardHighlight, { borderLeftColor: '#3b82f6' }]}>
            <Text style={styles.cardLabel}>Net Retained Cash Flow</Text>
            <Text style={[styles.cardValue, { color: netCashFlow >= 0 ? '#2563eb' : '#dc2626' }]}>{formatKHR(netCashFlow)}</Text>
            <Text style={styles.cardSubValue}>After operational & personal expenses</Text>
          </View>
          <View style={[styles.cardHighlight, { borderLeftColor: '#f59e0b' }]}>
            <Text style={styles.cardLabel}>Total Outflow Expenses (Eq)</Text>
            <Text style={styles.cardValue}>{formatKHR(totalExpEq)}</Text>
            <Text style={styles.cardSubValue}>Combined KHR and USD equivalent</Text>
          </View>
        </View>
        <View style={[styles.card, { marginBottom: 14, backgroundColor: '#f8fafc' }]} wrap={false}>
          <Text style={{ fontSize: 8, color: '#334155', lineHeight: 1.5 }}>
            Operational Conclusion: During {monthName}, the business achieved total sales of {formatKHR(safeSales)} with a gross profit of {formatKHR(safeProfit)}. After accounting for all operational and personal expenses of {formatKHR(totalExpEq)} equivalent, the net retained cash flow stands at {formatKHR(netCashFlow)}.
          </Text>
        </View>

        {/* SECTION 2: MONTH TO DATE (MTD) PERFORMANCE CARDS */}
        <Text style={styles.sectionTitle}>2. MONTH TO DATE (MTD) PERFORMANCE</Text>
        <View style={styles.grid2} wrap={false}>
          <ComplexCardPDF title="MTD Sales" total={safeSales} pich={mtd?.pichSales} jing={mtd?.jingSales} both={mtd?.bothSales} mom={mtd?.momSales} color="#2563eb" />
          <ComplexCardPDF title="MTD Profit" total={safeProfit} pich={mtd?.pichProfit} jing={mtd?.jingProfit} both={mtd?.bothProfit} mom={mtd?.momProfit} color="#10b981" />
        </View>
        <View style={styles.grid3} wrap={false}>
          <ExpenseBreakdownCardPDF title="Cash Collected (Direct)" cR={mtd?.col?.cR} cU={mtd?.col?.cU} qR={mtd?.col?.qR} qU={mtd?.col?.qU} color="#3b82f6" />
          <ExpenseBreakdownCardPDF title="MTD Biz Expenses" cR={mtd?.bizCashRiel} cU={mtd?.bizCashUsd} qR={mtd?.bizQrRiel} qU={mtd?.bizQrUsd} color="#b91c1c" />
          <ExpenseBreakdownCardPDF title="MTD Personal Exp" cR={mtd?.persCashRiel} cU={mtd?.persCashUsd} qR={mtd?.persQrRiel} qU={mtd?.persQrUsd} color="#f59e0b" />
        </View>

        {/* SECTION 3: MTD TOP PERFORMERS (WHOLESALE & RETAIL) */}
        <Text style={styles.sectionTitle}>3. MTD TOP PERFORMERS (WHOLESALE & RETAIL)</Text>
        <View style={styles.grid2} wrap={false}>
          <View style={styles.card}>
            <Text style={[styles.cardLabel, { marginBottom: 6, color: '#2563eb' }]}>TOP 3 WHOLESALE (BY VOLUME)</Text>
            {(!wholesaleTop?.topByQty || wholesaleTop.topByQty.length === 0) ? (
              <Text style={{ fontSize: 8, color: '#94a3b8' }}>No wholesale data available.</Text>
            ) : (
              wholesaleTop.topByQty.map((item: any, idx: number) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingVertical: 4 }}>
                  <Text style={{ fontSize: 8 }}>{idx + 1}. {item.name}</Text>
                  <Text style={{ fontSize: 8, color: '#2563eb' }}>{formatNum(item.qty)} bags ({formatKHR(item.profit)})</Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.card}>
            <Text style={[styles.cardLabel, { marginBottom: 6, color: '#10b981' }]}>TOP 3 RETAIL (BY VOLUME)</Text>
            {(!retailTop?.topByQty || retailTop.topByQty.length === 0) ? (
              <Text style={{ fontSize: 8, color: '#94a3b8' }}>No retail data available.</Text>
            ) : (
              retailTop.topByQty.map((item: any, idx: number) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingVertical: 4 }}>
                  <Text style={{ fontSize: 8 }}>{idx + 1}. {item.name}</Text>
                  <Text style={{ fontSize: 8, color: '#10b981' }}>{formatNum(item.qty)} bags ({formatKHR(item.profit)})</Text>
                </View>
              ))
            )}
          </View>
        </View>

        {/* SECTION 4: COMPARE MTD VS LAST MONTH */}
        <Text style={styles.sectionTitle}>4. COMPARE MTD VS LAST MONTH</Text>
        <View style={styles.grid2} wrap={false}>
          <HealthBarPDF title="Sales Comparison" current={safeSales} target={lastMonth?.totalSales} color="#2563eb" />
          <HealthBarPDF title="Profit Comparison" current={safeProfit} target={lastMonth?.totalProfit} color="#10b981" />
        </View>
        <View style={styles.grid2} wrap={false}>
          <HealthBarPDF
            title="Biz Expenses Comparison"
            current={(Number(mtd?.bizCashRiel) || 0) + (Number(mtd?.bizQrRiel) || 0) + ((Number(mtd?.bizCashUsd) || 0) * EXCHANGE_RATE)}
            target={(Number(lastMonth?.bizCashRiel) || 0) + (Number(lastMonth?.bizQrRiel) || 0) + ((Number(lastMonth?.bizCashUsd) || 0) * EXCHANGE_RATE)}
            color="#b91c1c"
            reverseLogic
          />
          <HealthBarPDF
            title="Personal Expenses Comparison"
            current={(Number(mtd?.persCashRiel) || 0) + (Number(mtd?.persQrRiel) || 0) + ((Number(mtd?.persCashUsd) || 0) * EXCHANGE_RATE)}
            target={(Number(lastMonth?.persCashRiel) || 0) + (Number(lastMonth?.persQrRiel) || 0) + ((Number(lastMonth?.persCashUsd) || 0) * EXCHANGE_RATE)}
            color="#f59e0b"
            reverseLogic
          />
        </View>

        {/* SECTION 5: TREND ANALYSIS CHARTS */}
        <Text style={styles.sectionTitle}>5. TREND ANALYSIS (DAY 1 - 31)</Text>
        <View style={styles.grid2} wrap={false}>
          <LineChartCardPDF title="Total Sales: This Month vs Last Month" dataCurrent={charts?.thisMonthSales} dataLast={charts?.lastMonthSales} color="#2563eb" />
          <LineChartCardPDF title="Total Profit: This Month vs Last Month" dataCurrent={charts?.thisMonthProfit} dataLast={charts?.lastMonthProfit} color="#10b981" />
        </View>

        {/* SECTION 6: ITEMIZED EXPENSES BY CATEGORY */}
        <Text style={styles.sectionTitle}>6. ITEMIZED EXPENSES BY CATEGORY</Text>
        <View wrap={false}>
          <View style={styles.tableHeader}>
            <Text style={styles.colCat}>Category Name</Text>
            <Text style={styles.colAmt}>Total (KHR)</Text>
            <Text style={styles.colAmt}>Total (USD)</Text>
          </View>
          {categories.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={styles.colCat}>No recorded expenses.</Text>
              <Text style={styles.colAmt}>0 KHR</Text>
              <Text style={styles.colAmt}>$0.00</Text>
            </View>
          ) : (
            categories.map(([cat, val]: any, idx: number) => (
              <View key={idx} style={styles.tableRow} wrap={false}>
                <Text style={styles.colCat}>{cat}</Text>
                <Text style={[styles.colAmt, { color: '#dc2626' }]}>{formatKHR(val?.riel)}</Text>
                <Text style={[styles.colAmt, { color: '#dc2626' }]}>{formatUSD(val?.usd)}</Text>
              </View>
            ))
          )}
        </View>

        {/* SECTION 7: SIGN-OFF SIGNATURES */}
        <View style={{ marginTop: 25, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 }} wrap={false}>
          <View style={{ width: '45%' }}>
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#334155', marginBottom: 25 }}>Prepared By:</Text>
            <View style={{ borderBottomWidth: 1, borderBottomColor: '#cbd5e1' }} />
            <Text style={{ fontSize: 7, color: '#64748b', marginTop: 3 }}>Accountant / POS System Operator</Text>
          </View>
          <View style={{ width: '45%' }}>
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#334155', marginBottom: 25 }}>Approved By:</Text>
            <View style={{ borderBottomWidth: 1, borderBottomColor: '#cbd5e1' }} />
            <Text style={{ fontSize: 7, color: '#64748b', marginTop: 3 }}>Business Ownership Sign-off</Text>
          </View>
        </View>

        {/* DYNAMIC FOOTER */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Rice POS System — Automated Executive Scorecard</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

// --- API ROUTE HANDLER ---
export async function POST(request: Request) {
  try {
    // 🔥 THE FIX: Extract branch_id AND downloadOnly from the incoming request!
    const body = await request.json();
    const branch_id = body.branch_id || 0;
    const downloadOnly = body.downloadOnly === true;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: 'Missing Supabase variables' }, { status: 500 })

    const supabase = createClient(supabaseUrl, supabaseKey)
    const botToken = TELEGRAM_CONFIG.botToken
    const chatId = TELEGRAM_CONFIG.chatId
    
    // We only care about missing Telegram configs if we are actually sending to Telegram
    if (!downloadOnly && (!botToken || !chatId)) {
       return NextResponse.json({ error: 'Missing Telegram config' }, { status: 400 })
    }

    const now = new Date()
    const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Phnom_Penh', month: 'long', year: 'numeric' }).format(now)
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const [yearStr, monthStr] = todayStr.split('-')
    
    // Start of current month & last month
    const startOfMonth = `${yearStr}-${monthStr}-01T00:00:00+07:00`
    const lastMonthDate = new Date(Number(yearStr), Number(monthStr) - 2, 1)
    const lastMonthStart = lastMonthDate.toISOString()

    // Helper to apply branch_id securely to backend queries
    const buildQ = (table: string) => {
      let q = supabase.from(table).select('*').gte('created_at', lastMonthStart);
      if (branch_id !== 0) q = q.eq('branch_id', branch_id);
      return q;
    }

    // Helper for invoice_payments (uses payment_date instead of created_at)
    const buildQPayments = () => {
      let q = supabase.from('invoice_payments').select('*').gte('payment_date', lastMonthStart);
      if (branch_id !== 0) q = q.eq('branch_id', branch_id);
      return q;
    }

    // 🔥 THE FIX: Now these queries are securely filtered by branch_id!
    const [
      { data: salesData },
      { data: invData },
      { data: retData },
      { data: expData },
      { data: payData }
    ] = await Promise.all([
      buildQ('sales'),
      buildQ('invoice_summaries'),
      buildQ('retail_sales'),
      buildQ('expenses'),
      buildQPayments()
    ])

    const wholesaleSales = salesData || []
    const invoices = invData || []
    const retailSales = retData || []
    const expenses = expData || []
    const invoicePayments = payData || []

    const isMTD = (dateStr: string) => new Date(dateStr).getMonth() === now.getMonth() && new Date(dateStr).getFullYear() === now.getFullYear()
    const isLastMonth = (dateStr: string) => {
      const d = new Date(dateStr)
      return d.getMonth() === lastMonthDate.getMonth() && d.getFullYear() === lastMonthDate.getFullYear()
    }

    const parseOwnerSafe = (ownerStr?: string) => {
      if (!ownerStr) return 'both'
      const s = ownerStr.toLowerCase()
      if (s.includes('pich')) return 'pich'
      if (s.includes('jing')) return 'jing'
      if (s.includes('mom')) return 'mom'
      return 'both'
    }

    const calculateSlice = (invSlice: any[], retSlice: any[], expSlice: any[], paySlice: any[]) => {
      let totalSales = 0, pichSales = 0, jingSales = 0, bothSales = 0, momSales = 0
      let totalProfit = 0, pichProfit = 0, jingProfit = 0, bothProfit = 0, momProfit = 0

      invSlice.forEach(inv => {
        const rev = Number(inv.total_sales) || 0; const prof = Number(inv.total_profit) || 0
        const o = parseOwnerSafe(inv.owner)
        if (o === 'mom') { momSales += rev; momProfit += prof }
        else {
          totalSales += rev; totalProfit += prof
          if (o === 'pich') { pichSales += rev; pichProfit += prof } else if (o === 'jing') { jingSales += rev; jingProfit += prof } else { bothSales += rev; bothProfit += prof }
        }
      })

      retSlice.forEach(ret => {
        const customName = ret.custom_rice_type || ret.rice_type || '';
        // 🔥 HSR FIX: Ignore deposits for Gross Sales
        if (customName.includes('កក់')) return;

        const qty = Number(ret.qty) || 0;
        const price = Number(ret.price_per_bag) || 0;
        const cogs = Number(ret.cogs_price) || 0;

        // 🔥 HSR FIX: Apply Math.round() and subtract refunds/discounts!
        let rev = Math.round(qty * price);
        let prof = Math.round((price - cogs) * qty);

        const isNegativeItem = customName.includes('ដូរ') || customName.includes('បញ្ចុះតម្លៃ');
        if (isNegativeItem) {
           rev = -Math.abs(rev);
           prof = -Math.abs(prof);
        }

        totalSales += rev; totalProfit += prof; bothSales += rev; bothProfit += prof
      })

      let cR = 0, cU = 0, qR = 0, qU = 0
      paySlice.forEach((p: any) => {
        const methodStr = (p.payment_method || '').toLowerCase()
        if (methodStr.includes('unpaid') || methodStr.includes('debt')) return
        const amtR = Number(p.amount_paid_riel || 0); const amtU = Number(p.amount_paid_usd || 0)
        const isUsd = methodStr.includes('$'); const isQr = methodStr.includes('qr')
        if (isQr) { if (isUsd) qU += amtU; else qR += amtR } else { if (isUsd) cU += amtU; else cR += amtR }
      })

      let totalExpRiel = 0, totalExpUsd = 0, bizCashRiel = 0, bizCashUsd = 0, bizQrRiel = 0, bizQrUsd = 0, persCashRiel = 0, persCashUsd = 0, persQrRiel = 0, persQrUsd = 0
      const categoryBreakdown: Record<string, { riel: number; usd: number }> = {}

      expSlice.forEach(exp => {
        if (parseOwnerSafe(exp.spender) === 'mom') return
        const r = Number(exp.amount_riel) || 0; const u = Number(exp.amount_usd) || 0
        totalExpRiel += r; totalExpUsd += u
        const isBiz = (exp.description || '').toLowerCase().includes('biz') || (exp.description || '').toLowerCase().includes('business') || (exp.description || '').toLowerCase().includes('staff')
        const isQr = (exp.payment_method || '').toLowerCase().includes('qr')

        if (isBiz) { if (u > 0) { isQr ? bizQrUsd += u : bizCashUsd += u } else { isQr ? bizQrRiel += r : bizCashRiel += r } }
        else { if (u > 0) { isQr ? persQrUsd += u : persCashUsd += u } else { isQr ? persQrRiel += r : persCashRiel += r } }

        const cat = exp.category || exp.description || 'Uncategorized'
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { riel: 0, usd: 0 }
        categoryBreakdown[cat].riel += r; categoryBreakdown[cat].usd += u
      })

      return {
        totalSales, pichSales, jingSales, bothSales, momSales,
        totalProfit, pichProfit, jingProfit, bothProfit, momProfit,
        col: { cR, cU, qR, qU },
        totalExpRiel, totalExpUsd, bizCashRiel, bizCashUsd, bizQrRiel, bizQrUsd, persCashRiel, persCashUsd, persQrRiel, persQrUsd,
        categoryBreakdown
      }
    }

    const mtdMetrics = calculateSlice(
      invoices.filter(i => isMTD(i.created_at)),
      retailSales.filter(r => isMTD(r.created_at)),
      expenses.filter(e => isMTD(e.expense_date || e.created_at)),
      invoicePayments.filter(p => isMTD(p.payment_date || p.created_at))
    )

    const lastMonthMetrics = calculateSlice(
      invoices.filter(i => isLastMonth(i.created_at)),
      retailSales.filter(r => isLastMonth(r.created_at)),
      expenses.filter(e => isLastMonth(e.expense_date || e.created_at)),
      invoicePayments.filter(p => isLastMonth(p.payment_date || p.created_at))
    )

    const getTop = (dataSet: any[]) => {
      const map: Record<string, { name: string, qty: number, profit: number }> = {}
      dataSet.filter(s => isMTD(s.created_at)).forEach(sale => {
        const name = sale.custom_rice_type || sale.rice_type || 'Unknown'
        // 🔥 HSR FIX: Ignore deposits for Top Sellers
        if (name.includes('កក់')) return;

        const qty = Number(sale.qty || 0)
        const price = Number(sale.price_per_bag || 0);
        const cogs = Number(sale.cogs_price || 0);
        
        // 🔥 HSR FIX: Round and subtract
        let profit = Math.round((price - cogs) * qty);
        let finalQty = qty;

        const isNegativeItem = name.includes('ដូរ') || name.includes('បញ្ចុះតម្លៃ');
        if (isNegativeItem) {
            profit = -Math.abs(profit);
            finalQty = -Math.abs(finalQty);
        }

        if (!map[name]) map[name] = { name, qty: 0, profit: 0 }
        map[name].qty += finalQty; map[name].profit += profit
      })
      return { topByQty: Object.values(map).filter(item => item.qty > 0 || item.profit > 0).sort((a, b) => b.qty - a.qty).slice(0, 3) }
    }

    const wholesaleTop = getTop(wholesaleSales)
    const retailTop = getTop(retailSales)

    const getDailyArr = (isTarget: any) => {
      const salesArr = new Array(31).fill(0); const profArr = new Array(31).fill(0)
      const allSales = [...wholesaleSales, ...retailSales].filter(s => isTarget(s.created_at) && parseOwnerSafe(s.owner) !== 'mom')
      allSales.forEach(s => {
        const customName = s.custom_rice_type || s.rice_type || '';
        // 🔥 HSR FIX: Ignore deposits for daily charts
        if (customName.includes('កក់')) return;

        const idx = new Date(s.created_at).getDate() - 1
        if (idx >= 0 && idx < 31) {
          const qty = Number(s.qty || 0);
          const price = Number(s.price_per_bag || 0);
          const cogs = Number(s.cogs_price || 0);
          
          // 🔥 HSR FIX: Round and subtract
          let rev = Math.round(qty * price);
          let prof = Math.round((price - cogs) * qty);

          const isNegativeItem = customName.includes('ដូរ') || customName.includes('បញ្ចុះតម្លៃ');
          if (isNegativeItem) {
              rev = -Math.abs(rev);
              prof = -Math.abs(prof);
          }

          salesArr[idx] += rev;
          profArr[idx] += prof;
        }
      })
      return { salesArr, profArr }
    }

    const thisMthDaily = getDailyArr(isMTD)
    const lastMthDaily = getDailyArr(isLastMonth)
    const charts = {
      thisMonthSales: thisMthDaily.salesArr,
      lastMonthSales: lastMthDaily.salesArr,
      thisMonthProfit: thisMthDaily.profArr,
      lastMonthProfit: lastMthDaily.profArr
    }

    const pdfBuffer = await renderToBuffer(
      <MonthlyReportPDF
        monthName={monthName}
        mtd={mtdMetrics}
        lastMonth={lastMonthMetrics}
        wholesaleTop={wholesaleTop}
        retailTop={retailTop}
        categoryBreakdown={mtdMetrics.categoryBreakdown}
        charts={charts}
      />
    )

    const cleanFilename = `Monthly_Report_Branch_${branch_id}.pdf`

    // 🔥 THE FIX: Convert the Node Buffer into a standard Web Blob FIRST
    const pdfBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })

    // 🔥 If they only want to download, return the Blob! No more TypeScript errors.
    if (downloadOnly) {
       return new NextResponse(pdfBlob, {
         status: 200,
         headers: {
           'Content-Type': 'application/pdf',
           'Content-Disposition': `attachment; filename="${cleanFilename}"`,
         }
       });
    }

    // OTHERWISE, THEY CLICKED "SEND TO TELEGRAM", SO DO THE TELEGRAM LOGIC:
    const formData = new FormData()
    formData.append('chat_id', chatId)
    const branchLabel = branch_id === 0 ? 'GLOBAL HQ' : `BRANCH ${branch_id}`
    formData.append('caption', `📊 *${monthName.toUpperCase()} — FULL EXECUTIVE BUSINESS REPORT (${branchLabel})*\n\n📄 Complete multi-section statement attached (includes all MTD SaaS cards, Trend charts, and Expense categorization).`)
    formData.append('parse_mode', 'Markdown')

    // Attach the exact same pdfBlob here
    formData.append('document', pdfBlob, cleanFilename)

    // 🚦 ROUTE PDF TO FINANCIAL REPORT TOPIC
    const targetThreadId = (TELEGRAM_CONFIG as any).reportTopics?.[branch_id || 0];
    if (targetThreadId) {
      formData.append('message_thread_id', String(targetThreadId));
    }

    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: formData })
    const telegramResult = await telegramRes.json()
    if (!telegramRes.ok) throw new Error(telegramResult.description || 'Telegram failed')

    return NextResponse.json({ success: true, telegramResult })
  } catch (error: any) {
    console.error('PDF Send Error:', error)
    return NextResponse.json({ error: error.message || 'Server Error' }, { status: 500 })
  }
}