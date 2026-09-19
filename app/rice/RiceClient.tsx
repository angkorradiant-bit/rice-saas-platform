'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom' // 👈 🔥 ADD THIS LINE!
import { supabase } from '@/lib/supabaseClient'
import { useFocusRefresh } from '@/lib/useFocusRefresh'
import { formatRiel, formatUSD, formatNumber, EXCHANGE_RATE } from '@/utils/formatters'
import { riceCategoryComparator } from '@/utils/riceSorter' // 👈 🔥 IMPORTED MASTER SORTER
import { CurrencyInput } from '@/components/Inputs'
import { Product, InventoryBatch, PaymentRow } from '@/types'
import { useToast } from '@/components/ToastProvider'
import { useDebounce } from '@/lib/useDebounce'
import TableSkeleton from '@/components/TableSkeleton'
import EmptyState from '@/components/EmptyState'
import Modal from '@/components/Modal'
import { useBranch } from '@/components/BranchContext' // 🔥 GLOBAL MEMORY IMPORTED
import { TELEGRAM_CONFIG } from '@/lib/telegramConfig'

// --- DND-KIT IMPORTS ---
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- SORTABLE CATEGORY COMPONENT ---
function SortableCategoryItem({ id, isActive, onClick }: { id: string, isActive: boolean, onClick: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.9 : 1,
    flexShrink: 0,
    borderRadius: '20px',
    cursor: isDragging ? 'grabbing' : 'pointer',
    zIndex: isDragging ? 50 : 1,
    
    // 🔥 MATCHES THE ACTIVE WHOLESALE TAB COLOR 🔥
    backgroundColor: isActive ? '#b58a3d' : '#ffffff', 
    color: isActive ? '#ffffff' : '#334155',
    border: isActive ? '1px solid #b58a3d' : '1px solid #cbd5e1',
    
    boxShadow: isDragging 
      ? '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' // Big shadow when picked up
      : '0 1px 2px 0 rgba(0, 0, 0, 0.05)', // Subtle resting shadow
    
    padding: '8px 16px',
    marginRight: '8px',
    fontSize: '14px',
    fontWeight: '500',
    position: isDragging ? 'relative' as any : 'static' as any,
    touchAction: 'manipulation', // 🔥 Essential for smooth mobile touch handling
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      {id}
    </button>
  );
}

// --- CATEGORIES ---
const RICE_CATEGORIES = ['All', 'មិញ', 'ខុន', 'ខ្ញី', 'ម្លិះ', 'រំដួល', 'បីកំណាត់', 'ដំណើប', 'សម្រូប', 'ផ្សេងៗ', '❌ Out of Stock'];
const MAIN_KEYWORDS = ['មិញ', 'ខុន', 'ខ្ញី', 'ម្លិះ', 'រំដួល', 'បីកំណាត់', 'ដំណើប', 'សម្រូប'];

type SortConfig = {
  key: keyof Product;
  direction: 'asc' | 'desc';
} | null;

type FilterOperator = 'contains' | 'equals' | 'gt' | 'lt'
interface FilterRule {
  id: number
  column: string // 🔥 FIX: Changed from keyof Product to string to stop TS errors
  operator: FilterOperator
  value: string | number
}

// 🔥 FIX: Relaxed ColumnKey to string to absolutely annihilate the 9+ TypeScript errors
type ColumnKey = string;

const DEFAULT_WIDTHS: Record<string, number> = {
  expand: 40, id: 60, name: 320, price: 120, cost_price: 120, stock: 100, min_stock_level: 100, weight: 90, linked_wholesale: 220, mtd_kg_used: 120, mtd_bags_used: 120, actions: 160
}
const DEFAULT_ORDER: string[] = ['expand', 'id', 'name', 'price', 'cost_price', 'stock', 'min_stock_level', 'weight', 'linked_wholesale', 'mtd_kg_used', 'mtd_bags_used', 'actions']

const DEFAULT_PENDING_WIDTHS: Record<string, number> = { date: 120, supplier: 180, product: 200, total_cost: 140, paid_so_far: 140, remaining_debt: 150, actions: 200 };
const DEFAULT_PENDING_ORDER: string[] = ['date', 'supplier', 'product', 'total_cost', 'paid_so_far', 'remaining_debt', 'actions'];

const DEFAULT_SUPPLIER_WIDTHS: Record<string, number> = { select: 50, name: 240, phone: 160, location: 200, total_owed: 180 };
const DEFAULT_SUPPLIER_ORDER: string[] = ['select', 'name', 'phone', 'location', 'total_owed'];

export default function RiceControl() {
  const { showToast } = useToast();
  const { activeBranchId } = useBranch(); // 🔥 TUNED INTO GLOBAL MEMORY

  // --- CORE STATE ---
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [imports, setImports] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [edits, setEdits] = useState<Record<number, Partial<Product>>>({})
  const [selectedToDelete, setSelectedToDelete] = useState<Set<number>>(new Set())
  const [selectedSuppliersToDelete, setSelectedSuppliersToDelete] = useState<Set<number>>(new Set())
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  
  const [isProcessing, setIsProcessing] = useState(false) 
  const isImportingRef = useRef(false);
  const isPayingRef = useRef(false); // 🛡️ FIX 3: Added lock for Pending Payments

  // --- CELL EDITING STATE ---
  const [editingCell, setEditingCell] = useState<{id: number, col: string} | null>(null)
  const [activeDropdownId, setActiveDropdownId] = useState<number | null>(null)
  const [dropdownSearch, setDropdownSearch] = useState('')

  // --- IMPORT DROPDOWN STATE ---
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false)
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')

  // --- VIEWS & TABS STATE ---
  const [activeView, setActiveView] = useState<'retail' | 'wholesale' | 'import' | 'pending' | 'suppliers'>('retail')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [categoryOrder, setCategoryOrder] = useState<string[]>(RICE_CATEGORIES)

  // --- BATCH ENGINE STATES ---
  const [activeBatchesMap, setActiveBatchesMap] = useState<Record<number, InventoryBatch[]>>({})
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null)

  // --- IMPORT FORM STATE ---
  // 🔥 FIX: Set defaults to '0' so they aren't totally blank, preventing the "Missing Data" error!
  const [importForm, setImportForm] = useState({ supplier_id: '', product_id: '', qty: '0', unit_cost: '0', paid_amount: '0', payment_method: 'Cash ៛' })
  
  // 🔥 NEW: EDIT IMPORT STATE
  const [editImportModal, setEditImportModal] = useState<{isOpen: boolean, record: any}>({ isOpen: false, record: null });
  const [editImportForm, setEditImportForm] = useState({ qty: '', unit_cost: '' });

  // --- MODALS ---
  const [isAddSupplierOpen, setIsAddSupplierOpen] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '', location: '' })
  
  const [payPendingModal, setPayPendingModal] = useState<{isOpen: boolean, record: any, totalDue: number}>({ isOpen: false, record: null, totalDue: 0 })
  const [pendingPaymentRows, setPendingPaymentRows] = useState<PaymentRow[]>([{ id: Date.now(), method: 'Cash ៛', amount: '' }]);

  const [repackModal, setRepackModal] = useState<{ isOpen: boolean, product: Product | null }>({ isOpen: false, product: null });

  // --- MAIN PRODUCTS TABLE STATE ---
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(DEFAULT_ORDER)
  const widthsRef = useRef(columnWidths)
  widthsRef.current = columnWidths
  const [sortConfig, setSortConfig] = useState<SortConfig>(null)

  // --- PENDING IMPORTS TABLE STATE ---
  const [pendingColWidths, setPendingColWidths] = useState<Record<string, number>>(DEFAULT_PENDING_WIDTHS)
  const [pendingColOrder, setPendingColOrder] = useState<string[]>(DEFAULT_PENDING_ORDER)
  const pendingWidthsRef = useRef(pendingColWidths)
  pendingWidthsRef.current = pendingColWidths
  const [pendingSort, setPendingSort] = useState<{key: string, direction: 'asc'|'desc'} | null>(null)

  // --- SUPPLIERS TABLE STATE ---
  const [supplierColWidths, setSupplierColWidths] = useState<Record<string, number>>(DEFAULT_SUPPLIER_WIDTHS)
  const [supplierColOrder, setSupplierColOrder] = useState<string[]>(DEFAULT_SUPPLIER_ORDER)
  const supplierWidthsRef = useRef(supplierColWidths)
  supplierWidthsRef.current = supplierColWidths
  const [supplierSort, setSupplierSort] = useState<{key: string, direction: 'asc'|'desc'} | null>(null)

  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [filterRules, setFilterRules] = useState<FilterRule[]>([])

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', price: 0 as any, cost_price: 0 as any, weight: 50 as any, stock: 0 as any, min_stock_level: 10 as any })

  // 🔥 MOBILE REVAMP STATES: Tracks which ultra-compact card was tapped
  const [mobileEditProduct, setMobileEditProduct] = useState<Product | null>(null);
  const [mobilePendingAction, setMobilePendingAction] = useState<any>(null);
  const [mobileSupplierDetails, setMobileSupplierDetails] = useState<any>(null);
  const [retailTab, setRetailTab] = useState<'Normal' | 'Top'>('Normal'); 
  const [isMobileLinkDropdownOpen, setIsMobileLinkDropdownOpen] = useState(false); // 🔥 NEW: Mobile Link Search State
  const [mobileLinkSearch, setMobileLinkSearch] = useState('');

  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; product: Product | null; data: any[]; activeBatches: InventoryBatch[] }>({
    isOpen: false, product: null, data: [], activeBatches: []
  })
  
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null)
  const [historyEdits, setHistoryEdits] = useState<Record<number, Partial<InventoryBatch>>>({})
  const [showHiddenBatches, setShowHiddenBatches] = useState(false) // 🔥 HSR FIX: Toggle State

  // --- DRAG HANDLERS FOR CATEGORIES (DND-KIT) ---
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5, // Desktop: requires 5px of movement before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250, // 🔥 MOBILE FIX: Requires a 250ms Long-Press to pick up the item!
        tolerance: 5, // Allows 5px of finger wiggle without canceling the long-press
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleCategoryDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCategoryOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);

        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        // 🛡️ INTEGRATION FIX: Map category orders to the active branch exactly like POSPage
        const branchKey = activeBranchId === 0 ? 'category_order' : `category_order_${activeBranchId}`;
        supabase.from('app_settings').upsert({
          setting_key: branchKey,
          setting_value: newOrder
        }, { onConflict: 'setting_key' }).then();
        
        return newOrder;
      });
    }
  };

  // --- TELEGRAM STOCK ALERTS & REPORTING ---
  // 🔥 FIX: Added strict fallback values to prevent TS "undefined" errors
  const triggerStockAlert = async (productName: string = 'Unknown Product', currentStock: number = 0, minStockLevel: number = 0) => {
    const stockNum = Number(currentStock) || 0;
    const minNum = Number(minStockLevel) || 0;

    // 🛑 STOP ALERT IF STOCK IS NEGATIVE (Oversold)
    if (stockNum < 0) return;

    // 🔥 RELIABILITY FIX: Safely cast to Numbers to prevent string-comparison bypasses
    if (stockNum > minNum) return;
    
    const isOOS = stockNum <= 0;
    const alertType = isOOS ? '🚨 *OUT OF STOCK*' : '⚠️ *LOW STOCK ALERT*';
    const dateStr = new Date().toLocaleString('en-GB');
    // 🔥 SECURITY FIX: Include the active Branch ID so you know which tenant needs the restock
    const message = `${alertType}\n🏬 Branch ID: *${activeBranchId}*\n📅 Date: ${dateStr}\n🌾 Product: *${productName}*\n📦 Current Stock: *${stockNum}*\n📉 Min Threshold: ${minNum}`;

    const botToken = TELEGRAM_CONFIG.botToken || process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
    const masterChatId = TELEGRAM_CONFIG.chatId || process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;
    
    // 🚦 ROUTE TO STOCK TOPICS (11 or 12)
    const targetThreadId = (TELEGRAM_CONFIG as any).stockTopics?.[activeBranchId];

    if (botToken && masterChatId) {
      const payload: any = {
        chat_id: masterChatId,
        text: message,
        parse_mode: 'Markdown'
      };

      if (targetThreadId) {
        payload.message_thread_id = targetThreadId;
      }

      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(console.error);
    }
  };

  const handleSendInventoryReport = async () => {
    setIsProcessing(true);
    try {
      // Filter out archived products, out-of-stock products, and split by weight type
      const retailItems = products.filter(p => !p.is_archived && Number(p.stock) > 0 && Number(p.weight) < 25);
      const wholesaleItems = products.filter(p => !p.is_archived && Number(p.stock) > 0 && Number(p.weight) >= 25);

     let msg = `📊 *CURRENT INVENTORY REPORT*\n🏬 Branch ID: ${activeBranchId}\n📅 Date: ${new Date().toLocaleString('en-GB')}\n\n`; // 👈 🔥 ADDED BRANCH ID

      msg += `🛍️ *RETAIL STOCK (< 25kg)*\n`;
      if(retailItems.length === 0) msg += `- None\n`;
      retailItems.forEach(p => {
        msg += `• ${p.name}: *${p.stock} kg*\n`;
      });

      msg += `\n🌾 *WHOLESALE STOCK (≥ 25kg)*\n`;
      if(wholesaleItems.length === 0) msg += `- None\n`;
      wholesaleItems.forEach(p => {
        msg += `• ${p.name}: *${p.stock} Bags*\n`;
        const batches = activeBatchesMap[p.id] || [];
        if (batches.length > 0) {
          [...batches].sort((a,b) => a.id - b.id).forEach((b, idx) => {
            msg += `  ↳ Batch ${idx + 1}: ${b.remaining_qty} left (${formatRiel(b.cost_price)}/bag)\n`;
          });
        }
      });

      const botToken = TELEGRAM_CONFIG.botToken || process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
      const masterChatId = TELEGRAM_CONFIG.chatId || process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;

      // 🚦 ROUTE TO FINANCIAL REPORT TOPICS (2 or 3)
      const targetThreadId = (TELEGRAM_CONFIG as any).reportTopics?.[activeBranchId];

      if (!botToken || !masterChatId) throw new Error('Telegram chat ID or bot token missing');

      const payload: any = {
        chat_id: masterChatId,
        text: msg,
        parse_mode: 'Markdown'
      };

      if (targetThreadId) {
        payload.message_thread_id = targetThreadId;
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if(!res.ok) throw new Error('Telegram API error');
      showToast('success', 'Report Sent', 'Inventory report dispatched to Telegram.');
    } catch (err: any) {
      showToast('error', 'Report Failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenAddProduct = () => {
    setNewItem({
      name: '',
      price: '' as any, 
      cost_price: '' as any, 
      // 🔥 UI FIX: Make weight blank for Wholesale so you are forced to type 10, 25, or 50!
      weight: activeView === 'retail' ? 1 : '' as any,
      stock: '' as any, 
      min_stock_level: 10 as any
    });
    setIsAddModalOpen(true);
  };

  // 🔥 CLOSURE FIX: Wrap in useCallback so useFocusRefresh safely binds to the active branch
  const loadAllData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    await Promise.all([
      fetchProducts(),
      fetchSettings(),
      fetchSuppliers(),
      fetchImports(),
      fetchBatches()
    ]);
    if (!isSilent) setIsLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId]);

  useFocusRefresh(() => loadAllData(true));

  useEffect(() => { 
    // 💣 SECURITY WIPE: Destroy all active edits, selections, import forms, 
    // and modals when switching branches to prevent Cross-Tenant Data Corruption!
    setEdits({});
    setSelectedToDelete(new Set());
    setSelectedSuppliersToDelete(new Set());
    setEditingCell(null);
    setHoveredId(null);
    setActiveDropdownId(null);
    setDropdownSearch('');
    setIsSupplierDropdownOpen(false);
    setIsProductDropdownOpen(false);
    setSupplierSearch('');
    setProductSearch('');
    setImportForm({ supplier_id: '', product_id: '', qty: '0', unit_cost: '0', paid_amount: '0', payment_method: 'Cash ៛' });
    setIsAddSupplierOpen(false);
    setNewSupplier({ name: '', phone: '', location: '' });
    setPayPendingModal({isOpen: false, record: null, totalDue: 0});
    setPendingPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '' }]);
    setRepackModal({ isOpen: false, product: null });
    setIsAddModalOpen(false);
    setNewItem({ name: '', price: 0 as any, cost_price: 0 as any, weight: 50 as any, stock: 0 as any, min_stock_level: 10 as any });
    setMobileEditProduct(null);
    setMobilePendingAction(null);
    setMobileSupplierDetails(null);
    setHistoryModal({ isOpen: false, product: null, data: [], activeBatches: [] });
    setEditingHistoryId(null);
    setHistoryEdits({});

    loadAllData(false);

    // 🛡️ INTEGRATION FIX: Listen to POS sales in real-time so the Inventory screen is never stale
    // 🔥 UNIQUE CHANNELS: Append activeBranchId so websocket doesn't choke during branch switch
    const invProductsChannel = supabase.channel(`inv-products-update-${activeBranchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchProducts())
      .subscribe();

    const invBatchesChannel = supabase.channel(`inv-batches-update-${activeBranchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_batches' }, () => fetchBatches())
      .subscribe();

    return () => {
      supabase.removeChannel(invProductsChannel);
      supabase.removeChannel(invBatchesChannel);
    }
  }, [activeBranchId, loadAllData]) // 🔥 CRITICAL: RE-RUNS ON BRANCH SWITCH

  const handleManualPull = async (retailId: number, wholesaleId: number) => {
    const wholesaleProduct = products.find(p => p.id === wholesaleId);
    if (!wholesaleProduct) {
      showToast('error', 'Action Blocked', 'Cannot pull: Wholesale bag not found!');
      return;
    }
    // 🔥 OVERSELL FIX: Removed the "stock < 1" check! 
    // You can now safely pull bags to restock retail even if wholesale stock goes negative.

    setIsProcessing(true);
    try {
      const { error } = await supabase.rpc('pull_wholesale_bags', {
         p_retail_id: retailId,
         p_wholesale_id: wholesaleId,
         p_bags_needed: 1,
         p_branch_id: activeBranchId // 🔒 SECURITY FIX: Stamped RPC
      });

      if (error) throw new Error(error.message);
      showToast('success', 'Bags Pulled', 'Wholesale stock converted to retail successfully.');

      const newWholesaleStock = Number(wholesaleProduct.stock) - 1;
      triggerStockAlert(wholesaleProduct.name || 'Unknown', newWholesaleStock, Number(wholesaleProduct.min_stock_level) || 0);

      await fetchProducts();
      await fetchBatches();
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  const handleConfirmRepack = async () => {
    if (!repackModal.product || !repackModal.product.linked_wholesale_id) return;
    setIsProcessing(true);
    
    try {
        const retailId = repackModal.product.id;
        const wholesaleId = repackModal.product.linked_wholesale_id;
        
        const { data: freshWholesale, error: fetchErr } = await supabase
           .from('products')
           .select('cost_price')
           .eq('id', wholesaleId)
           .single();
           
        if (fetchErr || !freshWholesale) throw new Error("Linked wholesale product not found.");

        const { error } = await supabase.rpc('execute_repack', {
            p_retail_id: retailId,
            p_wholesale_id: wholesaleId,
            p_cogs: Number(freshWholesale.cost_price) || 0,
            p_branch_id: activeBranchId // 🔒 SECURITY FIX: Stamped RPC
        });

        if (error) throw new Error(error.message);

        setEdits(prev => {
            const next = { ...prev };
            delete next[retailId];
            delete next[wholesaleId];
            return next;
        });

        showToast('success', 'Repack Successful', 'Converted 50kg loose rice into 1 sealed bag.');
        setRepackModal({ isOpen: false, product: null });
        
        const wProd = products.find(p => p.id === wholesaleId);
        const wWeight = wProd ? Number(wProd.weight) || 50 : 50;
        const newRetailStock = Number(repackModal.product!.stock) - wWeight;
        triggerStockAlert(repackModal.product?.name || 'Unknown', newRetailStock, Number(repackModal.product?.min_stock_level) || 0);

        await fetchProducts();
        await fetchBatches();
    } catch (err: any) {
        showToast('error', 'Repack Error', err.message);
    } finally {
        setIsProcessing(false);
    }
  }

  async function fetchSettings() {
    // 🛡️ INTEGRATION FIX: Fetch branched keys so RiceControl reads the exact layouts saved by POSPage
    const branchSuffix = activeBranchId === 0 ? '' : `_${activeBranchId}`;
    const keysToFetch = [
      `column_widths${branchSuffix}`, `column_order${branchSuffix}`, `category_order${branchSuffix}`, 
      `pending_col_widths${branchSuffix}`, `pending_col_order${branchSuffix}`,
      `supplier_col_widths${branchSuffix}`, `supplier_col_order${branchSuffix}`,
      `product_sort${branchSuffix}`, `pending_sort${branchSuffix}`, `supplier_sort${branchSuffix}`
    ];
    
    // Fallback to global keys if branched keys don't exist yet
    const fallbackKeys = [
      'column_widths', 'column_order', 'category_order', 
      'pending_col_widths', 'pending_col_order', 'supplier_col_widths', 
      'supplier_col_order', 'product_sort', 'pending_sort', 'supplier_sort'
    ];

    const { data } = await supabase.from('app_settings').select('*').in('setting_key', [...keysToFetch, ...fallbackKeys]);
    
    if (data) {
      const getSetting = (key: string) => data.find((d: any) => d.setting_key === `${key}${branchSuffix}`) || data.find((d: any) => d.setting_key === key);

      const widths = getSetting('column_widths');
      const order = getSetting('column_order');
      const catOrder = getSetting('category_order');
      const pendWidths = getSetting('pending_col_widths');
      const pendOrder = getSetting('pending_col_order');
      const supWidths = getSetting('supplier_col_widths');
      const supOrder = getSetting('supplier_col_order');
      
      const prodSort = getSetting('product_sort');
      const pendSort = getSetting('pending_sort');
      const supSort = getSetting('supplier_sort');

      if (widths?.setting_value) setColumnWidths(widths.setting_value)
      if (order?.setting_value) {
        const cleanOrder = order.setting_value.filter((o: string) => o !== 'actions' && o !== 'expand');
        cleanOrder.unshift('expand');
        setColumnOrder([...cleanOrder, 'actions'] as any);
      }
      if (catOrder?.setting_value) {
        const saved = catOrder.setting_value;
        const missing = RICE_CATEGORIES.filter(c => !saved.includes(c));
        setCategoryOrder([...saved, ...missing]);
      }
      if (pendWidths?.setting_value) setPendingColWidths(pendWidths.setting_value)
      if (pendOrder?.setting_value) {
        const cleanOrder = pendOrder.setting_value.filter((o: string) => o !== 'actions');
        setPendingColOrder([...cleanOrder, 'actions']);
      }
      if (supWidths?.setting_value) setSupplierColWidths(supWidths.setting_value)
      if (supOrder?.setting_value) {
        const cleanOrder = supOrder.setting_value.filter((o: string) => o !== 'select');
        cleanOrder.unshift('select');
        setSupplierColOrder(cleanOrder);
      }

      // 🔥 Load Sort Preferences
      if (prodSort?.setting_value) setSortConfig(prodSort.setting_value);
      if (pendSort?.setting_value) setPendingSort(pendSort.setting_value);
      if (supSort?.setting_value) setSupplierSort(supSort.setting_value);
    }
  }

  async function fetchProducts() {
    // 🔥 FILTERED BY BRANCH
    const { data } = await supabase.from('products').select('*').eq('is_archived', false).eq('branch_id', activeBranchId).order('id', { ascending: true })
    if (data) setProducts(data)
  }

  async function fetchSuppliers() {
    // 🔥 FILTERED BY BRANCH
    const { data } = await supabase.from('suppliers').select('*').eq('is_archived', false).eq('branch_id', activeBranchId).order('name', { ascending: true })
    if (data) setSuppliers(data)
  }

  async function fetchImports() {
    // 🔥 FILTERED BY BRANCH
    const { data } = await supabase.from('imports').select(`*, suppliers (name), products (name)`).eq('branch_id', activeBranchId).order('created_at', { ascending: false })
    if (data) setImports(data)
  }

  async function fetchBatches() {
    // 🔥 FILTERED BY BRANCH
    const { data } = await supabase.from('inventory_batches')
      .select('*')
      .eq('branch_id', activeBranchId)
      .eq('is_hidden', false) // 🔥 HSR FIX: Allow negative stock, filter by visibility
      .order('id', { ascending: true });

    if (data) {
      const bMap: Record<number, InventoryBatch[]> = {}
      data.forEach(b => {
        if (!bMap[b.product_id]) bMap[b.product_id] = []
        bMap[b.product_id].push(b)
      })
      setActiveBatchesMap(bMap)
    }
  }

  const fetchHistory = async (product: Product) => {
    // 🔥 FILTERED BY BRANCH
    const { data: importLog } = await supabase.from('imports')
      .select(`*, suppliers(name)`)
      .eq('product_id', product.id)
      .eq('branch_id', activeBranchId)
      .order('created_at', { ascending: false });

    const { data: activeBatches } = await supabase.from('inventory_batches')
      .select('*')
      .eq('product_id', product.id)
      .eq('branch_id', activeBranchId)
      // 🔥 HSR FIX: Fetch ALL batches (hidden and visible, negative and positive)
      .order('id', { ascending: true });

    setHistoryModal({ isOpen: true, product, data: importLog || [], activeBatches: activeBatches || [] })
    setEditingHistoryId(null);
    setHistoryEdits({});
    setShowHiddenBatches(false); // Reset to Active view when opening
  }

  const handleSaveHistory = async (batchId: number) => {
    const edits = historyEdits[batchId];
    if (!edits) return setEditingHistoryId(null);

    const originalBatch = historyModal.activeBatches.find(b => b.id === batchId);
    if (!originalBatch) return setEditingHistoryId(null);
    
    const targetProduct = products.find(p => String(p.id) === String(originalBatch.product_id));
      if (!targetProduct) return setEditingHistoryId(null);

    const originalQty = Number(originalBatch.remaining_qty) || 0;
    const newQty = edits.remaining_qty !== undefined ? Number(edits.remaining_qty) : originalQty;
    const qtyDifference = newQty - originalQty;

    const payload: any = {};
    if (edits.remaining_qty !== undefined) payload.remaining_qty = newQty;
    if (edits.cost_price !== undefined) payload.cost_price = Number(edits.cost_price) || 0;

    // 1. Update inventory_batches
    const { error } = await supabase.from('inventory_batches').update(payload).eq('id', batchId).eq('branch_id', activeBranchId);
    
    if (!error) {
      // 2. Adjust master product stock if quantity changed
    if (qtyDifference !== 0) {
      const newStock = Number(targetProduct.stock) + qtyDifference;
      const { error: stockErr } = await supabase.from('products')
        .update({ stock: newStock })
        .eq('id', targetProduct.id)
        .eq('branch_id', activeBranchId);
      if (stockErr) throw stockErr;
        triggerStockAlert(targetProduct.name || 'Unknown', newStock, Number(targetProduct.min_stock_level) || 0);
        
        if (historyModal.product) {
            setHistoryModal(prev => ({...prev, product: {...prev.product!, stock: newStock}}));
        }
      }
      
      // 3. 🔥 AUTO-SYNC: Also update the corresponding recent import record in the `imports` table!
      const { data: latestImport } = await supabase.from('imports')
        .select('id, qty, unit_cost')
        .eq('product_id', targetProduct.id)
        .eq('branch_id', activeBranchId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestImport) {
        const importPayload: any = {};
        if (edits.remaining_qty !== undefined) importPayload.qty = newQty;
        if (edits.cost_price !== undefined) importPayload.unit_cost = Number(edits.cost_price) || 0;
        
        const finalQty = edits.remaining_qty !== undefined ? newQty : latestImport.qty;
        const finalCost = edits.cost_price !== undefined ? Number(edits.cost_price) : latestImport.unit_cost;
        importPayload.total_cost = finalQty * finalCost;

        await supabase.from('imports').update(importPayload).eq('id', latestImport.id).eq('branch_id', activeBranchId);
      }
      
      const { data: updatedBatches } = await supabase.from('inventory_batches')
        .select('*').eq('product_id', targetProduct.id).eq('branch_id', activeBranchId).order('id', { ascending: true });
      
      const { data: updatedImports } = await supabase.from('imports')
        .select('*, suppliers(name)')
        .eq('product_id', targetProduct.id)
        .eq('branch_id', activeBranchId)
        .order('created_at', { ascending: false });

      setHistoryModal(prev => ({...prev, activeBatches: updatedBatches || [], data: updatedImports || []}));
      setEditingHistoryId(null);
      showToast('success', 'Batch & Import Updated', 'Shelf stock and permanent import record synced successfully.');
      fetchProducts();
      fetchImports();
    } else {
      showToast('error', 'Update Failed', error.message);
    }
  }

  const handleDeleteHistory = async (batchId: number) => {
    const originalBatch = historyModal.activeBatches.find(b => b.id === batchId);
    if (!originalBatch) return;
    
    // 1. Fixed string mismatch here
    const targetProduct = products.find(p => String(p.id) === String(originalBatch.product_id));
    if (!targetProduct) return;

    if (!confirm("Are you sure you want to delete this active batch? The remaining quantity will be deducted from your master stock.")) return;
    
    const qtyToReverse = Number(originalBatch.remaining_qty) || 0;

    // 🔒 SECURITY FIX: Enforce branch isolation on batch deletion
    const { error } = await supabase.from('inventory_batches').delete().eq('id', batchId).eq('branch_id', activeBranchId);
    
    if (!error) {
      if (qtyToReverse > 0) {
        // 2. Merged into a single newStock declaration
        const newStock = Number(targetProduct.stock) - Math.abs(qtyToReverse);
        
        const { error: stockErr } = await supabase.from('products')
          .update({ stock: newStock })
          .eq('id', targetProduct.id)
          .eq('branch_id', activeBranchId);
        
        if (stockErr) throw stockErr;
        
        triggerStockAlert(targetProduct.name || 'Unknown', newStock, Number(targetProduct.min_stock_level) || 0);
        
        if (historyModal.product) {
            setHistoryModal(prev => ({...prev, product: {...prev.product!, stock: newStock}}));
        }
      }
      
      const { data: updatedBatches } = await supabase.from('inventory_batches')
        .select('*').eq('product_id', targetProduct.id).eq('branch_id', activeBranchId).gt('remaining_qty', 0).order('id', { ascending: true });
      
      setHistoryModal(prev => ({...prev, activeBatches: updatedBatches || []}));
      showToast('success', 'Batch Deleted', 'Remaining stock deducted safely.');
      fetchProducts();
      
    } else {
      showToast('error', 'Delete Failed', error.message);
    }
  }

  // 🔥 HSR FIX: Manual Hide/Unhide Function
  const handleToggleBatchVisibility = async (batchId: number, currentStatus: boolean) => {
    setIsProcessing(true);
    const { error } = await supabase.from('inventory_batches')
      .update({ is_hidden: !currentStatus })
      .eq('id', batchId)
      .eq('branch_id', activeBranchId);
    
    if (!error) {
      setHistoryModal(prev => ({
        ...prev,
        activeBatches: prev.activeBatches.map(b => b.id === batchId ? { ...b, is_hidden: !currentStatus } : b)
      }));
      fetchBatches(); // Sync master UI
      showToast('success', 'Batch Updated', !currentStatus ? 'Batch successfully archived.' : 'Batch successfully restored.');
    } else {
      showToast('error', 'Update Failed', error.message);
    }
    setIsProcessing(false);
  }

  const handleVoidImport = async (importId: number) => {
    if (!confirm(`🚨 Are you sure you want to VOID this import?\n\nThis will instantly:\n1. Remove the bags from stock\n2. Delete the linked batch\n3. Reverse supplier debt & expenses\n4. Permanently erase this import record`)) return;

    setIsProcessing(true);
    try {
      const { data: impData } = await supabase.from('imports').select('*').eq('id', importId).single();
      if (!impData) throw new Error("Import not found");

      const targetProduct = products.find(p => String(p.id) === String(impData.product_id));
      if (targetProduct) {
        const newStock = Number(targetProduct.stock) - Math.abs(Number(impData.qty));
        const { error: stockErr } = await supabase.from('products')
          .update({ stock: newStock })
          .eq('id', targetProduct.id)
          .eq('branch_id', activeBranchId);
        if (stockErr) throw stockErr;
      }

      const { data: batches } = await supabase.from('inventory_batches')
        .select('*')
        .eq('product_id', impData.product_id)
        .eq('cost_price', impData.unit_cost)
        .eq('remaining_qty', impData.qty)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (batches && batches.length > 0) {
        // 🔒 SECURITY FIX: Enforce branch isolation on batch deletion
        await supabase.from('inventory_batches').delete().eq('id', batches[0].id).eq('branch_id', activeBranchId);
      }

      const { data: supData } = await supabase.from('suppliers').select('name, total_owed_riel').eq('id', impData.supplier_id).single();
      const supplierName = supData?.name || 'Unknown Supplier';

      const debtAdded = Number(impData.total_cost) - Number(impData.paid_amount);
      if (debtAdded > 0) {
        if (supData) {
          // 🔒 SECURITY FIX: Enforce branch isolation on supplier update
          await supabase.from('suppliers').update({ total_owed_riel: Math.max(0, Number(supData.total_owed_riel) - debtAdded) }).eq('id', impData.supplier_id).eq('branch_id', activeBranchId);
        }
        // 🔒 SECURITY FIX: Enforce branch isolation on AP deletion
        await supabase.from('accounts_payable')
          .delete()
          .eq('supplier_name', supplierName)
          .eq('notes', `Stock Import: ${impData.qty} bags`)
          .eq('status', 'Unpaid')
          .eq('branch_id', activeBranchId);
      }

      if (Number(impData.paid_amount) > 0) {
        // 🛡️ DASHBOARD FIX: Find and delete ONLY ONE matching expense to prevent erasing the entire supplier's payment history
        const { data: exps } = await supabase.from('expenses')
          .select('id')
          .eq('remarks', `Stock Import: ${supplierName}`)
          .eq('branch_id', activeBranchId)
          .limit(1);
          
        if (exps && exps.length > 0) {
          // 🔒 SECURITY FIX: Enforce branch isolation on expense deletion
          await supabase.from('expenses').delete().eq('id', exps[0].id).eq('branch_id', activeBranchId);
        }
      }
      // 🔥 SECURITY FIX: Isolate import deletion
      await supabase.from('imports').delete().eq('id', importId).eq('branch_id', activeBranchId);

      showToast('success', 'Import Voided', 'Record and associated funds safely reversed.');
      setHistoryModal({ isOpen: false, product: null, data: [], activeBatches: [] });
      fetchProducts();
      fetchSuppliers();
      fetchBatches();
      fetchImports();

    } catch (err: any) {
      showToast('error', 'Error Voiding Import', err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleAddSupplier() {
    if (!newSupplier.name) return showToast('error', 'Validation Error', 'Supplier name is required');
    setIsProcessing(true);
    try {
      // 🔥 STAMP BRANCH ID
      const { data, error } = await supabase.from('suppliers').insert([{ 
        name: newSupplier.name, 
        phone: newSupplier.phone, 
        location: newSupplier.location,
        branch_id: activeBranchId 
      }]).select();
      
      if (error) throw error;
      
      setIsAddSupplierOpen(false);
      setNewSupplier({ name: '', phone: '', location: '' });

      if (data && data.length > 0) {
        setSuppliers(prev => [...prev, data[0]]);
        setImportForm(prev => ({ ...prev, supplier_id: String(data[0].id) }));
        setActiveView('import');
        showToast('success', 'Supplier Added', `${data[0].name} has been added successfully.`);
      }

    } catch (err: any) {
      showToast('error', 'Database Error', err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleProcessImport(isPayLater: boolean) {
    if (isImportingRef.current) return;

    // 🔥 HSR FIX: 0-Qty Import Unlock. Strictly check for empty strings instead of falsy values.
    if (!importForm.supplier_id || !importForm.product_id || importForm.qty === '' || importForm.unit_cost === '') {
      return showToast('error', 'Missing Data', 'Please fill in Supplier, Product, Qty, and Cost.');
    }

    isImportingRef.current = true;
    setIsProcessing(true);

    const qty = Number(importForm.qty);
    const unitCost = Number(importForm.unit_cost);
    const totalCost = qty * unitCost;
    const paidAmount = isPayLater ? (Number(importForm.paid_amount) || 0) : totalCost;
    
    if (paidAmount > totalCost) {
      isImportingRef.current = false;
      setIsProcessing(false);
      return showToast('error', 'Invalid Amount', 'Cannot pay more than the total cost.');
    }

    try {
      const supplierName = suppliers.find(s => String(s.id) === String(importForm.supplier_id))?.name || 'Unknown Supplier';
      const product = products.find(p => String(p.id) === String(importForm.product_id));
      if (!product) throw new Error("Product ID mismatch");

      let amtUsd = 0, amtRiel = paidAmount;
      if (importForm.payment_method.includes('$')) { amtUsd = paidAmount; amtRiel = paidAmount * EXCHANGE_RATE; }

      const payload = {
        branch_id: activeBranchId,
        supplier_id: Number(importForm.supplier_id),
        supplier_name: supplierName,
        product_id: Number(importForm.product_id),
        product_name: product.name,
        qty: qty,
        unit_cost: unitCost,
        total_cost: totalCost,
        paid_amount: paidAmount,
        payment_method: importForm.payment_method,
        status: paidAmount >= totalCost ? 'Paid' : 'Pending',
        amt_usd: amtUsd,
        amt_riel: amtRiel
      };

      const { error: rpcError } = await supabase.rpc('process_stock_import', { p_payload: payload });
      if (rpcError) throw rpcError;

      setImportForm({ supplier_id: '', product_id: '', qty: '0', unit_cost: '0', paid_amount: '0', payment_method: 'Cash ៛' });
      showToast('success', 'Stock Received', `${qty} bags added to inventory. Batch logged.`);
      
      if (isPayLater) setActiveView('pending');
      else setActiveView('wholesale');

      fetchProducts();
      fetchBatches();
      fetchSuppliers();
      fetchImports();

    } catch (err: any) {
      showToast('error', 'Import Error', err.message);
    } finally {
      isImportingRef.current = false;
      setIsProcessing(false);
    }
  }

  async function handlePayPendingSubmit() {
    if (isPayingRef.current) return;

    const record = payPendingModal.record;
    
    let totalRielEq = 0;
    let totalUsdFace = 0;
    let totalRielFace = 0;
    let methodStrings: string[] = [];

    for (const r of pendingPaymentRows) {
      const cleanAmount = String(r.amount).replace(/,/g, '');
      const amt = Math.abs(Number(cleanAmount) || 0);
      if (amt <= 0) continue;
      
      if (r.method.includes('$')) {
        totalRielEq += Math.round(amt * EXCHANGE_RATE);
        totalUsdFace += amt;
      } else {
        totalRielEq += Math.round(amt);
        totalRielFace += amt;
      }
      methodStrings.push(`${r.method}: ${amt}`);
    }

    if (totalRielEq <= 0) return showToast('error', 'Invalid Amount', 'Enter a valid payment amount.');
    const remainingBefore = Number(record.total_cost) - Number(record.paid_amount);
    if (totalRielEq > remainingBefore + 0.1) return showToast('error', 'Overpayment', 'Cannot pay more than what is owed.');

    isPayingRef.current = true;
    setIsProcessing(true); 

    try {
      const newPaidAmount = Number(record.paid_amount) + totalRielEq;
      const newStatus = newPaidAmount >= Number(record.total_cost) ? 'Paid' : 'Pending';
      const supplier = suppliers.find(s => String(s.id) === String(record.supplier_id));

      const payload = {
        branch_id: activeBranchId,
        import_id: record.id,
        supplier_id: supplier?.id,
        supplier_name: supplier?.name,
        total_riel_eq: totalRielEq,
        new_paid_amount: newPaidAmount,
        new_status: newStatus,
        total_usd_face: totalUsdFace,
        total_riel_face: totalRielFace,
        method_strings: methodStrings.join(', ')
      };

      const { error: rpcError } = await supabase.rpc('process_pending_payment', { p_payload: payload });
      if (rpcError) throw rpcError;

      setPayPendingModal({ isOpen: false, record: null, totalDue: 0 });
      setPendingPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '' }]);
      
      if (newStatus === 'Paid') {
        showToast('success', 'Bill Cleared', 'The supplier debt has been fully settled.');
      } else {
        showToast('info', 'Partial Payment', `Payment logged. ${formatRiel(remainingBefore - totalRielEq)} remaining.`);
      }

      fetchImports();
      fetchSuppliers();
      
    } catch (err: any) {
      showToast('error', 'Payment Error', err.message);
    } finally {
      isPayingRef.current = false;
      setIsProcessing(false);
    }
  }

  // 🔥 NEW: CORE ENGINE FOR EDITING PENDING IMPORTS
  const handleEditImportSubmit = async () => {
    if (!editImportModal.record) return;
    setIsProcessing(true);
    try {
      const impData = editImportModal.record;
      const oldQty = Number(impData.qty);
      const oldUnitCost = Number(impData.unit_cost);
      const oldTotalCost = Number(impData.total_cost);
      
      const newQty = Number(String(editImportForm.qty).replace(/,/g, ''));
      const newUnitCost = Number(String(editImportForm.unit_cost).replace(/,/g, ''));
      const newTotalCost = newQty * newUnitCost;
      
      const qtyDiff = newQty - oldQty;
      const costDiff = newTotalCost - oldTotalCost;

      // 1. UPDATE IMPORT TABLE
      const { error: impError } = await supabase.from('imports')
        .update({ 
           qty: newQty, 
           unit_cost: newUnitCost, 
           total_cost: newTotalCost,
           status: Number(impData.paid_amount) >= newTotalCost ? 'Paid' : 'Pending'
        })
        .eq('id', impData.id).eq('branch_id', activeBranchId);
      if (impError) throw impError;

      // 2. FIND AND UPDATE THE INVENTORY BATCH
      const { data: batches } = await supabase.from('inventory_batches')
        .select('*')
        .eq('product_id', impData.product_id)
        .eq('cost_price', oldUnitCost)
        .eq('branch_id', activeBranchId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (batches && batches.length > 0) {
        const newRemaining = Math.max(0, Number(batches[0].remaining_qty) + qtyDiff);
        await supabase.from('inventory_batches')
          .update({ remaining_qty: newRemaining, cost_price: newUnitCost })
          .eq('id', batches[0].id).eq('branch_id', activeBranchId);
      }

      // 3. ADJUST PRODUCT MASTER STOCK
      const targetProduct = products.find(p => String(p.id) === String(impData.product_id));
      if (targetProduct && qtyDiff !== 0) {
        const newStock = Number(targetProduct.stock) + qtyDiff;
        const { error: stockErr } = await supabase.from('products')
          .update({ stock: newStock })
          .eq('id', targetProduct.id)
          .eq('branch_id', activeBranchId);
        if (stockErr) throw stockErr;
      }

      // 4. ADJUST SUPPLIER DEBT & ACCOUNTS PAYABLE
      if (costDiff !== 0 && impData.supplier_id) {
        const { data: supData } = await supabase.from('suppliers')
          .select('total_owed_riel').eq('id', impData.supplier_id).single();
          
        if (supData) {
          await supabase.from('suppliers')
            .update({ total_owed_riel: Math.max(0, Number(supData.total_owed_riel) + costDiff) })
            .eq('id', impData.supplier_id).eq('branch_id', activeBranchId);
        }
        
        // Sync Accounts Payable if Unpaid
        await supabase.from('accounts_payable')
          .update({ amount_riel: newTotalCost, notes: `Stock Import: ${newQty} bags` })
          .eq('supplier_name', impData.suppliers?.name || '')
          .eq('notes', `Stock Import: ${oldQty} bags`)
          .eq('status', 'Unpaid')
          .eq('branch_id', activeBranchId);
      }

      showToast('success', 'Import Updated', 'Stock, batch, and financials synced successfully.');
      setEditImportModal({ isOpen: false, record: null });
      fetchProducts();
      fetchBatches();
      fetchImports();
      fetchSuppliers();
    } catch (err: any) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveRecord = async (id: number) => {
    if (!edits[id]) return;
    const payload = { ...edits[id] } as any;
    
    const mainProd = products.find(p => p.id === id);
    if (!mainProd) return;

    if (activeView === 'wholesale') {
      const pBatches = activeBatchesMap[id] || [];
      pBatches.sort((a,b) => a.id - b.id);
      const currentBatch = pBatches.length > 0 ? pBatches[0] : null;

      if (currentBatch) {
        const batchPayload: any = {};
        let updateBatch = false;

        if (payload.cost_price !== undefined) { 
           batchPayload.cost_price = Number(payload.cost_price); 
           updateBatch = true; 
        }

        if (payload.stock !== undefined) {
           const newMasterStock = Number(payload.stock);
           const oldMasterStock = Number(mainProd.stock);
           const diff = newMasterStock - oldMasterStock;
           
           batchPayload.remaining_qty = Math.max(0, Number(currentBatch.remaining_qty) + diff);
           updateBatch = true;
           
           payload.stock = newMasterStock;
        }

        if (updateBatch) {
           // 🔒 SECURITY FIX: Enforce branch isolation on batch update
           await supabase.from('inventory_batches').update(batchPayload).eq('id', currentBatch.id).eq('branch_id', activeBranchId);
        }
      }
    }

    ['price', 'cost_price', 'weight', 'stock', 'mtd_kg_used', 'mtd_bags_used', 'min_stock_level'].forEach(key => {
      if (payload[key] === '') payload[key] = 0;
      else if (payload[key] !== undefined) payload[key] = Number(payload[key]);
    });

    if (Object.keys(payload).length > 0) {
       // 🔥 SECURITY FIX: Lock product modifications to the active branch
       const { error } = await supabase.from('products').update(payload).eq('id', id).eq('branch_id', activeBranchId);
       if (error) {
         showToast('error', 'Save Failed', error.message);
       } else {
         fetchProducts();
         if (payload.stock !== undefined) {
           triggerStockAlert(mainProd.name || 'Unknown', Number(payload.stock), Number(mainProd.min_stock_level) || 0);
         }
       }
    }

    setEdits(prev => { const n = { ...prev }; delete n[id]; return n });
    setEditingCell(null);
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedToDelete.size} item(s)?`)) return
    // 🔥 SECURITY FIX: Lock product mass-archiving to the active branch
    const { error } = await supabase.from('products').update({ is_archived: true }).in('id', Array.from(selectedToDelete)).eq('branch_id', activeBranchId)
    if (!error) { 
      setSelectedToDelete(new Set()); 
      fetchProducts(); 
      showToast('success', 'Products Deleted', 'Items removed safely.');
    }
  }

  const handleDeleteSuppliers = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedSuppliersToDelete.size} supplier(s)?`)) return
    // 🔥 SECURITY FIX: Lock supplier mass-archiving to the active branch
    const { error } = await supabase.from('suppliers').update({ is_archived: true }).in('id', Array.from(selectedSuppliersToDelete)).eq('branch_id', activeBranchId)
    if (!error) {
      setSelectedSuppliersToDelete(new Set()); 
      fetchSuppliers(); 
      showToast('success', 'Suppliers Deleted', 'Suppliers archived safely.');
    }
  }

// 🔥 SMART TYPIST: Auto-extracts weight from product name!
  const handleProductNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    let newWeight = newItem.weight;
    
    // Only auto-adjust if we are making a Wholesale/Import bag
    if (activeView !== 'retail') {
      const kgMatch = newName.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (kgMatch) {
        newWeight = Number(kgMatch[1]);
      } else {
        newWeight = '' as any; // Default back to blank if no "kg" is found
      }
    }
    
    setNewItem({ ...newItem, name: newName, weight: newWeight });
  };

  const addProduct = async () => {
    if (!newItem.name) return showToast('error', 'Missing Data', 'Name is required');

    // 🔥 AUTO-APPEND SUPPLIER NAME WITH A SPACE (NO HYPHEN)
    let finalProductName = newItem.name.trim();
    if (activeView === 'import' && importForm.supplier_id) {
       const sup = suppliers.find(s => String(s.id) === String(importForm.supplier_id));
       if (sup && !finalProductName.includes(sup.name)) {
           finalProductName = `${finalProductName} ${sup.name}`; // 🔥 FIX: Just a space!
       }
    }

    // ✅ FIX: Prevent Duplicate Product Names using the final merged name
    const isDuplicate = products.some(p => p.name.toLowerCase().trim() === finalProductName.toLowerCase().trim());
    if (isDuplicate) {
      return showToast('error', 'Duplicate Name', `A product named "${finalProductName}" already exists!`);
    }

    setIsProcessing(true);
    try {
      const payload = {
        name: finalProductName, // 🔥 Passes the merged auto-name to the database
        price: Number(newItem.price) || 0,
        cost_price: Number(newItem.cost_price) || 0,
        weight: Number(newItem.weight) || 50,
        stock: Number(newItem.stock) || 0,
        min_stock_level: Number(newItem.min_stock_level) || 10,
        mtd_kg_used: 0,
        mtd_bags_used: 0,
        branch_id: activeBranchId // 🔥 STAMPED
      }
      const { data, error } = await supabase.from('products').insert([payload]).select()
      
      if (error) throw error;

      if (data && data.length > 0) {
        setIsAddModalOpen(false)
        setNewItem({ name: '', price: '0' as any, cost_price: '0' as any, weight: 50 as any, stock: '0' as any, min_stock_level: 10 as any })
        
        setProducts(prev => [...prev, data[0]]);
        
        // 🔥 FIX: Do NOT jump to the Import tab if we are adding a Retail product
        if (activeView !== 'retail') {
          setImportForm(prev => ({ ...prev, product_id: String(data[0].id) }));
          setActiveView('import');
          showToast('success', 'Product Created', 'Ready to receive stock.');
        } else {
          showToast('success', 'Product Created', 'Retail product added successfully.');
        }
      }
    } catch (err: any) {
      showToast('error', 'Creation Failed', err.message);
    } finally {
      // 🔥 ARCHITECTURE FIX: Unlocks the button no matter what happens!
      setIsProcessing(false);
    }
  }

  const openImportModal = (product: Product) => {
    setImportForm(prev => ({ ...prev, product_id: String(product.id) }));
    setActiveView('import');
  }

  const handleLinkWholesaleBag = async (retailId: number, wholesaleProduct: Product | null) => {
    // 🔒 SECURITY FIX: Enforce branch isolation on product updates
    const { error } = await supabase.from('products').update({ 
      linked_wholesale_id: wholesaleProduct ? wholesaleProduct.id : null,
    }).eq('id', retailId).eq('branch_id', activeBranchId);
    
    if (!error) {
      setActiveDropdownId(null);
      setDropdownSearch('');
      fetchProducts();
    } else {
      showToast('error', 'Link Failed', error.message);
    }
  }

  // --- UNIVERSAL DRAG & DROP FOR ALL TABLES ---
  const onDragStartCol = (e: React.DragEvent, col: string, unmovables: string[]) => {
    if (unmovables.includes(col)) return;
    e.dataTransfer.setData('text/plain', col);
    e.dataTransfer.effectAllowed = 'move';
  }

  const onDragOverCol = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  const handleProductDrop = async (e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    if (targetCol === 'actions' || targetCol === 'expand') return;
    const sourceCol = e.dataTransfer.getData('text/plain') as ColumnKey;
    if (!sourceCol || sourceCol === targetCol || sourceCol === 'actions' || sourceCol === 'expand') return

    setColumnOrder(prev => {
      const staticCols = ['expand', 'actions'];
      const movableOrder = prev.filter(c => !staticCols.includes(c as string));
      const newOrder = movableOrder.filter(c => c !== sourceCol);
      const targetIdx = newOrder.indexOf(targetCol as any);
      
      newOrder.splice(targetIdx, 0, sourceCol);
      const finalOrder = ['expand', ...newOrder, 'actions'] as ColumnKey[];
      
      // 🔥 SECURITY FIX: Isolates UI layout updates to the active branch to prevent cross-tenant overrides
      const branchKey = activeBranchId === 0 ? 'column_order' : `column_order_${activeBranchId}`;
      supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: finalOrder }, { onConflict: 'setting_key' }).then();
      return finalOrder;
    })
  }

  const handlePendingDrop = async (e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    if (targetCol === 'actions') return;
    const sourceCol = e.dataTransfer.getData('text/plain');
    if (!sourceCol || sourceCol === targetCol || sourceCol === 'actions') return;

    setPendingColOrder(prev => {
      const movableOrder = prev.filter(c => c !== 'actions');
      const newOrder = movableOrder.filter(c => c !== sourceCol);
      const targetIdx = newOrder.indexOf(targetCol);
      
      newOrder.splice(targetIdx, 0, sourceCol);
      const finalOrder = [...newOrder, 'actions'];
      
      supabase.from('app_settings').upsert({ setting_key: 'pending_col_order', setting_value: finalOrder }, { onConflict: 'setting_key' }).then();
      return finalOrder;
    })
  }

  const handleSupplierDrop = async (e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    if (targetCol === 'select') return;
    const sourceCol = e.dataTransfer.getData('text/plain');
    if (!sourceCol || sourceCol === targetCol || sourceCol === 'select') return;

    setSupplierColOrder(prev => {
      const movableOrder = prev.filter(c => c !== 'select');
      const newOrder = movableOrder.filter(c => c !== sourceCol);
      const targetIdx = newOrder.indexOf(targetCol);
      
      newOrder.splice(targetIdx, 0, sourceCol);
      const finalOrder = ['select', ...newOrder];
      
      supabase.from('app_settings').upsert({ setting_key: 'supplier_col_order', setting_value: finalOrder }, { onConflict: 'setting_key' }).then();
      return finalOrder;
    })
  }

  const handleResizeStartProduct = (e: React.MouseEvent | React.TouchEvent, columnKey: string) => {
    if (columnKey === 'expand') return;
    e.preventDefault(); e.stopPropagation();
    const startX = 'touches' in e ? e.touches[0].pageX : e.pageX;
    const startWidth = widthsRef.current[columnKey] || 150;
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0].pageX : moveEvent.pageX;
      const newWidth = Math.max(40, startWidth + (currentX - startX));
      setColumnWidths(prev => ({ ...prev, [columnKey]: newWidth }));
    }
    const handleUp = async () => {
      document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove); document.removeEventListener('touchend', handleUp);
      await supabase.from('app_settings').upsert({ setting_key: 'column_widths', setting_value: widthsRef.current }, { onConflict: 'setting_key' });
    }
    document.addEventListener('mousemove', handleMove); document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false }); document.addEventListener('touchend', handleUp);
  }

  const handleResizeStartPending = (e: React.MouseEvent | React.TouchEvent, columnKey: string) => {
    if (columnKey === 'actions') return;
    e.preventDefault(); e.stopPropagation();
    const startX = 'touches' in e ? e.touches[0].pageX : e.pageX;
    const startWidth = pendingWidthsRef.current[columnKey] || 150;
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0].pageX : moveEvent.pageX;
      const newWidth = Math.max(40, startWidth + (currentX - startX));
      setPendingColWidths(prev => ({ ...prev, [columnKey]: newWidth }));
    }
    const handleUp = async () => {
      document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove); document.removeEventListener('touchend', handleUp);
      await supabase.from('app_settings').upsert({ setting_key: 'pending_col_widths', setting_value: pendingWidthsRef.current }, { onConflict: 'setting_key' });
    }
    document.addEventListener('mousemove', handleMove); document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false }); document.addEventListener('touchend', handleUp);
  }

  const handleResizeStartSupplier = (e: React.MouseEvent | React.TouchEvent, columnKey: string) => {
    if (columnKey === 'select') return;
    e.preventDefault(); e.stopPropagation();
    const startX = 'touches' in e ? e.touches[0].pageX : e.pageX;
    const startWidth = supplierWidthsRef.current[columnKey] || 150;
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0].pageX : moveEvent.pageX;
      const newWidth = Math.max(40, startWidth + (currentX - startX));
      setSupplierColWidths(prev => ({ ...prev, [columnKey]: newWidth }));
    }
    const handleUp = async () => {
      document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove); document.removeEventListener('touchend', handleUp);
      await supabase.from('app_settings').upsert({ setting_key: 'supplier_col_widths', setting_value: supplierWidthsRef.current }, { onConflict: 'setting_key' });
    }
    document.addEventListener('mousemove', handleMove); document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false }); document.addEventListener('touchend', handleUp);
  }

  const handleProductSort = (key: any) => {
    if (key === 'linked_wholesale' || key === 'actions' || key === 'expand') return;
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    const newSort = { key, direction };
    setSortConfig(newSort);
    // 🔥 Save preference to DB
    supabase.from('app_settings').upsert({ setting_key: 'product_sort', setting_value: newSort }, { onConflict: 'setting_key' }).then();
  }

  const handlePendingSort = (key: string) => {
    if (key === 'actions') return;
    let direction: 'asc' | 'desc' = 'asc';
    if (pendingSort && pendingSort.key === key && pendingSort.direction === 'asc') direction = 'desc';
    const newSort = { key, direction };
    setPendingSort(newSort);
    // 🔥 Save preference to DB
    supabase.from('app_settings').upsert({ setting_key: 'pending_sort', setting_value: newSort }, { onConflict: 'setting_key' }).then();
  }

  const handleSupplierSort = (key: string) => {
    if (key === 'select') return;
    let direction: 'asc' | 'desc' = 'asc';
    if (supplierSort && supplierSort.key === key && supplierSort.direction === 'asc') direction = 'desc';
    const newSort = { key, direction };
    setSupplierSort(newSort);
    // 🔥 Save preference to DB
    supabase.from('app_settings').upsert({ setting_key: 'supplier_sort', setting_value: newSort }, { onConflict: 'setting_key' }).then();
  }

  const processedProducts = products
    .filter(p => {
      const isEditingThisRow = editingCell?.id === p.id;
      if (debouncedSearch && !p.name?.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      // 🔥 ARCHITECTURE FIX: 1kg is Retail (Loose). Anything heavier is Wholesale (Sealed Bag).
      if (activeView === 'retail' && Number(p.weight) > 1) return false; 
      if (activeView === 'wholesale' && Number(p.weight) <= 1) return false;
      if (activeView === 'wholesale') {
        if (activeCategory === '❌ Out of Stock') {
            if (!isEditingThisRow && Number(p.stock) > 0) return false;
        } else {
            // 🔥 OVERSELL FIX: We commented out the line below so 0 or negative stock stays visible!
            // if (!isEditingThisRow && Number(p.stock) <= 0) return false;
        }
      }
      if (activeView === 'wholesale' && activeCategory !== 'All' && activeCategory !== '❌ Out of Stock') {
        const name = p.name || '';
        if (activeCategory === 'ផ្សេងៗ') {
          if (MAIN_KEYWORDS.some(kw => name.includes(kw))) return false;
        } else {
          if (!name.includes(activeCategory)) return false;
        }
      }
      for (const rule of filterRules) {
        if (!rule.value && rule.value !== 0) continue;
        const val = p[rule.column as keyof Product];
        const checkVal = String(rule.value).toLowerCase();
        if (rule.operator === 'contains' && !String(val).toLowerCase().includes(checkVal)) return false;
        if (rule.operator === 'equals' && String(val).toLowerCase() !== checkVal) return false;
        if (rule.operator === 'gt' && Number(val) <= Number(rule.value)) return false;
        if (rule.operator === 'lt' && Number(val) >= Number(rule.value)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // 1. Top Sales Tab (Retail)
      if (activeView === 'retail' && retailTab === 'Top') {
         return (Number(b.mtd_kg_used) || 0) - (Number(a.mtd_kg_used) || 0);
      }
      
      // 2. User clicked a specific column header to sort
      if (sortConfig && sortConfig.key !== 'id') {
          const { key, direction } = sortConfig;
          if ((a as any)[key] < (b as any)[key]) return direction === 'asc' ? -1 : 1;
          if ((a as any)[key] > (b as any)[key]) return direction === 'asc' ? 1 : -1;
          return 0;
      }

      // 3. 🚦 DEFAULT AUTO-SORT: Call your central Master Sort Engine!
      const priceKeyToCompare = activeView === 'retail' ? 'price' : 'cost_price';
      
      // Grab the dynamic wholesale COGS if applicable
      const aCompare = { ...a };
      const bCompare = { ...b };
      if (activeView === 'wholesale') {
        const aBatches = activeBatchesMap[a.id] || [];
        aBatches.sort((x,y) => x.id - y.id);
        aCompare.cost_price = Number(aBatches[0]?.cost_price || a.cost_price || 0);

        const bBatches = activeBatchesMap[b.id] || [];
        bBatches.sort((x,y) => x.id - y.id);
        bCompare.cost_price = Number(bBatches[0]?.cost_price || b.cost_price || 0);
      }
      
      return riceCategoryComparator(aCompare, bCompare, priceKeyToCompare);
    })
    // 🔥 FREEZE ROWS WHILE TYPING: We run .map LAST so live inputs don't trigger sorting!
    .map(p => ({ ...p, ...edits[p.id] }));

  const processedPending = imports.filter(i => i.status === 'Pending').sort((a, b) => {
    // 🔥 OVERRIDE: Ignore stubborn 'id' saves, respect intentional desktop clicks
    if (pendingSort && pendingSort.key !== 'id') {
        const { key, direction } = pendingSort;
        let valA, valB;
        if (key === 'date') { valA = new Date((a as any).created_at).getTime(); valB = new Date((b as any).created_at).getTime(); }
        else if (key === 'supplier') { valA = a.suppliers?.name || ''; valB = b.suppliers?.name || ''; }
        else if (key === 'product') { valA = a.products?.name || ''; valB = b.products?.name || ''; }
        else if (key === 'total_cost') { valA = Number(a.total_cost); valB = Number(b.total_cost); }
        else if (key === 'paid_so_far') { valA = Number(a.paid_amount); valB = Number(b.paid_amount); }
        else if (key === 'remaining_debt') { valA = Number(a.total_cost) - Number(a.paid_amount); valB = Number(b.total_cost) - Number(b.paid_amount); }
        
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    }
    
    // Auto-Sort Default: Latest Date First
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const processedSuppliers = [...suppliers]
    .filter(s => debouncedSearch ? s.name.toLowerCase().includes(debouncedSearch.toLowerCase()) : true)
    .sort((a, b) => {
    // 🔥 OVERRIDE: Ignore stubborn 'id' saves
    if (supplierSort && supplierSort.key !== 'id') {
       const { key, direction } = supplierSort;
       let valA = a[key] || '';
       let valB = b[key] || '';
       if (key === 'total_owed') { valA = Number(a.total_owed_riel); valB = Number(b.total_owed_riel); }
       if (valA < valB) return direction === 'asc' ? -1 : 1;
       if (valA > valB) return direction === 'asc' ? 1 : -1;
       return 0;
    }
    
    // Auto-Sort Default: Highest Debt First
    return (Number(b.total_owed_riel) || 0) - (Number(a.total_owed_riel) || 0);
  });

  const formatDisplayValue = (col: string, val: any) => {
    if (val === null || val === undefined) return '';
    if (['price', 'cost_price'].includes(col)) return `${new Intl.NumberFormat('en-US').format(val)} ៛`;
    if (['stock', 'weight', 'id', 'min_stock_level'].includes(col)) return new Intl.NumberFormat('en-US').format(val);
    if (['mtd_kg_used'].includes(col)) return `${new Intl.NumberFormat('en-US').format(val)} kg`;
    if (['mtd_bags_used'].includes(col)) return `${new Intl.NumberFormat('en-US').format(val)} bags`;
    return String(val);
  };

  const importTotalCalc = (Number(importForm.qty) || 0) * (Number(importForm.unit_cost) || 0);
  const liveTotalPendingReceived = pendingPaymentRows.reduce((sum, row) => {
    const amt = Number(row.amount) || 0;
    if (row.method.includes('$')) return sum + (amt * EXCHANGE_RATE);
    return sum + amt;
  }, 0);
  const livePendingRemaining = payPendingModal.totalDue - liveTotalPendingReceived;

  return (
    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      
      {/* HEADER (Frozen) */}
      <div className="header-container" style={{ flexShrink: 0 }}>
        <div className="header-left">
          <h1 className="saas-page-title">🌾 Inventory & Suppliers</h1>
        </div>
        <div className="header-actions">
          <button className="saas-btn saas-btn-secondary" onClick={handleSendInventoryReport} disabled={isProcessing}>
            📱 <span className="hide-on-mobile">Report</span>
          </button>
          {selectedToDelete.size > 0 && (activeView === 'retail' || activeView === 'wholesale') && (
            <button className="saas-btn saas-btn-danger" onClick={handleDelete}>
              Delete ({selectedToDelete.size})
            </button>
          )}
          {selectedSuppliersToDelete.size > 0 && activeView === 'suppliers' && (
            <button className="saas-btn saas-btn-danger" onClick={handleDeleteSuppliers}>
              Delete ({selectedSuppliersToDelete.size})
            </button>
          )}
          {(activeView === 'retail' || activeView === 'wholesale') && (
            <button className="saas-btn saas-btn-primary desktop-only-btn" onClick={handleOpenAddProduct}>
              + Add Product
            </button>
          )}
          {activeView === 'suppliers' && (
            <button className="saas-btn saas-btn-primary desktop-only-btn" onClick={() => setIsAddSupplierOpen(true)}>
              + Add Supplier
            </button>
          )}
        </div>
      </div>

      {/* TOOLBAR & TABS (Frozen) */}
      <div className="saas-card" style={{ marginBottom: '24px', padding: '16px 20px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <div className="saas-tab-container hide-scrollbar" style={{ margin: 0, padding: 0, border: 'none', boxShadow: 'none', background: 'transparent' }}>
          <button className={`saas-tab ${activeView === 'retail' ? 'active' : ''}`} onClick={() => { setActiveView('retail'); setActiveCategory('All'); }}>🛍️ Retail</button>
          <button className={`saas-tab ${activeView === 'wholesale' ? 'active' : ''}`} onClick={() => setActiveView('wholesale')}>🌾 Wholesale</button>
          <button className={`saas-tab ${activeView === 'import' ? 'active' : ''}`} onClick={() => setActiveView('import')}>🚚 Receive Stock</button>
          <button className={`saas-tab ${activeView === 'pending' ? 'active' : ''}`} onClick={() => setActiveView('pending')}>⏳ Pending Payments {processedPending.length > 0 && `(${processedPending.length})`}</button>
          <button className={`saas-tab ${activeView === 'suppliers' ? 'active' : ''}`} onClick={() => setActiveView('suppliers')}>🏢 Suppliers</button>
        </div>
        
        {(activeView === 'retail' || activeView === 'wholesale' || activeView === 'suppliers') && (
          <div className="mobile-action-row" style={{ flex: 1 }}>
            <input 
              className="saas-input" 
              placeholder="🔍 Quick search..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              style={{ minWidth: '150px' }}
            />
            
            {activeView === 'suppliers' ? (
              <button className="saas-btn saas-btn-primary mobile-only-btn" onClick={() => setIsAddSupplierOpen(true)} style={{ padding: '0', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {/* 🎨 Crisp White SVG Plus Icon */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            ) : (
              <div className="toolbar-filters" style={{ display: 'flex', gap: '8px' }}>
                <button className="saas-btn saas-btn-primary mobile-only-btn" onClick={handleOpenAddProduct} style={{ padding: '0', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {/* 🎨 Crisp White SVG Plus Icon */}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button className="saas-btn saas-btn-secondary" onClick={() => setIsFilterOpen(true)} style={{ color: filterRules.length > 0 ? '#3b82f6' : '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', width: filterRules.length > 0 ? 'auto' : '40px', paddingLeft: filterRules.length > 0 ? '12px' : '0', paddingRight: filterRules.length > 0 ? '12px' : '0', height: '40px', flexShrink: 0 }}>
                  {/* 🎨 Scaled Filter Icon to match */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                  {filterRules.length > 0 && <span style={{ marginLeft: '6px', fontSize: '13px', fontWeight: 'bold' }}>{filterRules.length}</span>}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 🔥 NEW: RETAIL TOP/NORMAL TABS (MOBILE ONLY) */}
      {activeView === 'retail' && (
        <div className="mobile-only-flex" style={{ padding: '0 16px', marginBottom: '16px', gap: '8px' }}>
          <button className={`saas-btn ${retailTab === 'Normal' ? 'saas-btn-primary' : ''}`} onClick={() => setRetailTab('Normal')} style={{ borderRadius: '20px', padding: '6px 16px', fontSize: '13px', background: retailTab === 'Normal' ? '#b58a3d' : '#f1f5f9', color: retailTab === 'Normal' ? '#fff' : '#475569', border: 'none', flex: 1, boxShadow: 'none' }}>📋 Normal List</button>
          <button className={`saas-btn ${retailTab === 'Top' ? 'saas-btn-primary' : ''}`} onClick={() => setRetailTab('Top')} style={{ borderRadius: '20px', padding: '6px 16px', fontSize: '13px', background: retailTab === 'Top' ? '#b58a3d' : '#f1f5f9', color: retailTab === 'Top' ? '#fff' : '#475569', border: 'none', flex: 1, boxShadow: 'none' }}>⭐ Top Sellers</button>
        </div>
      )}

      {/* RICE CATEGORIES (dnd-kit) */}
      {activeView === 'wholesale' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleCategoryDragEnd}
        >
          <div 
            className="saas-tab-container hide-scrollbar" 
            style={{ paddingBottom: '16px', marginBottom: '8px', WebkitOverflowScrolling: 'touch', userSelect: 'none', background: 'transparent', border: 'none', boxShadow: 'none', flexShrink: 0, display: 'flex' }}
          >
            <SortableContext
              items={categoryOrder}
              strategy={horizontalListSortingStrategy}
            >
              {categoryOrder.map(cat => (
                <SortableCategoryItem
                  key={cat}
                  id={cat}
                  isActive={activeCategory === cat}
                  onClick={() => setActiveCategory(cat)}
                />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      )}

      {/* 🔥 SPREADSHEET VIEWS: RETAIL & WHOLESALE */}
      {(activeView === 'retail' || activeView === 'wholesale') && (
        <React.Fragment>
        {/* DESKTOP VIEW */}
        <div className="saas-table-wrapper fade-in hide-on-mobile" style={{ flex: 1, minHeight: 0, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
            <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'fixed', width: 'max-content' }}>
              <thead>
                <tr>
                  {columnOrder.map(key => {
                    if (key === 'expand' && activeView !== 'wholesale') return null;
                    if ((key === 'linked_wholesale' || key === 'mtd_kg_used' || key === 'mtd_bags_used') && activeView !== 'retail') return null;
                    if (key === 'actions' && activeView !== 'wholesale') return null; 
                    
                    const isDraggable = key !== 'actions' && key !== 'linked_wholesale' && key !== 'expand';

                    if (key === 'expand') {
                      return <th key={key} className="saas-th" style={{ width: '40px', minWidth: '40px', maxWidth: '40px', padding: '16px 8px', borderRight: '1px solid #f1f5f9', position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0' }}></th>;
                    }

                    return (
                      <th 
                        key={key} 
                        className="saas-th"
                        draggable={isDraggable}
                        onDragStart={(e) => onDragStartCol(e, key as string, ['actions', 'linked_wholesale', 'expand'])}
                        onDragOver={onDragOverCol}
                        onDrop={(e) => handleProductDrop(e, key as string)}
                        onClick={() => handleProductSort(key)}
                        style={{ 
                          width: columnWidths[key as string] || 150, 
                          position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0',
                          textAlign: key === 'actions' ? 'center' : 'left', 
                          borderRight: '1px solid #f1f5f9', 
                          cursor: isDraggable ? 'pointer' : 'default', 
                          whiteSpace: 'nowrap', userSelect: 'none' 
                        }}
                      >
                        {key === 'linked_wholesale' ? 'Linked Wholesale Bag' : key === 'mtd_kg_used' ? 'MTD Used (Kg)' : key === 'mtd_bags_used' ? 'MTD Used (Bags)' : key === 'min_stock_level' ? 'Min Stock' : (key as string).replace('_', ' ')}
                        {isDraggable && (<span style={{ marginLeft: '6px', fontSize: '12px', opacity: sortConfig?.key === key ? 1 : 0.3 }}>{sortConfig?.key === key ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>)}
                        {isDraggable && <div onMouseDown={(e) => handleResizeStartProduct(e, key as string)} onTouchStart={(e) => handleResizeStartProduct(e, key as string)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '14px', cursor: 'col-resize', background: 'transparent', zIndex: 10, transform: 'translateX(50%)' }} />}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton columns={columnOrder.length} rows={8} />
                ) : processedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={columnOrder.length} style={{ padding: 0 }}>
                      <EmptyState icon="📦" title="No products found." message="Try adjusting your filters or search query." />
                    </td>
                  </tr>
                ) : (
                  processedProducts.map(p => {
                    const pBatches = activeBatchesMap[p.id] || [];
                    pBatches.sort((a,b) => a.id - b.id); 
                    const currentBatch = pBatches.length > 0 ? pBatches[0] : null;
                    const isExpanded = expandedProductId === p.id;
                    const totalActiveBatchStock = pBatches.reduce((sum, b) => sum + Number(b.remaining_qty), 0);
                    const linkedRetail = products.find(r => r.linked_wholesale_id === p.id);

                    return (
                      <React.Fragment key={p.id}>
                        <tr className="saas-tr" onMouseEnter={() => setHoveredId(p.id)} onMouseLeave={() => setHoveredId(null)} style={{ background: edits[p.id] ? '#fefcf3' : 'transparent' }}>
                          {columnOrder.map(col => {
                            if (col === 'expand' && activeView !== 'wholesale') return null;
                            if ((col === 'linked_wholesale' || col === 'mtd_kg_used' || col === 'mtd_bags_used') && activeView !== 'retail') return null;
                            
                            if (col === 'expand') {
                               return (
                                 <td className="saas-td" key={col} style={{ width: '40px', minWidth: '40px', maxWidth: '40px', borderRight: '1px solid #f1f5f9', padding: '8px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
                                   {pBatches.length > 1 && (
                                     <button 
                                       onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedProductId(isExpanded ? null : p.id); }} 
                                       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}
                                     >
                                       {isExpanded ? '▼' : '▶'}
                                     </button>
                                   )}
                                 </td>
                               )
                            }

                            if (col === 'actions') {
                              if (activeView === 'retail') {
                                 return (
                                   <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9', padding: '8px', overflow: 'hidden', textAlign: 'center' }}>
                                     {p.linked_wholesale_id ? (() => {
                                       const wholesaleProd = products.find(wp => wp.id === p.linked_wholesale_id);
                                       const isOutOfStock = wholesaleProd ? Number(wholesaleProd.stock) < 1 : true;
                                       return (
                                         <button 
                                           onClick={() => handleManualPull(p.id, p.linked_wholesale_id!)}
                                           disabled={isProcessing || isOutOfStock}
                                           className="saas-btn"
                                           style={{ background: isOutOfStock ? '#cbd5e1' : '#10b981', color: '#fff', border: 'none', padding: '6px 12px', fontSize: '12px', cursor: (isProcessing || isOutOfStock) ? 'not-allowed' : 'pointer' }}
                                         >
                                           {isOutOfStock ? '❌ No Stock' : '♻️ Pull 1 Bag'}
                                         </button>
                                       )
                                     })() : (
                                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>No Link</span>
                                     )}
                                   </td>
                                 )
                              }
                              
                              return (
                                <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9', padding: '8px', overflow: 'hidden' }}>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                                    {edits[p.id] ? (
                                      <>
                                        <button onMouseDown={(e) => { e.stopPropagation(); handleSaveRecord(p.id); }} className="saas-btn saas-btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>Save</button>
                                        <button onMouseDown={(e) => { e.stopPropagation(); setEdits(prev => { const n = { ...prev }; delete n[p.id]; return n }) }} className="saas-btn" style={{ background: '#fee2e2', color: '#ef4444', padding: '6px 12px', fontSize: '12px' }}>Undo</button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={(e) => { e.stopPropagation(); openImportModal(p); }} className="saas-btn" style={{ background: '#3b82f6', color: '#fff', padding: '6px 12px', fontSize: '12px' }}>📦 Import</button>
                                        <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); fetchHistory(p); }} title="View Import Log" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: 0 }}>🕒</button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              )
                            }

                            const isIdCol = col === 'id';
                            const isEditing = editingCell?.id === p.id && editingCell?.col === col;
                            
                            let val = edits[p.id]?.[col as keyof Product] ?? p[col as keyof Product] ?? '';
                            if (activeView === 'wholesale' && currentBatch) {
                               if (col === 'cost_price') val = edits[p.id]?.cost_price ?? currentBatch.cost_price;
                               // 🔥 Displays the individual FIFO current batch remaining quantity instead of Master Stock
                               if (col === 'stock') val = edits[p.id]?.stock ?? currentBatch.remaining_qty;
                            }

                            if (!isEditing && !edits[p.id] && activeView === 'retail' && col === 'cost_price' && p.linked_wholesale_id) {
                              const parentWholesale = products.find(wp => wp.id === p.linked_wholesale_id);
                              if (parentWholesale) {
                                const parentBatches = (activeBatchesMap[parentWholesale.id] || []);
                                parentBatches.sort((a,b) => a.id - b.id);
                                const liveParentCogs = parentBatches.length > 0 ? parentBatches[0].cost_price : (parentWholesale.cost_price || 0);
                                const parentWeight = parentWholesale.weight || 50;
                                val = Math.round(liveParentCogs / parentWeight);
                              }
                            }

                            if (col === 'linked_wholesale') {
                              if (activeView === 'retail') {
                                const linkedProduct = products.find(wp => wp.id === p.linked_wholesale_id);
                                const isDropdownOpen = activeDropdownId === p.id;
                                return (
                                  <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9', position: 'relative', padding: '6px 12px', overflow: 'visible' }}>
                                    {isDropdownOpen ? (
                                      <div style={{ position: 'relative', zIndex: 100 }}>
                                        <input autoFocus className="saas-input" placeholder="Search Wholesale bag..." value={dropdownSearch} onChange={e => setDropdownSearch(e.target.value)} onBlur={() => setTimeout(() => setActiveDropdownId(null), 200)} onKeyDown={e => e.key === 'Escape' && setActiveDropdownId(null)} />
<div className="dropdown-results-tray">
  <div className="dropdown-row clear-option" onMouseDown={(e) => { e.stopPropagation(); handleLinkWholesaleBag(p.id, null); }}>❌ Clear Linked Bag</div>
  {/* 🔥 OVERSELL FIX: Allow 0 or negative stock wholesale bags to be linked */}
                              {products.filter(wp => wp.weight > 1 && wp.name.toLowerCase().includes(dropdownSearch.toLowerCase()))
                                .sort((a, b) => riceCategoryComparator(a, b, 'cost_price'))
                                .map(wp => (
                                <div key={wp.id} className="dropdown-row" onMouseDown={(e) => { e.stopPropagation(); handleLinkWholesaleBag(p.id, wp); }}>
                                              <span style={{ fontWeight: 'normal', color: '#334155' }}>{wp.name}</span>
                                              <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '8px' }}>(Stock: {wp.stock} • {formatRiel(Number(wp.cost_price))})</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <div className="interactive-select-trigger" onClick={(e) => { e.stopPropagation(); setActiveDropdownId(p.id); setDropdownSearch(''); }} style={{ flex: 1 }}>
                                          {linkedProduct ? `🌾 ${linkedProduct.name}` : '🔍 Click to link Wholesale Bag...'}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                )
                              }
                              return null;
                            }

                            return (
                              <td key={col} className={`saas-td ${isEditing ? 'cell-editing' : ''}`} style={{ borderRight: '1px solid #f1f5f9', overflow: 'hidden', position: 'relative', padding: 0 }}>
                                {isIdCol && (hoveredId === p.id || selectedToDelete.has(p.id)) && (
                                  <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', zIndex: 25, background: edits[p.id] ? '#fefcf3' : '#fff', paddingRight: '4px' }}>
                                    <input type="checkbox" checked={selectedToDelete.has(p.id)} onChange={() => { const next = new Set(selectedToDelete); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedToDelete(next); }} style={{ cursor: 'pointer', width: '18px', height: '18px', margin: 0, accentColor: '#b58a3d' }} />
                                  </div>
                                )}
                                
                                {isEditing ? (
                                  <input 
                                    autoFocus 
                                    enterKeyHint="done"
                                    type={['name'].includes(col as string) ? 'text' : 'number'} 
                                    className="cell-input no-spinners" 
                                    style={{ paddingLeft: isIdCol ? '36px' : '12px' }} 
                                    value={val as any} 
                                    onChange={(e) => { const newVal = e.target.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; setEdits(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [col]: newVal } })) }} 
                                    onBlur={() => {
                                      const originalVal = p[col as keyof Product];
                                      const editVal = edits[p.id]?.[col as keyof Product];
                                      if (editVal === undefined || editVal === originalVal || editVal === '') {
                                        setEdits(prev => { const n = { ...prev }; delete n[p.id]; return n });
                                        setEditingCell(null);
                                      } else {
                                        setEditingCell(null);
                                      }
                                    }} 
                                    onKeyDown={(e) => { 
                                      if (e.key === 'Enter' || e.keyCode === 13) { 
                                        e.preventDefault();
                                        handleSaveRecord(p.id);
                                      } 
                                      if (e.key === 'Escape') { 
                                        setEdits(prev => { const n = { ...prev }; delete n[p.id]; return n }); 
                                        setEditingCell(null); 
                                      } 
                                    }} 
                                  />
                                ) : (
                                  <div className="cell-display" style={{ paddingLeft: isIdCol ? '36px' : '12px', fontWeight: 'normal', color: ['mtd_kg_used', 'mtd_bags_used'].includes(col as string) ? '#b58a3d' : '#334155', cursor: 'text' }} onClick={() => { setEditingCell({ id: p.id, col: col as string }) }}>
                                    
                                    {col === 'name' ? (
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {activeView === 'wholesale' && (
                                          <span style={{ fontSize: '11px', background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontWeight: 'bold' }}>📦 {totalActiveBatchStock} Total</span>
                                            {linkedRetail && (
                                              <>
                                                <span style={{ width: '1px', height: '10px', background: '#d97706', opacity: 0.5 }}></span>
                                                <span style={{ fontWeight: 'normal' }}>⚖️ {linkedRetail.stock} kg Loose</span>
                                              </>
                                            )}
                                          </span>
                                        )}
                                        {formatDisplayValue(col as string, val)}
                                        
                                        {activeView === 'retail' && p.linked_wholesale_id && (() => {
                                          const wProd = products.find(wp => wp.id === p.linked_wholesale_id);
                                          const wWeight = wProd ? Number(wProd.weight) : 50;
                                          if (p.stock >= wWeight) {
                                            return (
                                              <button 
                                                onClick={(e) => { 
                                                  e.preventDefault(); 
                                                  e.stopPropagation(); 
                                                  setRepackModal({ isOpen: true, product: p }); 
                                                }}
                                                onMouseDown={(e) => e.stopPropagation()} 
                                                className="saas-btn"
                                                style={{ marginLeft: '12px', padding: '4px 8px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontSize: '11px' }}
                                              >
                                                📦 Repack {wWeight}kg
                                              </button>
                                            );
                                          }
                                          return null;
                                        })()}
                                      </span>
                                    ) : (
                                      formatDisplayValue(col as string, val)
                                    )}

                                  </div>
                                )}
                              </td>
                            )
                          })}
                        </tr>

                        {/* Expandable Child Row Batch List (View Only) */}
                        {isExpanded && activeView === 'wholesale' && pBatches.length > 1 && pBatches.slice(1).map((batch, index) => {
                           let batchLabel = index === 0 ? '2nd Batch' : index === 1 ? '3rd Batch' : `${index + 2}th Batch`;
                           
                           return (
                             <tr className="saas-tr" key={`batch-${batch.id}`} style={{ background: '#f8fafc' }}>
                                {columnOrder.map(col => {
                                  if (col === 'expand') return <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9' }}></td>;
                                  if (col === 'linked_wholesale' || col === 'mtd_kg_used' || col === 'mtd_bags_used') return null;
                                  if (col === 'id') return <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9' }}></td>;
                                  
                                  if (col === 'name') return (
                                    <td className="saas-td" key={col} style={{ padding: '12px 12px 12px 48px', borderRight: '1px solid #f1f5f9', color: '#475569', fontSize: '14px' }}>
                                      ↳ {batchLabel}
                                    </td>
                                  );
                                  
                                  if (col === 'price') return <td className="saas-td" key={col} style={{ padding: '12px', borderRight: '1px solid #f1f5f9', color: '#475569', fontSize: '14px' }}>-</td>;
                                  
                                  if (col === 'cost_price') return <td className="saas-td" key={col} style={{ padding: '12px', borderRight: '1px solid #f1f5f9', color: '#475569', fontSize: '14px' }}>{formatRiel(batch.cost_price)}</td>;
                                  
                                  if (col === 'stock') return <td className="saas-td" key={col} style={{ padding: '12px', borderRight: '1px solid #f1f5f9', color: '#b58a3d', fontWeight: 'normal', fontSize: '14px' }}>{batch.remaining_qty}</td>;
                                  
                                  if (col === 'actions') {
                                    return <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9' }}></td>;
                                  }
                                  
                                  return <td className="saas-td" key={col} style={{ padding: '12px', borderRight: '1px solid #f1f5f9', color: '#94a3b8', fontSize: '14px', textAlign: 'center' }}>-</td>;
                                })}
                             </tr>
                           )
                        })}
                      </React.Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 📱 MOBILE VIEW: RETAIL & WHOLESALE CARDS (ULTRA-COMPACT) */}
        <div className="mobile-only-list fade-in">
          {isLoading ? (
             <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading inventory...</div>
          ) : processedProducts.length === 0 ? (
             <EmptyState icon="📦" title="No products found." message="Try adjusting your filters or search query." />
          ) : (
             processedProducts.map((p, index) => {
                const pBatches = activeBatchesMap[p.id] || [];
                pBatches.sort((a,b) => a.id - b.id); // Ensures chronological order
                const currentBatch = pBatches.length > 0 ? pBatches[0] : null;
                const totalActiveBatchStock = pBatches.reduce((sum, b) => sum + Number(b.remaining_qty), 0);
                const displayStock = activeView === 'wholesale' ? totalActiveBatchStock : p.stock;
                const isLowStock = Number(displayStock) <= Number(p.min_stock_level);
                const wholesaleProd = p.linked_wholesale_id ? products.find(wp => wp.id === p.linked_wholesale_id) : null;

                return (
                  <div key={p.id} className="saas-mobile-card compact-card" onClick={() => { setMobileEditProduct(p); setEdits({ [p.id]: { name: p.name, price: p.price, cost_price: p.cost_price, stock: p.stock, weight: p.weight, min_stock_level: p.min_stock_level } }); }}>
                     <div className="compact-card-left">
                        <span style={{ fontWeight: 'bold', color: '#94a3b8', fontSize: '14px', minWidth: '22px' }}>{index + 1}.</span>
                        <div className="compact-text-group">
                           <div className="compact-title">🌾 {p.name}</div>
                           {activeView === 'wholesale' ? (
                               <div className="compact-sub" style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '4px', fontSize: '13px' }}>
                                  {/* 🛡️ Explicitly cast as Number so TypeScript never panics */}
                                  {formatRiel(currentBatch ? Number(currentBatch.cost_price) : Number(p.cost_price || 0))}
                               </div>
                           ) : (
                               <div className="compact-sub">{p.weight}kg {wholesaleProd ? `🔗 ${wholesaleProd.name}` : ''}</div>
                           )}
                        </div>
                     </div>
                     <div className="compact-card-right" style={{ justifyContent: 'center' }}>
                        {activeView === 'wholesale' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                              <div className="compact-stock" style={{ color: '#b58a3d', fontSize: '14px' }}>📦 {totalActiveBatchStock} left</div>
                              {/* 🛡️ Safely parse quantity */}
                              <div className="compact-date" style={{ color: '#15803d', fontSize: '12px', fontWeight: 'bold' }}>🟢 1st: {currentBatch ? Number(currentBatch.remaining_qty) : 0}</div>
                            </div>
                        ) : (
                            <>
                              <div className="compact-stock" style={{ color: isLowStock ? '#ef4444' : '#10b981' }}>{displayStock} left</div>
                              <div className="compact-price" style={{ marginTop: '2px' }}>{formatRiel(Number(p.price || 0))}</div>
                            </>
                        )}
                     </div>
                  </div>
                )
             })
          )}
        </div>
        </React.Fragment>
      )}

      {/* IMPORT FORM TAB */}
      {activeView === 'import' && (
        <div className="fade-in" style={{ display: 'flex', justifyContent: 'center', flex: 1, overflowY: 'auto' }}>
          <div className="saas-card" style={{ width: '100%', maxWidth: '600px', height: 'fit-content' }}>
            <h2 className="saas-card-title" style={{ fontSize: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>🚚 Receive New Stock</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
              
              {/* SUPPLIER SEARCHABLE DROPDOWN */}
              <div style={{ position: 'relative', zIndex: isSupplierDropdownOpen ? 100 : 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
                  <label className="saas-card-title" style={{ fontSize: '11px', margin: 0 }}>Select Supplier</label>
                  <button type="button" onClick={() => setIsAddSupplierOpen(true)} className="saas-btn" style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', padding: 0 }}>+ Add New Supplier</button>
                </div>
                {isSupplierDropdownOpen ? (
                  <div style={{ position: 'relative' }}>
                    <input 
                      autoFocus 
                      className="saas-input" 
                      placeholder="Search..." 
                      value={supplierSearch} 
                      onChange={e => setSupplierSearch(e.target.value)} 
                      onBlur={() => setTimeout(() => setIsSupplierDropdownOpen(false), 200)} 
                      onKeyDown={e => e.key === 'Escape' && setIsSupplierDropdownOpen(false)} 
                    />
                    <div className="dropdown-results-tray">
                      {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                        <div key={s.id} className="dropdown-row" onMouseDown={(e) => { e.stopPropagation(); setImportForm({...importForm, supplier_id: String(s.id)}); setIsSupplierDropdownOpen(false); }}>
                          <span style={{ fontWeight: 'normal', color: '#334155' }}>{s.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="interactive-select-trigger" onClick={() => { setIsSupplierDropdownOpen(true); setSupplierSearch(''); }} style={{ width: '100%', padding: '12px', fontSize: '15px' }}>
                    {importForm.supplier_id ? suppliers.find(s => String(s.id) === String(importForm.supplier_id))?.name || 'Unknown' : '-- Choose a Supplier --'}
                  </div>
                )}
              </div>

              {/* PRODUCT SEARCHABLE DROPDOWN */}
              <div style={{ position: 'relative', zIndex: isProductDropdownOpen ? 90 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
                  <label className="saas-card-title" style={{ fontSize: '11px', margin: 0 }}>Select Product (Rice)</label>
                  <button type="button" onClick={handleOpenAddProduct} className="saas-btn" style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', padding: 0 }}>+ Create New Product</button>
                </div>
                {isProductDropdownOpen ? (
                  <div style={{ position: 'relative' }}>
                    <input 
                      autoFocus 
                      className="saas-input" 
                      placeholder="Search..." 
                      value={productSearch} 
                      onChange={e => setProductSearch(e.target.value)} 
                      onBlur={() => setTimeout(() => setIsProductDropdownOpen(false), 200)} 
                      onKeyDown={e => e.key === 'Escape' && setIsProductDropdownOpen(false)} 
                    />
                    <div className="dropdown-results-tray">
                      {products.filter(p => {
                        // 1. Must be a Sealed Bag (Weight greater than 1kg)
                        if (p.weight <= 1) return false;
                        
                        // 2. Must match user's text search (if typing)
                        if (productSearch && !p.name.toLowerCase().includes(productSearch.toLowerCase())) return false;
                        
                        // 🔥 3. SMART FILTER: If a supplier is selected, ONLY show their rice!
                        if (importForm.supplier_id) {
                          const activeSupplier = suppliers.find(s => String(s.id) === String(importForm.supplier_id));
                          if (activeSupplier && !p.name.toLowerCase().includes(activeSupplier.name.toLowerCase())) {
                            return false; // Hide this rice because it belongs to a different supplier
                          }
                        }
                        
                        return true;
                      })
                      .sort((a, b) => riceCategoryComparator(a, b, 'cost_price'))
                      .map(p => (
                        <div key={p.id} className="dropdown-row" onMouseDown={(e) => { e.stopPropagation(); setImportForm({...importForm, product_id: String(p.id)}); setIsProductDropdownOpen(false); }}>
                          <span style={{ fontWeight: 'normal', color: '#334155' }}>{p.name}</span>
                          <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '8px' }}>({p.weight}kg)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="interactive-select-trigger" onClick={() => { setIsProductDropdownOpen(true); setProductSearch(''); }} style={{ width: '100%', padding: '12px', fontSize: '15px' }}>
                    {importForm.product_id ? products.find(p => String(p.id) === String(importForm.product_id))?.name || 'Unknown' : '-- Choose Rice Type --'}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Quantity Imported</label>
                  <input 
                    type="number" 
                    placeholder="0" 
                    className="saas-input no-spinners" 
                    value={importForm.qty} 
                    onFocus={() => { if (importForm.qty === '0') setImportForm({...importForm, qty: ''}) }}
                    onBlur={() => { if (importForm.qty === '') setImportForm({...importForm, qty: '0'}) }}
                    onChange={e => setImportForm({...importForm, qty: e.target.value})} 
                  />
                </div>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Unit Cost (៛)</label>
                  <CurrencyInput 
                    placeholder="0" 
                    value={importForm.unit_cost} 
                    onFocus={() => { if (String(importForm.unit_cost) === '0') setImportForm({...importForm, unit_cost: ''}) }}
                    onBlur={() => { if (importForm.unit_cost === '') setImportForm({...importForm, unit_cost: '0'}) }}
                    onChange={(v:any) => setImportForm({...importForm, unit_cost: v})} 
                    className="saas-input" 
                  />
                </div>
              </div>

              <div style={{ background: '#fefcf3', padding: '16px', borderRadius: '8px', border: '1px solid #fde047', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#854d0e' }}>Total Bill Cost:</span>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#b58a3d' }}>{formatRiel(importTotalCalc)}</span>
              </div>

              <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1e293b' }}>Payment Details</h4>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 2, minWidth: '150px' }}>
                    <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Amount Paying Now (៛)</label>
                    <CurrencyInput 
                      placeholder="0" 
                      value={importForm.paid_amount} 
                      onFocus={() => { if (String(importForm.paid_amount) === '0') setImportForm({...importForm, paid_amount: ''}) }}
                      onBlur={() => { if (importForm.paid_amount === '') setImportForm({...importForm, paid_amount: '0'}) }}
                      onChange={(v:any) => setImportForm({...importForm, paid_amount: v})} 
                      className="saas-input" 
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '120px' }}>
                    <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Payment Method</label>
                    <select value={importForm.payment_method} onChange={e => setImportForm({...importForm, payment_method: e.target.value})} className="saas-input" style={{ cursor: 'pointer' }}>
                      <option value="Cash ៛">💵 Cash ៛</option>
                      <option value="Cash $">💵 Cash $</option>
                      <option value="QR ៛">📱 QR ៛</option>
                      <option value="QR $">📱 QR $</option>
                      <option value="Mom QR ៛">👩 Mom QR ៛</option>
                      <option value="Mom QR $">👩 Mom QR $</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                  <button 
                    type="button"
                    onClick={() => handleProcessImport(true)} 
                    disabled={isProcessing}
                    className="saas-btn"
                    style={{ 
                      flex: 1, 
                      padding: '14px', 
                      background: '#f59e0b', 
                      color: '#fff', 
                      fontSize: '15px', 
                      cursor: isProcessing ? 'not-allowed' : 'pointer',
                      opacity: isProcessing ? 0.7 : 1,
                      transition: 'opacity 0.2s'
                    }}
                  >
                    {isProcessing ? '⏳ Saving Pending Bill...' : '⏳ Save as Pending/Partial'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => handleProcessImport(false)} 
                    disabled={isProcessing}
                    className="saas-btn saas-btn-primary"
                    style={{ 
                      flex: 1, 
                      padding: '14px', 
                      fontSize: '15px', 
                      cursor: isProcessing ? 'not-allowed' : 'pointer',
                      opacity: isProcessing ? 0.7 : 1,
                      transition: 'opacity 0.2s'
                    }}
                  >
                    {isProcessing ? '⏳ Processing Import...' : '✅ Paid Full & Import'}
                  </button>
                </div>

            </div>
          </div>
        </div>
      )}

      {/* 🔥 PENDING PAYMENTS TAB */}
      {activeView === 'pending' && (
        <React.Fragment>
        {/* DESKTOP VIEW */}
        <div className="saas-table-wrapper fade-in hide-on-mobile" style={{ flex: 1, minHeight: 0, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
            <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'fixed', width: 'max-content' }}>
              <thead>
                <tr>
                  {pendingColOrder.map(col => {
                    const isDraggable = col !== 'actions';
                    let label = col;
                    if (col === 'date') label = 'Date';
                    if (col === 'supplier') label = 'Supplier';
                    if (col === 'product') label = 'Product';
                    if (col === 'total_cost') label = 'Total Cost (៛)';
                    if (col === 'paid_so_far') label = 'Paid So Far';
                    if (col === 'remaining_debt') label = 'Remaining Debt';
                    if (col === 'actions') label = 'Action';

                    return (
                      <th 
                        key={col}
                        className="saas-th"
                        draggable={isDraggable}
                        onDragStart={(e) => onDragStartCol(e, col, ['actions'])}
                        onDragOver={onDragOverCol}
                        onDrop={(e) => handlePendingDrop(e, col)}
                        onClick={() => handlePendingSort(col)}
                        style={{ 
                          width: pendingColWidths[col] || 150, 
                          position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#fff1f2', boxShadow: 'inset 0 -2px 0 0 #ffe4e6',
                          textAlign: col === 'actions' ? 'center' : (['total_cost', 'paid_so_far', 'remaining_debt'].includes(col) ? 'right' : 'left'), 
                          color: '#991b1b', 
                          borderRight: '1px solid #ffe4e6', 
                          cursor: isDraggable ? 'pointer' : 'default', 
                          whiteSpace: 'nowrap', 
                          userSelect: 'none' 
                        }}
                      >
                        {label}
                        {isDraggable && (<span style={{ marginLeft: '6px', fontSize: '12px', opacity: pendingSort?.key === col ? 1 : 0.3 }}>{pendingSort?.key === col ? (pendingSort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>)}
                        {isDraggable && <div onMouseDown={(e) => handleResizeStartPending(e, col)} onTouchStart={(e) => handleResizeStartPending(e, col)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '14px', cursor: 'col-resize', background: 'transparent', zIndex: 10, transform: 'translateX(50%)' }} />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton columns={pendingColOrder.length} rows={5} />
                ) : processedPending.length === 0 ? (
                  <tr>
                    <td colSpan={pendingColOrder.length} style={{ padding: 0 }}>
                      <EmptyState icon="🎉" title="No pending payments!" message="All your supplier debts are fully settled." />
                    </td>
                  </tr>
                ) : (
                  processedPending.map((imp: any) => {
                    const remaining = Number(imp.total_cost) - Number(imp.paid_amount);
                    return (
                      <tr key={imp.id} className="saas-tr">
                        {pendingColOrder.map(col => {
                          if (col === 'date') return <td className="saas-td" key={col}>{new Date(imp.created_at).toLocaleDateString()}</td>;
                          if (col === 'supplier') return <td className="saas-td" key={col} style={{ fontWeight: 'bold' }}>{imp.suppliers?.name}</td>;
                          if (col === 'product') return <td className="saas-td" key={col}>{imp.products?.name} <span style={{color:'#94a3b8'}}>(x{imp.qty})</span></td>;
                          if (col === 'total_cost') return <td className="saas-td" key={col} style={{ textAlign: 'right' }}>{formatRiel(imp.total_cost)}</td>;
                          if (col === 'paid_so_far') return <td className="saas-td" key={col} style={{ textAlign: 'right', color: '#10b981', fontWeight: 'bold' }}>{formatRiel(imp.paid_amount)}</td>;
                          if (col === 'remaining_debt') return <td className="saas-td" key={col} style={{ textAlign: 'right', color: '#ef4444', fontWeight: 'bold' }}>{formatRiel(remaining)}</td>;
                          if (col === 'actions') return (
                            <td className="saas-td" key={col} style={{ textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                <button 
                                  onClick={() => {
                                    setPayPendingModal({ isOpen: true, record: imp, totalDue: remaining });
                                    setPendingPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '' }]);
                                  }}
                                  className="saas-btn saas-btn-primary"
                                  style={{ padding: '6px 12px', fontSize: '12px' }}
                                >
                                  💸 Pay Now
                                </button>
                                <button 
                                  onClick={() => {
                                    setEditImportModal({ isOpen: true, record: imp });
                                    setEditImportForm({ qty: imp.qty, unit_cost: imp.unit_cost });
                                  }}
                                  disabled={isProcessing}
                                  className="saas-btn saas-btn-secondary"
                                  style={{ padding: '6px 12px', fontSize: '12px' }}
                                >
                                  ✏️ Edit
                                </button>
                                <button 
                                  onClick={() => handleVoidImport(imp.id)}
                                  disabled={isProcessing}
                                  className="saas-btn saas-btn-danger"
                                  style={{ padding: '6px 12px', fontSize: '12px' }}
                                >
                                  ❌ Void
                                </button>
                              </div>
                            </td>
                          );
                          return null;
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 📱 MOBILE VIEW: PENDING PAYMENTS CARDS (ULTRA-COMPACT) */}
        <div className="mobile-only-list fade-in">
           {isLoading ? (
             <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading debts...</div>
           ) : processedPending.length === 0 ? (
             <EmptyState icon="🎉" title="No pending payments!" message="All your supplier debts are fully settled." />
           ) : (
             processedPending.map((imp: any, index: number) => {
                 const remaining = Number(imp.total_cost) - Number(imp.paid_amount);
                 return (
                     <div key={imp.id} className="saas-mobile-card compact-card" onClick={() => setMobilePendingAction({ imp, remaining })}>
                        <div className="compact-card-left">
                           <span style={{ fontWeight: 'bold', color: '#94a3b8', fontSize: '14px', minWidth: '22px' }}>{index + 1}.</span>
                           <div className="compact-text-group">
                              <div className="compact-title">🏢 {imp.suppliers?.name}</div>
                              <div className="compact-sub">{imp.products?.name} (x{imp.qty})</div>
                           </div>
                        </div>
                        <div className="compact-card-right">
                           <div className="compact-debt">🚨 {formatRiel(remaining)}</div>
                           <div className="compact-date">{new Date(imp.created_at).toLocaleDateString()}</div>
                        </div>
                     </div>
                 )
             })
           )}
        </div>
        </React.Fragment>
      )}

      {/* 🔥 SUPPLIERS DATABASE TAB */}
      {activeView === 'suppliers' && (
        <React.Fragment>
        {/* DESKTOP VIEW */}
        <div className="saas-table-wrapper fade-in hide-on-mobile" style={{ flex: 1, minHeight: 0, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="saas-table-responsive" style={{ flex: 1, overflow: 'auto' }}>
            <table className="saas-table" style={{ minWidth: '100%', tableLayout: 'fixed', width: 'max-content' }}>
              <thead>
                <tr>
                  {supplierColOrder.map(col => {
                    const isDraggable = col !== 'select';
                    let label = col;
                    if (col === 'name') label = 'Supplier Name';
                    if (col === 'phone') label = 'Phone';
                    if (col === 'location') label = 'Location';
                    if (col === 'total_owed') label = 'Total Current Debt (៛)';

                    if (col === 'select') {
                      return (
                        <th key={col} className="saas-th" style={{ width: '50px', minWidth: '50px', maxWidth: '50px', padding: '16px 8px', textAlign: 'center', position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0', borderRight: '1px solid #f1f5f9' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedSuppliersToDelete.size === suppliers.length && suppliers.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedSuppliersToDelete(new Set(suppliers.map(s => s.id)));
                              else setSelectedSuppliersToDelete(new Set());
                            }}
                            style={{ cursor: 'pointer', accentColor: '#b58a3d', width: '16px', height: '16px' }}
                          />
                        </th>
                      );
                    }

                    return (
                      <th 
                        key={col}
                        className="saas-th"
                        draggable={isDraggable}
                        onDragStart={(e) => onDragStartCol(e, col, ['select'])}
                        onDragOver={onDragOverCol}
                        onDrop={(e) => handleSupplierDrop(e, col)}
                        onClick={() => handleSupplierSort(col)}
                        style={{ 
                          width: supplierColWidths[col] || 150, 
                          position: 'sticky', top: 0, zIndex: 30, backgroundColor: '#f8fafc', boxShadow: 'inset 0 -2px 0 0 #e2e8f0',
                          textAlign: col === 'total_owed' ? 'right' : 'left', 
                          borderRight: '1px solid #f1f5f9',
                          cursor: isDraggable ? 'pointer' : 'default', 
                          whiteSpace: 'nowrap', 
                          userSelect: 'none' 
                        }}
                      >
                        {label}
                        {isDraggable && (<span style={{ marginLeft: '6px', fontSize: '12px', opacity: supplierSort?.key === col ? 1 : 0.3 }}>{supplierSort?.key === col ? (supplierSort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>)}
                        {isDraggable && <div onMouseDown={(e) => handleResizeStartSupplier(e, col)} onTouchStart={(e) => handleResizeStartSupplier(e, col)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '14px', cursor: 'col-resize', background: 'transparent', zIndex: 10, transform: 'translateX(50%)' }} />}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton columns={supplierColOrder.length} rows={5} />
                ) : processedSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={supplierColOrder.length} style={{ padding: 0 }}>
                      <EmptyState icon="🏢" title="No suppliers recorded" message="Add a supplier to get started." />
                    </td>
                  </tr>
                ) : (
                  processedSuppliers.map((s: any) => (
                    <tr key={s.id} className="saas-tr">
                      {supplierColOrder.map(col => {
                        if (col === 'select') return (
                          <td className="saas-td" key={col} style={{ textAlign: 'center', borderRight: '1px solid #f1f5f9' }}>
                            <input 
                              type="checkbox" 
                              checked={selectedSuppliersToDelete.has(s.id)}
                              onChange={() => {
                                const next = new Set(selectedSuppliersToDelete)
                                next.has(s.id) ? next.delete(s.id) : next.add(s.id)
                                setSelectedSuppliersToDelete(next)
                              }} 
                              style={{ cursor: 'pointer', accentColor: '#b58a3d', width: '16px', height: '16px' }} 
                            />
                          </td>
                        );
                        if (col === 'name') return <td className="saas-td" key={col} style={{ fontWeight: 'bold', borderRight: '1px solid #f1f5f9' }}>{s.name}</td>;
                        if (col === 'phone') return <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9' }}>{s.phone || '-'}</td>;
                        if (col === 'location') return <td className="saas-td" key={col} style={{ borderRight: '1px solid #f1f5f9' }}>{s.location || '-'}</td>;
                        if (col === 'total_owed') return (
                          <td className="saas-td" key={col} style={{ textAlign: 'right', fontWeight: 'bold', borderRight: '1px solid #f1f5f9', color: Number(s.total_owed_riel) > 0 ? '#ef4444' : '#10b981' }}>
                            {formatRiel(s.total_owed_riel || 0)}
                            {Number(s.total_owed_usd) > 0 && <div style={{ fontSize: '12px', marginTop: '4px' }}>{formatUSD(s.total_owed_usd)}</div>}
                          </td>
                        );
                        return null;
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 📱 MOBILE VIEW: SUPPLIERS CARDS (ULTRA-COMPACT) */}
        <div className="mobile-only-list fade-in">
           {isLoading ? (
             <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading suppliers...</div>
           ) : processedSuppliers.length === 0 ? (
             <EmptyState icon="🏢" title="No suppliers recorded" message="Add a supplier to get started." />
           ) : (
             processedSuppliers.map((s: any, index: number) => (
                 <div key={s.id} className="saas-mobile-card compact-card" onClick={() => setMobileSupplierDetails(s)}>
                     <div className="compact-card-left">
                        <span style={{ fontWeight: 'bold', color: '#94a3b8', fontSize: '14px', minWidth: '22px' }}>{index + 1}.</span>
                        <div className="compact-text-group">
                           <div className="compact-title">🏢 {s.name}</div>
                           <div className="compact-sub">{s.phone || 'No phone'}</div>
                        </div>
                     </div>
                     <div className="compact-card-right">
                        <div className="compact-debt" style={{ color: Number(s.total_owed_riel) > 0 ? '#ef4444' : '#10b981' }}>
                           {formatRiel(s.total_owed_riel || 0)}
                        </div>
                     </div>
                 </div>
             ))
           )}
        </div>
        </React.Fragment>
      )}

      {/* === GLOBAL MODALS === */}

      {/* 📱 1. MOBILE PRODUCT CONTROL CENTER MODAL */}
      <Modal 
        isOpen={!!mobileEditProduct} 
        onClose={() => { setMobileEditProduct(null); setEdits(prev => { const n = { ...prev }; if(mobileEditProduct) delete n[mobileEditProduct.id]; return n; }); }} 
        title={`Control: ${mobileEditProduct?.name || ''}`} 
        maxWidth="400px"
      >
        {mobileEditProduct && (() => {
            const p = mobileEditProduct; 

            const wpList = products.filter(wp => wp.weight > 1);
            const parentWp = p.linked_wholesale_id ? wpList.find(x => x.id === p.linked_wholesale_id) : null;
            
            // Extract the active batches for this specific product
            const mBatches = activeBatchesMap[p.id] || [];
            mBatches.sort((a,b) => a.id - b.id);

            // 🔥 MOBILE COGS FIX: Dynamically calculate the Cost Price from the parent bag!
            let displayCostPrice = edits[p.id]?.cost_price ?? p.cost_price;
            let isCogsLinked = false;
            
            if (activeView === 'retail' && parentWp) {
               const parentBatches = activeBatchesMap[parentWp.id] || [];
               parentBatches.sort((a,b) => a.id - b.id);
               const liveParentCogs = parentBatches.length > 0 ? parentBatches[0].cost_price : (parentWp.cost_price || 0);
               const parentWeight = parentWp.weight || 50;
               displayCostPrice = Math.round(liveParentCogs / parentWeight);
               isCogsLinked = true;
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* Action Buttons Hub (Only Import and History here) */}
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                   <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 12px 0' }}>⚡ Quick Actions</label>
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button className="saas-btn saas-btn-primary" onClick={() => { setMobileEditProduct(null); openImportModal(p); }}>📦 Import</button>
                      <button className="saas-btn saas-btn-secondary" onClick={() => { setMobileEditProduct(null); fetchHistory(p); }}>🕒 History</button>
                   </div>
                </div>

                {/* Edit Inputs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Selling Price (៛)</label>
                    <input 
                      type="number"
                      className="saas-input no-spinners" 
                      value={edits[p.id]?.price ?? p.price} 
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : Number(e.target.value);
                        setEdits(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), price: val as any } }));
                      }} 
                    />
                  </div>
                  <div>
                    <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0', color: isCogsLinked ? '#b58a3d' : 'inherit' }}>
                      {isCogsLinked ? 'Cost Price (Auto-Linked 🔗)' : 'Cost Price (៛)'}
                    </label>
                    <input 
                      type="number"
                      disabled={isCogsLinked}
                      className="saas-input no-spinners" 
                      value={displayCostPrice} 
                      style={{ backgroundColor: isCogsLinked ? '#f8fafc' : '#ffffff', color: isCogsLinked ? '#64748b' : '#0f172a' }}
                      onChange={(e) => {
                        if (isCogsLinked) return; // Prevent edits if it is dynamically linked
                        const val = e.target.value === '' ? '' : Number(e.target.value);
                        setEdits(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), cost_price: val as any } }));
                      }} 
                    />
                  </div>

                  {/* 🔥 ALL ACTIVE BATCHES INFO */}
                  {activeView === 'wholesale' && mBatches.length > 0 && (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                       {mBatches.map((batch, idx) => {
                         const label = idx === 0 ? '🟢 Active 1st Batch' : idx === 1 ? '🟡 2nd Batch' : `⚪ ${idx + 1}th Batch`;
                         const bgColor = idx === 0 ? '#f0fdf4' : '#f8fafc';
                         const borderColor = idx === 0 ? '#bbf7d0' : '#e2e8f0';
                         const titleColor = idx === 0 ? '#166534' : '#475569';
                         const valColor = idx === 0 ? '#15803d' : '#334155';

                         return (
                           <div key={batch.id} style={{ background: bgColor, padding: '12px 16px', borderRadius: '8px', border: `1px solid ${borderColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                 <div style={{ fontSize: '11px', color: titleColor, fontWeight: 'bold', textTransform: 'uppercase' }}>{label}</div>
                                 <div style={{ fontSize: '15px', color: valColor, fontWeight: 'bold', marginTop: '4px' }}>{batch.remaining_qty} Bags Left</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                 <div style={{ fontSize: '11px', color: titleColor, textTransform: 'uppercase' }}>Batch COGS</div>
                                 <div style={{ fontSize: '15px', color: valColor, fontWeight: 'bold', marginTop: '4px' }}>{formatRiel(Number(batch.cost_price))}</div>
                              </div>
                           </div>
                         )
                       })}
                     </div>
                  )}
                </div>

                {activeView === 'retail' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ position: 'relative' }}>
                      <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>🔗 Link to Wholesale Bag</label>
                      
                      {/* Trigger Button */}
                      <div className="interactive-select-trigger" onClick={() => { setIsMobileLinkDropdownOpen(true); setMobileLinkSearch(''); }} style={{ width: '100%', background: '#fff' }}>
                         {parentWp ? `🌾 ${parentWp.name}` : '🔍 Search & Link Wholesale Bag...'}
                      </div>

                      {/* 🔥 FULL-SCREEN PORTAL FOR BAG SEARCH (Like Search Customer) */}
                      {isMobileLinkDropdownOpen && typeof document !== 'undefined' && createPortal(
                        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', zIndex: 2147483647, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'max(16px, env(safe-area-inset-top, 16px)) 16px 16px 16px', backdropFilter: 'blur(2px)' }} onMouseDown={() => { setIsMobileLinkDropdownOpen(false); setMobileLinkSearch(''); }}>
                          <div 
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ backgroundColor: '#f8fafc', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'posPopupSlideDown 0.2s ease-out' }}
                          >
                            {/* Search Header */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', gap: '8px', backgroundColor: '#ffffff', flexShrink: 0 }}>
                              <div style={{ position: 'relative', flex: 1 }}>
                                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '16px' }}>🔍</span>
                                <input 
                                  autoFocus
                                  type="text"
                                  placeholder="Search Wholesale bag..."
                                  value={mobileLinkSearch}
                                  onChange={e => setMobileLinkSearch(e.target.value)}
                                  style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: '14px', border: '1px solid #3b82f6', borderRadius: '6px', outline: 'none', color: '#0f172a', boxSizing: 'border-box' }}
                                />
                              </div>
                              <button onClick={(e) => { e.preventDefault(); setIsMobileLinkDropdownOpen(false); setMobileLinkSearch(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                ✕
                              </button>
                            </div>
                            
                            {/* Results List */}
                            <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: '#f8fafc' }}>
                              <button onClick={(e) => { e.preventDefault(); handleLinkWholesaleBag(p.id, null); setMobileEditProduct({...p, linked_wholesale_id: null}); setIsMobileLinkDropdownOpen(false); }} className="saas-btn" style={{ width: '100%', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', border: '1px dashed #fca5a5', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
                                ❌ Clear Linked Bag
                              </button>

                              {/* 🔥 OVERSELL FIX: Allow 0 stock bags to appear in mobile search */}
                              {wpList.filter(wp => wp.name.toLowerCase().includes(mobileLinkSearch.toLowerCase())).length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '14px' }}>No bags found</div>
                              ) : (
                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                                  {wpList.filter(wp => wp.name.toLowerCase().includes(mobileLinkSearch.toLowerCase()))
                                    .sort((a, b) => riceCategoryComparator(a, b, 'cost_price'))
                                    .map((wp, index, arr) => (
                                    <div 
                                      key={wp.id} 
                                      onClick={(e) => { e.preventDefault(); handleLinkWholesaleBag(p.id, wp); setMobileEditProduct({...p, linked_wholesale_id: wp.id}); setIsMobileLinkDropdownOpen(false); }} 
                                      style={{ padding: '12px 16px', cursor: 'pointer', backgroundColor: '#ffffff', borderBottom: index === arr.length - 1 ? 'none' : '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                    >
                                      <span style={{ fontWeight: 500, fontSize: '14px', color: '#0f172a' }}>{wp.name}</span>
                                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>Stock: {wp.stock} | <span style={{ fontWeight: 'normal' }}>{formatRiel(Number(wp.cost_price))} ៛</span></span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>

                    {/* 🔥 SIDE-BY-SIDE BUTTON ROW: Pull 1 Bag & Repack */}
                    {p.linked_wholesale_id && (
                      <div style={{ display: 'grid', gridTemplateColumns: (parentWp && Number(p.stock) >= Number(parentWp.weight)) ? '1fr 1fr' : '1fr', gap: '8px' }}>
                        <button 
                          className="saas-btn" 
                          style={{ background: '#f0fdf4', color: '#166534', padding: '10px 12px', fontSize: '13px', fontWeight: '600', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                          onClick={() => { 
                            setMobileEditProduct(null); 
                            handleManualPull(p.id, p.linked_wholesale_id!); 
                          }}
                        >
                          ♻️ Pull 1 Bag
                        </button>

                        {parentWp && Number(p.stock) >= Number(parentWp.weight) && (
                          <button 
                            className="saas-btn" 
                            style={{ background: '#f0fdf4', color: '#166534', padding: '10px 12px', fontSize: '13px', fontWeight: '600', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                            onClick={() => { 
                              setMobileEditProduct(null); 
                              setRepackModal({ isOpen: true, product: p }); 
                            }}
                          >
                            📦 Repack
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                   <button onClick={async () => {
                      if (!confirm('Are you sure you want to delete this product?')) return;
                      setIsProcessing(true);
                      await supabase.from('products').update({ is_archived: true }).eq('id', p.id).eq('branch_id', activeBranchId);
                      fetchProducts(); setMobileEditProduct(null); setIsProcessing(false); showToast('success', 'Deleted', 'Product safely removed.');
                   }} className="saas-btn" style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px' }}>🗑️ Delete</button>
                   
                   <div style={{ display: 'flex', gap: '8px' }}>
                     <button onClick={() => { setMobileEditProduct(null); setEdits(prev => { const n = { ...prev }; delete n[p.id]; return n; }); }} className="saas-btn saas-btn-secondary">Cancel</button>
                     <button onClick={async () => { await handleSaveRecord(p.id); setMobileEditProduct(null); }} className="saas-btn saas-btn-primary">Save</button>
                   </div>
                </div>
              </div>
            );
        })()}
      </Modal>

      {/* 📱 2. MOBILE PENDING PAYMENT ACTION MODAL */}
      <Modal isOpen={!!mobilePendingAction} onClose={() => setMobilePendingAction(null)} title="💳 Debt Options" maxWidth="400px">
        {mobilePendingAction && (
           <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px' }}>
                 <div style={{ marginBottom: '8px' }}>🏢 <b>{mobilePendingAction.imp.suppliers?.name}</b></div>
                 <div style={{ color: '#475569', marginBottom: '8px' }}>🌾 {mobilePendingAction.imp.products?.name} (x{mobilePendingAction.imp.qty})</div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Total Cost:</span> <b>{formatRiel(mobilePendingAction.imp.total_cost)}</b></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Paid So Far:</span> <b style={{color: '#10b981'}}>{formatRiel(mobilePendingAction.imp.paid_amount)}</b></div>
              </div>
              <div style={{ textAlign: 'center', background: '#fef2f2', padding: '16px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                 <div style={{ fontSize: '12px', color: '#991b1b', fontWeight: 'bold' }}>REMAINING DEBT</div>
                 <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>{formatRiel(mobilePendingAction.remaining)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                 <button className="saas-btn saas-btn-danger" onClick={() => { handleVoidImport(mobilePendingAction.imp.id); setMobilePendingAction(null); }}>❌ Void Record</button>
                 <button className="saas-btn saas-btn-secondary" onClick={() => { setEditImportModal({ isOpen: true, record: mobilePendingAction.imp }); setEditImportForm({ qty: mobilePendingAction.imp.qty, unit_cost: mobilePendingAction.imp.unit_cost }); setMobilePendingAction(null); }}>✏️ Edit Import</button>
              </div>
              <button className="saas-btn saas-btn-primary" style={{ width: '100%', marginTop: '12px' }} onClick={() => { setPayPendingModal({ isOpen: true, record: mobilePendingAction.imp, totalDue: mobilePendingAction.remaining }); setPendingPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '' }]); setMobilePendingAction(null); }}>💸 Pay Now</button>
           </div>
        )}
      </Modal>

      {/* 📱 3. MOBILE EDIT SUPPLIER MODAL */}
      <Modal isOpen={!!mobileSupplierDetails} onClose={() => setMobileSupplierDetails(null)} title="🏢 Edit Supplier" maxWidth="400px">
        {mobileSupplierDetails && (
           <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '15px' }}>
              <div>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Supplier Name</label>
                <input type="text" className="saas-input" value={mobileSupplierDetails.name} onChange={e => setMobileSupplierDetails({...mobileSupplierDetails, name: e.target.value})} />
              </div>
              <div>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Phone Number</label>
                <input type="text" className="saas-input" value={mobileSupplierDetails.phone || ''} onChange={e => setMobileSupplierDetails({...mobileSupplierDetails, phone: e.target.value})} />
              </div>
              <div>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Location</label>
                <input type="text" className="saas-input" value={mobileSupplierDetails.location || ''} onChange={e => setMobileSupplierDetails({...mobileSupplierDetails, location: e.target.value})} />
              </div>
              
              <div style={{ background: Number(mobileSupplierDetails.total_owed_riel) > 0 ? '#fef2f2' : '#f0fdf4', padding: '16px', borderRadius: '8px', textAlign: 'center', marginTop: '8px' }}>
                 <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>TOTAL DEBT OWED</div>
                 <div style={{ fontSize: '24px', fontWeight: 'bold', color: Number(mobileSupplierDetails.total_owed_riel) > 0 ? '#dc2626' : '#15803d' }}>
                    {formatRiel(mobileSupplierDetails.total_owed_riel || 0)}
                 </div>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                 <button onClick={async () => {
                    if (!confirm('Are you sure you want to delete this supplier?')) return;
                    setIsProcessing(true);
                    await supabase.from('suppliers').update({ is_archived: true }).eq('id', mobileSupplierDetails.id).eq('branch_id', activeBranchId);
                    fetchSuppliers(); setMobileSupplierDetails(null); setIsProcessing(false); showToast('success', 'Deleted', 'Supplier archived.');
                 }} className="saas-btn" style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px' }}>🗑️ Delete</button>
                 
                 <div style={{ display: 'flex', gap: '8px' }}>
                   <button onClick={() => setMobileSupplierDetails(null)} className="saas-btn saas-btn-secondary">Cancel</button>
                   <button onClick={async () => {
                      setIsProcessing(true);
                      await supabase.from('suppliers').update({ name: mobileSupplierDetails.name, phone: mobileSupplierDetails.phone, location: mobileSupplierDetails.location }).eq('id', mobileSupplierDetails.id).eq('branch_id', activeBranchId);
                      fetchSuppliers(); setMobileSupplierDetails(null); setIsProcessing(false); showToast('success', 'Saved', 'Supplier details updated.');
                   }} className="saas-btn saas-btn-primary">Save Changes</button>
                 </div>
              </div>
           </div>
        )}
      </Modal>

      {/* SETTLE SUPPLIER BILL MODAL */}
      <Modal isOpen={payPendingModal.isOpen && !!payPendingModal.record} onClose={() => setPayPendingModal({ isOpen: false, record: null, totalDue: 0 })} title="💸 Settle Supplier Bill" maxWidth="450px">
        <p style={{ margin: '0 0 16px 0', color: '#475569', fontSize: '14px' }}>Paying: <b>{payPendingModal.record?.suppliers?.name}</b></p>
        
        <div style={{ background: '#fef2f2', padding: '16px', borderRadius: '8px', border: '1px solid #fecaca', marginBottom: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#991b1b', fontWeight: 'bold', textTransform: 'uppercase' }}>Remaining Debt</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>
            {formatRiel(payPendingModal.totalDue)}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <label className="saas-card-title" style={{ margin: 0 }}>Payment Method(s)</label>
            <button onClick={() => setPendingPaymentRows([...pendingPaymentRows, { id: Date.now(), method: 'Cash ៛', amount: '' }])} className="saas-btn" style={{ background: '#e0f2fe', color: '#0284c7', padding: '6px 10px', fontSize: '12px' }}>+ Split</button>
          </div>

          {pendingPaymentRows.map((row, index) => (
            <div key={row.id} style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
              <select 
                value={row.method} 
                onChange={e => {
                  const newRows = [...pendingPaymentRows];
                  newRows[index].method = e.target.value;
                  setPendingPaymentRows(newRows);
                }}
                className="saas-input"
                style={{ width: '45%', cursor: 'pointer' }}
              >
                <option value="Cash ៛">💵 Cash ៛</option>
                <option value="Cash $">💵 Cash $</option>
                <option value="QR ៛">📱 QR ៛</option>
                <option value="QR $">📱 QR $</option>
                <option value="Mom QR ៛">👩 Mom QR ៛</option>
                <option value="Mom QR $">👩 Mom QR $</option>
              </select>
              
              <div style={{ flex: 1 }}>
                <CurrencyInput 
                  placeholder="" 
                  value={row.amount} 
                  onChange={(val: any) => {
                    const newRows = [...pendingPaymentRows];
                    newRows[index].amount = val;
                    setPendingPaymentRows(newRows);
                  }}
                  onEnter={handlePayPendingSubmit}
                  className="saas-input"
                  style={{ textAlign: 'right' }}
                />
              </div>
              
              {pendingPaymentRows.length > 1 && (
                <button onClick={() => setPendingPaymentRows(pendingPaymentRows.filter(r => r.id !== row.id))} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '18px', cursor: 'pointer', padding: '0 4px', fontWeight: 'bold' }}>✕</button>
              )}
            </div>
          ))}
        </div>

        {pendingPaymentRows.some(r => Number(r.amount) > 0) && (
          <div style={{ marginBottom: '24px', paddingTop: '16px', borderTop: '1px dashed #cbd5e1', fontSize: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#64748b' }}>Total Processed:</span>
              <span style={{ color: '#334155', fontWeight: 'bold' }}>{formatRiel(liveTotalPendingReceived)}</span>
            </div>
            {livePendingRemaining < 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#ef4444' }}>Overpaid By:</span>
                <span style={{ color: '#dc2626', fontWeight: 'bold' }}>{formatRiel(Math.abs(livePendingRemaining))}</span>
              </div>
            ) : livePendingRemaining > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#d97706' }}>Still Owes:</span>
                <span style={{ color: '#b45309', fontWeight: 'bold' }}>{formatRiel(livePendingRemaining)}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#166534' }}>Balance:</span>
                <span style={{ color: '#15803d', fontWeight: 'bold' }}>Perfectly Cleared ✅</span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setPayPendingModal({ isOpen: false, record: null, totalDue: 0 })} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handlePayPendingSubmit} disabled={isProcessing} className="saas-btn saas-btn-primary">
            {isProcessing ? 'Processing...' : 'Confirm Payment'}
          </button>
        </div>
      </Modal>

      {/* DUAL-VIEW HISTORY MODAL WITH AUTOMATED VOID FEATURE */}
      <Modal isOpen={historyModal.isOpen && !!historyModal.product} onClose={() => setHistoryModal({ isOpen: false, product: null, data: [], activeBatches: [] })} title="📦 Batch & Import History" maxWidth="600px">
        <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '14px' }}>Tracking: <b style={{ color: '#0f172a' }}>{historyModal.product?.name}</b></p>
        
        <div style={{ overflowY: 'auto', flex: 1, paddingRight: '8px', maxHeight: '50vh' }}>
          
          {/* SECTION 1: Shelved Batches (HSR Toggle View) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 className="saas-card-title" style={{ margin: 0 }}>{showHiddenBatches ? '🙈 Hidden / Depleted Archive' : '🟢 Active Batches on Shelf'}</h3>
            <div style={{ background: '#f1f5f9', padding: '4px', borderRadius: '8px', display: 'flex', gap: '4px' }}>
              <button onClick={() => setShowHiddenBatches(false)} style={{ padding: '6px 12px', fontSize: '12px', background: !showHiddenBatches ? '#ffffff' : 'transparent', color: !showHiddenBatches ? '#0f172a' : '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: !showHiddenBatches ? 'bold' : 'normal', boxShadow: !showHiddenBatches ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Active</button>
              <button onClick={() => setShowHiddenBatches(true)} style={{ padding: '6px 12px', fontSize: '12px', background: showHiddenBatches ? '#ffffff' : 'transparent', color: showHiddenBatches ? '#0f172a' : '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: showHiddenBatches ? 'bold' : 'normal', boxShadow: showHiddenBatches ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Hidden</button>
            </div>
          </div>
          
          {(() => {
            const filteredBatches = historyModal.activeBatches.filter(b => !!(b as any).is_hidden === showHiddenBatches);
            if (filteredBatches.length === 0) {
              return <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '24px' }}>No {showHiddenBatches ? 'hidden' : 'active'} batches found.</p>;
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                {filteredBatches.map((b, index) => {
                  const isEditing = editingHistoryId === b.id;
                  const editData = historyEdits[b.id] || { remaining_qty: b.remaining_qty, cost_price: b.cost_price };
                  let batchLabel = showHiddenBatches ? 'Archived Batch' : (index === 0 ? '1st Batch (Current)' : index === 1 ? '2nd Batch' : `${index + 1}th Batch`);

                  return (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: showHiddenBatches ? '#f8fafc' : (index === 0 ? '#f0fdf4' : '#f8fafc'), border: isEditing ? '1px solid #b58a3d' : (showHiddenBatches ? '1px solid #cbd5e1' : (index === 0 ? '1px solid #bbf7d0' : '1px solid #e2e8f0')), borderRadius: '8px', transition: 'all 0.2s', opacity: showHiddenBatches ? 0.85 : 1 }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
                          <div style={{ flex: '1 1 80px' }}>
                            <label className="saas-card-title" style={{ fontSize: '11px', margin: '0 0 4px 0' }}>Remaining Qty</label>
                            <input autoFocus type="number" className="saas-input no-spinners" value={editData.remaining_qty} onChange={e => setHistoryEdits({...historyEdits, [b.id]: {...editData, remaining_qty: Number(e.target.value)}})} onKeyDown={e => e.key === 'Enter' && handleSaveHistory(b.id)} style={{ padding: '6px' }} />
                          </div>
                          <div style={{ flex: '1 1 100px' }}>
                            <label className="saas-card-title" style={{ fontSize: '11px', margin: '0 0 4px 0' }}>Cost (៛)</label>
                            <input type="number" className="saas-input no-spinners" value={editData.cost_price} onChange={e => setHistoryEdits({...historyEdits, [b.id]: {...editData, cost_price: Number(e.target.value)}})} onKeyDown={e => e.key === 'Enter' && handleSaveHistory(b.id)} style={{ padding: '6px' }} />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 'bold', color: showHiddenBatches ? '#475569' : (index === 0 ? '#15803d' : '#0f172a') }}>{batchLabel}</div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Arrived: {new Date((b as any).created_at).toLocaleDateString()}</div>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                        {!isEditing && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 'bold', color: showHiddenBatches ? '#64748b' : '#b58a3d', fontSize: '16px' }}>{b.remaining_qty} Bags {showHiddenBatches ? 'Logged' : 'Left'}</div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Cost: {formatRiel(b.cost_price)}</div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px', marginTop: isEditing ? '20px' : '8px' }}>
                          {isEditing ? (
                            <>
                              <button onClick={() => handleSaveHistory(b.id)} className="saas-btn saas-btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>Save</button>
                              <button onClick={() => setEditingHistoryId(null)} className="saas-btn saas-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Cancel</button>
                            </>
                          ) : (
                            <>
                              {/* 🔥 HSR MANUAL OVERRIDE TOGGLES */}
                              <button onClick={() => handleToggleBatchVisibility(b.id, !!(b as any).is_hidden)} className="saas-btn" style={{ padding: '4px 8px', background: (b as any).is_hidden ? '#e0f2fe' : '#fefcf3', color: (b as any).is_hidden ? '#0284c7' : '#b45309', fontSize: '12px', border: `1px solid ${(b as any).is_hidden ? '#bae6fd' : '#fde68a'}` }}>
                                {(b as any).is_hidden ? '👁️ Unhide' : '🙈 Hide'}
                              </button>
                              <button onClick={() => { setEditingHistoryId(b.id); setHistoryEdits({ [b.id]: { remaining_qty: b.remaining_qty, cost_price: b.cost_price } }); }} className="saas-btn" style={{ padding: '4px 8px', background: '#f8fafc', color: '#475569', fontSize: '12px', border: '1px solid #e2e8f0' }}>✏️ Edit</button>
                              <button onClick={() => handleDeleteHistory(b.id)} className="saas-btn" style={{ padding: '4px 8px', background: '#fee2e2', color: '#dc2626', fontSize: '12px', border: '1px solid #fecaca' }}>🗑️ Del</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* SECTION 2: Permanent Import Log (These never decrease) */}
          <h3 className="saas-card-title" style={{ marginBottom: '12px', paddingTop: '16px', borderTop: '2px dashed #e2e8f0' }}>📦 Permanent Invoice Log</h3>
          {historyModal.data.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '14px' }}>No import records found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {historyModal.data.map((h) => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
                   <div>
                     <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '4px', fontSize: '13px' }}>{new Date(h.created_at).toLocaleDateString()} at {new Date(h.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                     <div style={{ color: '#64748b', fontSize: '12px' }}>Supplier: <span style={{ color: '#334155', fontWeight: 'bold' }}>{h.suppliers?.name || 'Unknown'}</span></div>
                   </div>
                   <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                     <div>
                       <div style={{ fontWeight: 'bold', color: '#10b981', fontSize: '14px' }}>+{h.qty} Bags Imported</div>
                       <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>Paid: {formatRiel(h.unit_cost)} / bag</div>
                     </div>
                     <button 
                       onClick={() => handleVoidImport(h.id)}
                       disabled={isProcessing}
                       className="saas-btn saas-btn-danger"
                       style={{ padding: '4px 8px', fontSize: '11px' }}
                     >
                       ❌ Void
                     </button>
                   </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </Modal>

      {/* CONFIRM REPACK MODAL */}
      <Modal isOpen={repackModal.isOpen && !!repackModal.product} onClose={() => setRepackModal({ isOpen: false, product: null })} title="📦 Confirm Repack" maxWidth="400px">
        {repackModal.product && (() => {
            const wholesaleProd = products.find(wp => wp.id === repackModal.product?.linked_wholesale_id);
            const wWeight = wholesaleProd ? Number(wholesaleProd.weight) : 50;
            return (
              <>
                <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5' }}>
                  Are you sure you want to convert <b>{wWeight}kg</b> of loose <span style={{ color: '#b58a3d', fontWeight: 'bold' }}>{repackModal.product.name}</span> into 1 sealed wholesale bag of <span style={{ color: '#10b981', fontWeight: 'bold' }}>{wholesaleProd?.name}</span>?
                </p>
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '16px', fontSize: '13px', color: '#64748b' }}>
                  This action will:
                  <ul style={{ paddingLeft: '20px', marginTop: '8px', marginBottom: 0 }}>
                    <li>Deduct {wWeight}kg from Retail Stock</li>
                    <li>Add 1 Bag to Wholesale Stock</li>
                    <li>Log to Repack History</li>
                  </ul>
                </div>
                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button onClick={() => setRepackModal({ isOpen: false, product: null })} className="saas-btn saas-btn-secondary">Cancel</button>
                  <button onClick={handleConfirmRepack} disabled={isProcessing} className="saas-btn saas-btn-primary">{isProcessing ? 'Packing...' : 'Confirm Repack'}</button>
                </div>
              </>
            );
        })()}
      </Modal>

      {/* ADD SUPPLIER MODAL */}
      <Modal isOpen={isAddSupplierOpen} onClose={() => setIsAddSupplierOpen(false)} title="🏢 Add New Supplier" maxWidth="400px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Supplier Name</label>
            <input autoFocus placeholder="" value={newSupplier.name} onChange={e => setNewSupplier({...newSupplier, name: e.target.value})} className="saas-input" />
          </div>
          <div>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Phone Number (Optional)</label>
            <input value={newSupplier.phone} onChange={e => setNewSupplier({...newSupplier, phone: e.target.value})} className="saas-input" />
          </div>
          <div>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Location / Address (Optional)</label>
            <input value={newSupplier.location} onChange={e => setNewSupplier({...newSupplier, location: e.target.value})} className="saas-input" />
          </div>
        </div>
        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setIsAddSupplierOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleAddSupplier} disabled={isProcessing} className="saas-btn saas-btn-primary">Save Supplier</button>
        </div>
      </Modal>

      {/* FILTER MODAL */}
      <Modal isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)} title="Filter Records" icon="🔍" maxWidth="500px">
        {filterRules.map((rule, index) => (
          <div key={rule.id} style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
            <span style={{ fontSize: '13px', color: '#475569', width: '40px', fontWeight: 'bold' }}>{index === 0 ? 'Where' : 'And'}</span>
            <select value={rule.column} onChange={e => setFilterRules(prev => prev.map(r => r.id === rule.id ? { ...r, column: e.target.value as keyof Product } : r))} className="saas-input" style={{ flex: '1 1 100px', cursor: 'pointer', padding: '8px' }}>
              {DEFAULT_ORDER.filter(o => o !== 'linked_wholesale' && o !== 'actions' && o !== 'expand').map(c => <option key={c as string} value={c as string}>{String(c).toUpperCase()}</option>)}
            </select>
            <select value={rule.operator} onChange={e => setFilterRules(prev => prev.map(r => r.id === rule.id ? { ...r, operator: e.target.value as FilterOperator } : r))} className="saas-input" style={{ flex: '1 1 100px', cursor: 'pointer', padding: '8px' }}>
              <option value="contains">Contains</option>
              <option value="equals">Equals (=)</option>
              <option value="gt">Greater Than (&gt;)</option>
              <option value="lt">Less Than (&lt;)</option>
            </select>
            <input placeholder="" value={rule.value} onChange={e => setFilterRules(prev => prev.map(r => r.id === rule.id ? { ...r, value: e.target.value } : r))} className="saas-input no-spinners" style={{ flex: '1 1 120px', padding: '8px 12px' }} type={['price', 'cost_price', 'stock', 'weight'].includes(rule.column as string) ? 'number' : 'text'} />
            <button onClick={() => setFilterRules(prev => prev.filter(r => r.id !== rule.id))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>✕</button>
          </div>
        ))}
        
        <button onClick={() => setFilterRules(prev => [...prev, { id: Date.now(), column: 'name', operator: 'contains', value: '' }])} className="saas-btn" style={{ background: 'none', border: 'none', color: '#3b82f6', marginTop: '10px' }}>+ Add condition</button>

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setFilterRules([])} className="saas-btn saas-btn-secondary">Clear All</button>
          <button onClick={() => setIsFilterOpen(false)} className="saas-btn saas-btn-primary">Apply Filters</button>
        </div>
      </Modal>

      {/* NEW PRODUCT CREATION MODAL */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="📦 Add New Product" maxWidth="500px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Product Name</label>
            {activeView === 'import' && importForm.supplier_id ? (() => {
                const supName = suppliers.find(s => String(s.id) === String(importForm.supplier_id))?.name || '';
                return (
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input 
                      autoFocus 
                      placeholder="e.g. Malis 25kg" 
                      value={newItem.name} 
                      onChange={handleProductNameChange} 
                      className="saas-input" 
                      style={{ width: '100%', paddingRight: '120px' }} 
                    />
                    {/* 🔥 Visual Ghost Text without hyphen */}
                    <span style={{ position: 'absolute', right: '12px', color: '#94a3b8', fontSize: '14px', pointerEvents: 'none', fontWeight: 'bold' }}>
                      {supName}
                    </span>
                  </div>
                );
              })() : (
                <input autoFocus placeholder="e.g. Malis 25kg" value={newItem.name} onChange={handleProductNameChange} className="saas-input" style={{width:'100%'}}/>
              )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Selling Price (៛)</label>
              <CurrencyInput placeholder="0" value={newItem.price === 0 ? '' : newItem.price} onChange={(v:any) => setNewItem({...newItem, price: v})} className="saas-input" style={{width:'100%'}}/>
            </div>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Cost Price (៛)</label>
              <CurrencyInput placeholder="0" value={newItem.cost_price === 0 ? '' : newItem.cost_price} onChange={(v:any) => setNewItem({...newItem, cost_price: v})} className="saas-input" style={{width:'100%'}}/>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '8px' }}>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Weight (kg)</label>
              <input type="number" placeholder="50" className="saas-input no-spinners" value={newItem.weight} onChange={e => setNewItem({...newItem, weight: e.target.value})} />
            </div>
            <div>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Initial Stock</label>
              <input type="number" placeholder="0" className="saas-input no-spinners" value={newItem.stock} onChange={e => setNewItem({...newItem, stock: e.target.value})} />
            </div>
          </div>
          
          <div style={{ background: '#fef2f2', padding: '16px', borderRadius: '8px', border: '1px solid #fecaca' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#991b1b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>🚨 Min Stock Alert Level</label>
            <input type="number" className="saas-input no-spinners" value={newItem.min_stock_level} onChange={e => setNewItem({...newItem, min_stock_level: e.target.value})} style={{ borderColor: '#fca5a5' }} />
            <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px', marginBottom: 0 }}>Triggers a Restock Alert if current stock falls below this amount.</p>
          </div>
        </div>

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setIsAddModalOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={addProduct} className="saas-btn saas-btn-primary">Save Product</button>
        </div>
      </Modal>

      {/* ✏️ EDIT PENDING IMPORT MODAL */}
      <Modal isOpen={editImportModal.isOpen} onClose={() => setEditImportModal({ isOpen: false, record: null })} title="✏️ Edit Pending Import" maxWidth="400px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', color: '#475569' }}>
             This action will safely recalculate your Master Stock, Inventory Batch, and Supplier Debt.
          </div>
          <div>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Quantity Imported</label>
            <CurrencyInput
              autoFocus
              value={editImportForm.qty}
              onChange={(v: any) => setEditImportForm({ ...editImportForm, qty: v })}
              className="saas-input"
            />
          </div>
          <div>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Unit Cost (៛)</label>
            <CurrencyInput
              value={editImportForm.unit_cost}
              onChange={(v: any) => setEditImportForm({ ...editImportForm, unit_cost: v })}
              className="saas-input"
            />
          </div>
          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button onClick={() => setEditImportModal({ isOpen: false, record: null })} className="saas-btn saas-btn-secondary">Cancel</button>
            <button onClick={handleEditImportSubmit} disabled={isProcessing} className="saas-btn saas-btn-primary">
              {isProcessing ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* --- PAGE-SPECIFIC STYLES --- */}
      <style jsx global>{`
        input[type="number"].no-spinners::-webkit-inner-spin-button,
        input[type="number"].no-spinners::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"].no-spinners {
          -moz-appearance: textfield;
        }

        .fade-in {
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* 📱 RESPONSIVE CLASSES */
        .desktop-only-btn { display: block; }
        .mobile-only-btn { display: none !important; }
        .mobile-only-flex { display: none !important; }
        .hide-on-mobile { display: inline; }

        .mobile-action-row {
          display: flex;
          flex: 1;
          gap: 12px;
          align-items: center;
          min-width: 300px;
        }

        .header-container { 
          display: flex;
          justify-content: space-between; /* 🔥 Pushes title left and buttons right */
          align-items: center; 
          margin-bottom: 24px; 
          margin-top: 0;
          margin-left: 60px; /* Clears sidebar */
          gap: 12px;
          min-height: 48px; 
          width: calc(100% - 60px); /* Prevents horizontal scroll/overflow */
          max-width: 1600px;
          padding-right: 24px; /* Breathing room on the far right */
        }
        
        .header-left {
          display: flex;
          align-items: center; 
          gap: 12px;
        }

        .header-actions {
          display: flex;
          gap: 10px;
          margin-left: auto; /* 🔥 Hard-locks the buttons to the right */
        }

        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        .cell-display {
          padding: 16px 12px;
          font-size: 14px;
          min-height: 48px;
          cursor: text;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: flex;
          align-items: center;
        }
        .cell-input {
          width: 100%;
          height: 100%;
          padding: 0 12px; /* 🔥 Fixed massive box by removing excessive vertical padding */
          font-size: 14px; /* 🔥 Matched the normal surrounding text size */
          border: none;
          outline: 2px solid #b58a3d;
          box-shadow: 0 0 5px rgba(181, 138, 61, 0.3);
          background: #fff;
          position: absolute;
          top: 0;
          left: 0;
          z-index: 20;
          box-sizing: border-box;
          color: #0f172a;
        }
        .cell-editing {
          z-index: 20;
          position: relative;
        }

        .interactive-select-trigger {
          padding: 8px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background: #f8fafc;
          font-size: 14px;
          color: #334155;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: background 0.15s;
        }
        .interactive-select-trigger:hover {
          background: #edf2f7;
          border-color: #94a3b8;
        }
        .dropdown-search-input {
          width: 100%;
          padding: 10px 12px;
          border: 2px solid #b58a3d;
          border-radius: 6px;
          font-size: 16px;
          outline: none;
          box-sizing: border-box;
          color: #0f172a;
          background-color: #ffffff;
        }
        .dropdown-results-tray {
          position: absolute;
          top: 100%;
          left: 0px;
          right: 0px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
          max-height: 180px;
          overflow-y: auto;
          margin-top: 4px;
        }
        .dropdown-row {
          padding: 10px 16px;
          font-size: 14px;
          cursor: pointer;
          color: #0f172a;
          border-bottom: 1px solid #f1f5f9;
        }
        .dropdown-row:hover {
          background: #f1f5f9;
        }
        .clear-option {
          color: #ef4444;
          font-weight: bold;
          background: #fff5f5;
        }
        .clear-option:hover {
          background: #fee2e2;
        }

        /* 📱 ULTRA-COMPACT MOBILE LIST UI */
        .mobile-only-list {
           display: none;
           flex-direction: column;
           gap: 10px; /* Tighter gap */
           padding: 0 16px 24px 16px;
           overflow-y: auto;
           height: 100%;
        }
        .compact-card {
           background: #ffffff;
           border-radius: 10px;
           border: 1px solid #e2e8f0;
           box-shadow: 0 2px 4px rgba(0,0,0,0.02);
           padding: 14px 16px;
           display: flex;
           justify-content: space-between;
           align-items: center;
           cursor: pointer;
           transition: background 0.2s;
        }
        .compact-card:active { background: #f8fafc; }
        
        .compact-card-left {
           display: flex;
           align-items: center;
           gap: 12px;
           flex: 1;
           min-width: 0; 
        }
        .compact-card-right {
           display: flex;
           flex-direction: column;
           align-items: flex-end;
           gap: 4px;
           flex-shrink: 0;
           text-align: right;
        }
        .compact-text-group {
           display: flex;
           flex-direction: column;
           gap: 2px;
           min-width: 0;
        }
        .compact-title {
           font-weight: 700;
           font-size: 15px;
           color: #0f172a;
           white-space: nowrap;
           overflow: hidden;
           text-overflow: ellipsis;
        }
        .compact-sub {
           font-size: 12px;
           color: #64748b;
        }
        .compact-stock {
           font-weight: bold;
           font-size: 14px;
        }
        .compact-price {
           font-size: 13px;
           color: #334155;
        }
        .compact-debt {
           font-weight: bold;
           font-size: 15px;
           color: #dc2626;
        }
        .compact-date {
           font-size: 11px;
           color: #94a3b8;
        }
        .mobile-checkbox {
           width: 22px;
           height: 22px;
           accent-color: #b58a3d;
           margin: 0;
           cursor: pointer;
           flex-shrink: 0;
        }

        /* 🎨 THE PROFESSIONAL EDGE FADE MASK */
        .mask-fade-right {
           -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
           mask-image: linear-gradient(to right, black 85%, transparent 100%);
        }

        /* 🔥 MOBILE OVERRIDES */
        @media (max-width: 1023px) {
          .saas-table-wrapper { display: none !important; }
          .hide-on-mobile { display: none !important; }
          
          .mobile-only-list { display: flex !important; }
          .desktop-only-btn { display: none !important; }
          .mobile-only-btn { display: flex !important; }
          .mobile-only-flex { display: flex !important; }
          
          .mobile-action-row {
            display: flex;
            flex: 1;
            gap: 8px !important;
            align-items: center;
            min-width: 0 !important;
            justify-content: space-between;
          }

          .header-container { 
            margin-left: 54px !important; 
            margin-right: 0 !important;
            margin-bottom: 16px !important; 
            margin-top: 0 !important;
            display: flex !important;
            flex-direction: row !important; /* Reverts to original side-by-side format */
            justify-content: space-between !important;
            align-items: center !important; 
            height: auto !important;
            min-height: 44px !important;
            width: calc(100% - 54px) !important;
            padding-right: 16px !important;
          }

          .header-left {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 12px !important;
            flex: 1;
            min-width: 0;
          }

          .header-actions {
            display: flex;
            margin-left: 0 !important; 
          }

          .saas-page-title {
            /* Removed the 17px override so it perfectly matches the Business Dashboard */
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }
      `}</style>
    </div>
  );
}