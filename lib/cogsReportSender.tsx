// lib/cogsReportSender.ts

import { createClient } from '@supabase/supabase-js';
import { TELEGRAM_CONFIG } from '@/lib/telegramConfig';
import { parseOwner } from '@/utils/formatters';
// @ts-ignore
import puppeteer from 'puppeteer-core';
// @ts-ignore
import chromium from '@sparticuz/chromium';

const formatRiel = (val: number) => `${Math.round(val || 0).toLocaleString('en-US')} ៛`;

// --- 1. CAMBODIA TIMEZONE DATE HELPER (Asia/Phnom_Penh | UTC+7) ---
function getCambodiaDateStr(dateVal: string): string {
  if (!dateVal) return '';
  try {
    const d = new Date(dateVal);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Phnom_Penh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch (e) {
    return dateVal.substring(0, 10);
  }
}

// --- 2. FRONTEND GROUPING MATH ---
function processSellerData(sellerSales: any[]) {
  const customerGroups: Record<string, any[]> = {};

  sellerSales.forEach((row) => {
    const customer = row.customer_name || 'Walk-in';
    if (!customerGroups[customer]) customerGroups[customer] = [];
    customerGroups[customer].push(row);
  });

  const finalRows: any[] = [];
  let sellerGrandTotal = 0;

  Object.keys(customerGroups).forEach((customer) => {
    const group = customerGroups[customer];
    let normalRows: any[] = [];
    let douRows: any[] = [];
    let consumedRows: any[] = [];
    let specialRows: any[] = [];

    group.forEach((item) => {
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
}

// --- 3. HTML A4 TEMPLATE GENERATOR (100% IDENTICAL TO UI) ---
function generateHtmlReport(
  groupedBySeller: Record<string, any[]>,
  combinedGrandTotal: number,
  fromDate: string,
  toDate: string,
  tabLabel: string
): string {
  let sellersHtml = '';

  Object.keys(groupedBySeller).forEach((seller) => {
    const { rows, sellerGrandTotal } = processSellerData(groupedBySeller[seller]);

    let sellerRowsHtml = '';

    rows.forEach((row) => {
      const invNum = row.invoice_id ? String(row.invoice_id).replace(/\D/g, '') : '';
      const amountColor = row.isNegative ? 'color: red;' : 'color: inherit;';

      sellerRowsHtml += `
        <tr>
          <td style="text-align: center; white-space: nowrap;">${invNum}</td>
          ${row.isFirstOfCustomer ? `<td rowspan="${row.rowSpan}" style="vertical-align: middle;">${row.customer_name || 'Walk-in'}</td>` : ''}
          <td>
            <div style="color: #0f172a;">${row.rice_type || '-'}</div>
          </td>
          <td>${row.custom_rice_type || ''}</td>
          <td style="text-align: center; white-space: nowrap;">${Number(row.qty || 0).toLocaleString('en-US')}</td>
          <td style="text-align: right; white-space: nowrap;">${Number(row.cogs_price || 0).toLocaleString('en-US')}</td>
          <td style="text-align: right; white-space: nowrap; ${amountColor}">${Math.round(row.calculatedAmount).toLocaleString('en-US')}</td>
        </tr>
      `;
    });

    sellersHtml += `
      <div style="margin-bottom: 30px;">
        <h2 style="font-size: 16px; margin: 0 0 8px 0; color: #333; font-family: 'Noto Sans Khmer', Arial, sans-serif; font-weight: bold;">
  ថៅកែ ${seller.toUpperCase()}
</h2>
        <table class="report-table">
          <thead>
            <tr style="background-color: #fffacd;">
              <th style="width: 12%;">INV</th>
              <th style="width: 18%;">អតិថិជន</th>
              <th style="width: 18%;">ប្រភេទអង្ករ</th>
              <th style="width: 16%;">ឈ្មោះក្នុងប៊ុង</th>
              <th style="width: 8%;">ចំនួន</th>
              <th style="width: 13%;">តម្លៃ</th>
              <th style="width: 15%;">សរុប</th>
            </tr>
          </thead>
          <tbody>
            ${sellerRowsHtml}
            <tr style="background-color: #fffacd;">
              <td colspan="6" class="summary-label" style="padding-right: 10px;">សរុប</td>
              <td class="summary-value">${Math.round(sellerGrandTotal).toLocaleString('en-US')} ៛</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  });

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Noto Sans Khmer', Arial, sans-serif;
          font-size: 13px;
          color: #0f172a;
          margin: 0;
          padding: 0;
          background: #ffffff;
        }
        .a4-paper-container {
          width: 794px;
          min-height: 1123px;
          margin: 0 auto;
          padding: 40px;
          position: relative;
          box-sizing: border-box;
          background: #ffffff;
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
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="a4-paper-container">
        <img class="center-logo" src="https://i.imgur.com/s0hg3MQ.png" alt="Logo" crossOrigin="anonymous" />
        
        <div class="a4-content">
          <h1 style="text-align: center; font-size: 22px; color: green; margin: 0 0 20px 0; font-family: 'Noto Sans Khmer', Arial, sans-serif; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
  <img src="https://cdnjs.cloudflare.com/ajax/libs/emoji-datasource-apple/15.0.1/img/apple/64/1f33e.png" alt="rice" style="width: 26px; height: 26px;" />
  អង្ករត្រូវទូទាត់
  <img src="https://cdnjs.cloudflare.com/ajax/libs/emoji-datasource-apple/15.0.1/img/apple/64/1f9fe.png" alt="receipt" style="width: 26px; height: 26px;" />
</h1>

          ${Object.keys(groupedBySeller).length === 0 ? '<div style="text-align: center; color: #64748b; padding: 40px;">No COGS sales recorded for this date range.</div>' : sellersHtml}

          <div style="margin-top: 40px;">
            <table style="width: 100%; border-collapse: collapse; border: 2px solid #000;">
              <tbody>
                <tr style="background-color: #fffacd;">
                  <td class="summary-label" style="width: 80%; padding: 10px; border: 1px solid #000;">
                    សរុបរួមទាំងអស់
                  </td>
                  <td class="summary-value" style="width: 20%; padding: 10px; border: 1px solid #000; text-align: center;">
                    ${Math.round(combinedGrandTotal).toLocaleString('en-US')} ៛
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style="text-align: right; margin-top: 20px; font-size: 12px; color: #64748b;">
            Date: ${fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`} • Phnom Penh, Cambodia
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// --- 4. MAIN REPORT SENDER FUNCTION ---
export async function generateAndSendCogsReport({
  fromDate,
  toDate,
  ownerTab,
  downloadOnly = false,
  clientRecords = null,
  branch_id = 0 // 👈 🔥 Added to arguments
}: {
  fromDate: string;
  toDate: string;
  ownerTab: 'mom' | 'others';
  downloadOnly?: boolean;
  clientRecords?: any[] | null;
  branch_id?: number; // 👈 🔥 Added to types
}) {
  const isMomTab = ownerTab === 'mom';
  let rawSales: any[] = [];

  // 🔥 1. If UI passed records directly, use them immediately (Zero DB queries!)
  if (Array.isArray(clientRecords) && clientRecords.length > 0) {
    rawSales = clientRecords;
  } else {
    // 🔥 2. Otherwise (7 PM Cron), fetch a 48-Hour Window to prevent UTC+7 timezone cutoff
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const dStart = new Date(fromDate);
    dStart.setDate(dStart.getDate() - 1);
    const dEnd = new Date(toDate);
    dEnd.setDate(dEnd.getDate() + 1);
    const startIso = dStart.toISOString().substring(0, 10);
    const endIso = dEnd.toISOString().substring(0, 10);

    const [{ data: sales }, { data: retailSales }] = await Promise.all([
      // 🔥 MULTI-TENANT FIX: Added .eq('branch_id', branch_id)
      supabase.from('sales').select('*').eq('branch_id', branch_id).gte('created_at', `${startIso}T00:00:00`).lte('created_at', `${endIso}T23:59:59`),
      supabase.from('retail_sales').select('*').eq('branch_id', branch_id).gte('created_at', `${startIso}T00:00:00`).lte('created_at', `${endIso}T23:59:59`)
    ]);

    rawSales = [...(sales || []), ...(retailSales || [])].filter((s) => {
      if (!s.created_at) return false;
      const camDate = getCambodiaDateStr(s.created_at);
      const utcDate = s.created_at.substring(0, 10);
      const matchesDate = (camDate >= fromDate && camDate <= toDate) || (utcDate >= fromDate && utcDate <= toDate);

      const ownerStr = (s.owner || s.customer_name || '').toString().toLowerCase();
      const parsed = parseOwner(s.owner || s.customer_name);
      const isMomRow = ownerStr.includes('mom') || parsed === 'mom';

      const matchesOwner = isMomTab ? isMomRow : !isMomRow;
      return matchesDate && matchesOwner;
    });
  }

  const groupedBySeller: Record<string, any[]> = {};
  let combinedGrandTotal = 0;

  rawSales.forEach((s) => {
    let seller = parseOwner(s.owner || s.customer_name);
    seller = seller.charAt(0).toUpperCase() + seller.slice(1);
    if (!groupedBySeller[seller]) groupedBySeller[seller] = [];
    groupedBySeller[seller].push(s);
  });

  Object.keys(groupedBySeller).forEach((seller) => {
    const { sellerGrandTotal } = processSellerData(groupedBySeller[seller]);
    combinedGrandTotal += sellerGrandTotal;
  });

  const tabLabel = isMomTab ? 'Mom COGS' : 'Pich / Jing / Both COGS';
  const htmlContent = generateHtmlReport(groupedBySeller, combinedGrandTotal, fromDate, toDate, tabLabel);

  // --- LAUNCH HEADLESS BROWSER (ZERO references to 'puppeteer' package) ---
  const isLocal = process.env.NODE_ENV === 'development';
  let browser: any;

  if (isLocal) {
    browser = await puppeteer.launch({
      channel: 'chrome',
      headless: true,
    });
  } else {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  
  const rawPdfBytes = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
  });

  await browser.close();

  const pdfBuffer = Buffer.from(rawPdfBytes);

  if (downloadOnly) {
    return { success: true, pdfBuffer, filename: `COGS-${ownerTab.toUpperCase()}-${fromDate}.pdf` };
  }

  const botToken = TELEGRAM_CONFIG.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = TELEGRAM_CONFIG.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Telegram credentials missing');
  }

  const pdfBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
  const tgFormData = new FormData();
  tgFormData.append('chat_id', chatId);
  tgFormData.append('document', pdfBlob, `COGS-${ownerTab.toUpperCase()}-${fromDate}.pdf`);
  tgFormData.append(
    'caption',
    `🌾 <b>${tabLabel} A4 REPORT</b>\n📅 Date: <b>${fromDate} to ${toDate}</b>\n💰 Total Due: <b>${Math.round(combinedGrandTotal).toLocaleString('en-US')} ៛</b>\n✅ Attached: Multi-page A4 PDF`
  );
  tgFormData.append('parse_mode', 'HTML');

  // 🚦 ROUTE PDF TO FINANCIAL REPORT TOPIC
  const targetThreadId = (TELEGRAM_CONFIG as any).reportTopics?.[branch_id || 0];
  if (targetThreadId) {
    tgFormData.append('message_thread_id', String(targetThreadId));
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: tgFormData
  });

  const tgResult = await tgRes.json();
  if (!tgRes.ok) {
    throw new Error(`Telegram Upload Error: ${JSON.stringify(tgResult)}`);
  }

  return { success: true, messageId: tgResult.result?.message_id };
}