// utils/riceSorter.ts

export const MASTER_RICE_ORDER = [
  'ម្លិះ', 
  'សែនក្រអូប', 
  '5451', 
  'រំដួល', 
  'ខ្ញី', 
  'មិញ', 
  'ខុន', 
  'បីកំណាត់', 
  'ដំណើប', 
  'សម្រូប'
];

// Helper to find the priority rank of a rice name
export const getCategoryPriority = (productName: string) => {
  const lowerName = (productName || '').toLowerCase().trim();
  
  // 🔥 FIX: Force any product starting with or containing "បាវ" to the absolute bottom!
  if (lowerName.startsWith('បាវ') || lowerName.includes('ថ្លៃបាវ')) {
    return 9999; 
  }

  // Checks from top to bottom. If a name has multiple keywords (e.g., "ម្លិះ 5451"), 
  // it assigns it to whichever keyword appears highest on the list.
  for (let i = 0; i < MASTER_RICE_ORDER.length; i++) {
    if (lowerName.includes(MASTER_RICE_ORDER[i].toLowerCase())) {
      return i; // Returns 0 for top priority, 1 for second, etc.
    }
  }
  return 999; // Sends unrecognized rice (Other) below the main list, but above the bags
};

// 🚦 THE MASTER COMPARATOR
export const riceCategoryComparator = (a: any, b: any, priceKey: 'price' | 'cost_price' = 'price') => {
  const priorityA = getCategoryPriority(a.name || a.rice_type || '');
  const priorityB = getCategoryPriority(b.name || b.rice_type || '');

  // 1. Sort by Rice Family First
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  // 2. If they are the exact same family, sort by Price (High to Low)
  const priceA = Number(a[priceKey] || 0);
  const priceB = Number(b[priceKey] || 0);
  return priceB - priceA;
};