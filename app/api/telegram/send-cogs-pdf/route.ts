// app/api/telegram/send-cogs-pdf/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { generateAndSendCogsReport } from '@/lib/cogsReportSender';

// 🔥 Keep these Vercel configs from the old file so your PDF generation doesn't timeout!
export const runtime = 'nodejs';
export const maxDuration = 30; 

export async function POST(request: NextRequest) {
  try {
    // 🔥 MULTI-TENANT FIX: Added branch_id to the extraction
    const { fromDate, toDate, ownerTab, downloadOnly, records, branch_id } = await request.json();

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'Date range required' }, { status: 400 });
    }

    const validOwnerTab = (ownerTab || 'mom').toLowerCase() === 'mom' ? 'mom' : 'others';

    const result: any = await generateAndSendCogsReport({
      fromDate,
      toDate,
      ownerTab: validOwnerTab,
      downloadOnly: !!downloadOnly,
      clientRecords: records || null, // 🔥 Passes UI records directly to the PDF printer
      branch_id: branch_id || 0       // 🔥 MULTI-TENANT FIX: Securely pass the branch context!
    });

    if (downloadOnly && result?.pdfBuffer) {
      return new NextResponse(new Uint8Array(result.pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${result.filename || 'COGS-Report.pdf'}"`
        }
      });
    }

    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('API Send COGS PDF Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}