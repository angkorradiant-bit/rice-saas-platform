import * as XLSX from 'xlsx';

export function exportBizDataToExcel(allTransactions: any[], filename = 'Business-Report.xlsx') {
  if (!allTransactions || allTransactions.length === 0) {
    alert('No data available to export.');
    return;
  }

  // 1. 🔥 THE COLUMN MAPPER (Turns messy DB data into a beautiful business report)
  const formatSalesRow = (t: any) => {
    // Skip empty summary rows to keep line-item math accurate
    if (t.source === 'Wholesale Invoice Summary') return null;

    return {
      'Date': new Date(t.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      'Receipt ID': t.invoice_id || t.transaction_id || '-',
      'Source': t.source,
      'Customer Name': t.customer_name || 'Walk-in',
      'Staff Member': t.owner || '-',
      'Product Name': t.rice_type || '-',
      'Quantity': t.qty || 0,
      'Unit Price (៛)': t.price_per_bag || 0,
      'Unit COGS (៛)': t.cogs_price || 0,
      'Gross Sales (៛)': t.total_sales || 0,
      'Total COGS (៛)': t.total_cogs || 0,
      'Gross Profit (៛)': t.total_profit || 0,
    };
  };

  // 2. 🗂️ FILTER DATA INTO YOUR 3 REQUESTED TABS
  // Tab 1: ALL SALES (Retail + Wholesale)
  const allSalesData = allTransactions
    .filter(t => t.source === 'Retails only' || t.source === 'Walk-in Wholesale' || t.source === 'Non-Walk-in Wholesale')
    .map(formatSalesRow)
    .filter(Boolean);

  // Tab 2: RETAIL ONLY
  const retailData = allTransactions
    .filter(t => t.source === 'Retails only')
    .map(formatSalesRow)
    .filter(Boolean);

  // Tab 3: WHOLESALE ONLY (Includes both Walk-in and Non-Walk-in)
  const wholesaleData = allTransactions
    .filter(t => t.source === 'Walk-in Wholesale' || t.source === 'Non-Walk-in Wholesale')
    .map(formatSalesRow)
    .filter(Boolean);

  // BONUS TAB 4: EXPENSES (Just to keep your accounting perfect!)
  const expenseData = allTransactions
    .filter(t => t.source.includes('Expense') || t.source === 'Staff Debt')
    .map(t => ({
      'Date': new Date(t.created_at).toLocaleString('en-GB'),
      'Type': t.source,
      'Description': t.description || '-',
      'Category': t.category || '-',
      'Staff Member': t.owner || '-',
      'Amount (៛)': t.amount_riel || 0,
      'Amount ($)': t.amount_usd || 0,
      'Status': t.status || '-'
    }));

  // 3. 🏗️ BUILD THE EXCEL WORKBOOK
  const wb = XLSX.utils.book_new();

  // Convert JSON to Excel Sheets
  const wsAll = XLSX.utils.json_to_sheet(allSalesData);
  const wsWholesale = XLSX.utils.json_to_sheet(wholesaleData);
  const wsRetail = XLSX.utils.json_to_sheet(retailData);
  const wsExpenses = XLSX.utils.json_to_sheet(expenseData);

  // Add Sheets to Workbook (This creates the tabs at the bottom of Excel)
  XLSX.utils.book_append_sheet(wb, wsAll, "All Sales");
  XLSX.utils.book_append_sheet(wb, wsWholesale, "Wholesale Data");
  XLSX.utils.book_append_sheet(wb, wsRetail, "Retail Data");
  if (expenseData.length > 0) XLSX.utils.book_append_sheet(wb, wsExpenses, "Expenses & Debts");

  // 4. 🚀 TRIGGER NATIVE BROWSER DOWNLOAD
  XLSX.writeFile(wb, filename);
}