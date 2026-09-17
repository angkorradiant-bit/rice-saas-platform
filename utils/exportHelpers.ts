export function exportToExcel(data: any[], filename = 'Sales-Report.csv') {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  // 1. Extract headers dynamically from the first data object keys
  const keys = Object.keys(data[0]);
  
  // Create readable column headers (optional formatting)
  const headerRow = keys.map(key => key.replace(/_/g, ' ').toUpperCase());

  // 2. Map data rows into CSV format, ensuring commas and quotes are escaped
  const csvRows = data.map(row => {
    return keys.map(key => {
      let val = row[key];
      if (val === null || val === undefined) val = '';
      // Escape double quotes and wrap strings in quotes to handle commas inside text
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',');
  });

  // 3. Combine headers and rows
  const csvContent = [headerRow.join(','), ...csvRows].join('\n');

  // 4. 🔥 CRITICAL FOR KHMER TEXT: Prepend UTF-8 BOM (\uFEFF) so Excel reads Unicode correctly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // 5. Trigger automated browser download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}