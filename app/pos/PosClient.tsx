'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabaseClient'
import * as htmlToImage from 'html-to-image'
import { useFocusRefresh } from '@/lib/useFocusRefresh'
import { formatRiel, formatUSD, EXCHANGE_RATE } from '@/utils/formatters'
import { riceCategoryComparator } from '@/utils/riceSorter' // 👈 🔥 IMPORTED MASTER SORTER
import { CurrencyInput } from '@/components/Inputs'
import { Product, InventoryBatch, Customer } from '@/types'
import { useToast } from '@/components/ToastProvider'
import Modal from '@/components/Modal'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext' 
// 🔥 NEW DND-KIT IMPORTS
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TELEGRAM_CONFIG } from '@/lib/telegramConfig'

// --- LOCAL TYPES ---
interface CartItem extends Product {
  product_id: number
  quantity: number | ''
  custom_name: string
  custom_price_riel: number | ''
  isSpecial?: boolean
  isReturnFullBag?: boolean
  bypass_stock?: boolean
  add_loose_kg?: number
  loose_retail_id?: number | null
  sortOrder?: number
  selected_batch_id?: number | null
  db_row_id?: number
}

interface MixHistory {
  id: string
  time: string
  rice1Name: string
  rice1Ratio: number
  rice2Name: string
  rice2Ratio: number
  rice3Name?: string
  rice3Ratio?: number
  mixedCogs: number
  yieldStr: string
  bagUsed?: string       
  bagQty?: number        
  branch_id?: number 
  targetProductId?: number;
  targetBatchId?: number;
  yieldKg?: number;
  ingredients?: { id: number; qty: number; batchId?: number | null }[];
  bagId?: number;
}

const LOGO_LEFT_SRC = "/logo-left.png";
const LOGO_RIGHT_SRC = "/logo-right.png";
const WATERMARK_SRC = "/watermark.png";

const fetchImageAsBase64 = async (path: string): Promise<string> => {
  try {
    const absoluteUrl = new URL(path, window.location.origin).href;
    const res = await fetch(absoluteUrl);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    console.warn(`Base64 conversion failed for ${path}, using raw URL`);
    return path; 
  }
};

const RICE_CATEGORIES = ['🔥 Hot', 'All', 'មិញ', 'ខុន', 'ខ្ញី', 'ម្លិះ', 'រំដួល', 'សែនក្រអូប', '5451', 'បីកំណាត់', 'ដំណើប', 'សម្រូប', 'ផ្សេងៗ', '❌ Out of Stock'];
const MAIN_KEYWORDS = ['មិញ', 'ខុន', 'ខ្ញី', 'ម្លិះ', 'រំដួល', 'សែនក្រអូប', '54151', 'បីកំណាត់', 'ដំណើប', 'សម្រូប'];

const t: Record<'en' | 'kh', any> = {
  en: {
    title: "Point of Sales",
    retail: "🛍️ Retail (1kg)",
    wholesale: "🌾 Wholesale (50kg)",
    searchPlaceholder: "🔍 Search products...",
    selectCustomer: "🔍 Search Customer...",
    noProducts: "No products match selection filter",
    stock: "Stock",
    cartTitle: "🛒 Shopping Cart",
    emptyCart: "Cart is empty",
    unitPrice: "Unit Price",
    quantity: "Quantity",
    totalKhmer: "Total Due:",
    totalUsd: "Total in USD:",
    checkout: "Checkout",
    successTitle: "Invoice Ready",
    openInvoice: "Download Image",
    shareInvoice: "Share / Save",
    close: "Close Window",
    mobileModalTitle: "Adjust Item Properties",
    cancel: "Cancel",
    add: "Add to Cart"
  },
  kh: {
    title: "អង្គរ រេឌឌៀន រ៉ាយស៍",
    retail: "🛍️ លក់រាយ (1kg)",
    wholesale: "🌾 លក់ដុំ (50kg)",
    searchPlaceholder: "🔍 ស្វែងរកឈ្មោះទំនិញ...",
    selectCustomer: "🔍 ស្វែងរកអតិថិជនដុំ...",
    noProducts: "មិនមានទំនិញស្វែងរកឡើយ",
    stock: "ស្តុកសល់",
    cartTitle: "🛒 កន្ត្រកទំនិញ",
    emptyCart: "មិនមានទំនិញក្នុងកន្ត្រកឡើយ",
    unitPrice: "តម្លៃឯកតា",
    quantity: "បរិមាណ",
    totalKhmer: "សរុបរួម:",
    totalUsd: "សរុបជាដុល្លារ:",
    checkout: "ចាត់ចែងការទូទាត់",
    successTitle: "វិក្កយបត្រត្រូវបានបង្កើតជោគជ័យ!",
    openInvoice: "💾 ទាញយកវិក្កយបត្រ",
    shareInvoice: "📤 ចែករំលែក / រក្សាទុក",
    close: "បិទផ្ទាំង",
    mobileModalTitle: "កែសម្រួលព័ត៌មានទំនិញ",
    cancel: "បោះបង់",
    add: "បញ្ចូលទៅកន្ត្រក"
  }
}; // <-- 🔥 FIX: This properly closes the 't' object!

// 🔥 NEW: PROFESSIONAL SORTABLE ITEM COMPONENT
function SortableCategoryItem({ id, cat, lang }: { id: string, cat: string, lang: 'en' | 'kh' }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? '0 10px 25px rgba(0,0,0,0.15)' : 'none',
    display: 'flex', 
    alignItems: 'center', 
    padding: '12px', 
    background: '#f8fafc', 
    border: isDragging ? '1px solid #3b82f6' : '1px solid #e2e8f0', 
    borderRadius: '8px'
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* 🔥 THE HANDLE: Only the hamburger icon gets the drag listeners! */}
      <div {...attributes} {...listeners} style={{ marginRight: '16px', color: '#94a3b8', fontSize: '18px', display: 'flex', alignItems: 'center', cursor: 'grab', touchAction: 'none' }}>
        ☰
      </div>
      <span style={{ fontWeight: 'bold', color: '#334155', fontSize: '14px', userSelect: 'none' }}>
        {cat === 'All' ? (lang === 'kh' ? 'ទាំងអស់' : 'All') : cat}
      </span>
    </div>
  );
}

// 🔥 NEW: PROFESSIONAL SORTABLE HORIZONTAL TAB COMPONENT
function SortableHorizontalTab({ cat, isActive, lang, onClick }: { cat: string, isActive: boolean, lang: 'en' | 'kh', onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.85 : 1,
    borderRadius: '20px',
    minWidth: 'max-content',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    backgroundColor: isActive ? '#b58a3d' : '#ffffff',
    color: isActive ? '#ffffff' : '#334155',
    border: isActive ? '1px solid #b58a3d' : '1px solid #cbd5e1',
    boxShadow: isDragging ? '0 10px 25px rgba(0,0,0,0.15)' : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    cursor: isDragging ? 'grabbing' : 'pointer',
    touchAction: 'auto' // 🔥 FIX: Set to auto to restore native horizontal scrolling on mobile!
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`saas-tab ${isActive ? 'active' : ''}`}
      style={style}
    >
      {cat === 'All' ? (lang === 'kh' ? 'ទាំងអស់' : 'All') : cat}
    </button>
  );
}

// 🔥 FIX: THIS LINE WAS ACCIDENTALLY DELETED! IT STARTS YOUR ENTIRE PAGE COMPONENT!
export default function POSPage() {
  const { showToast } = useToast();
  // ✅ FIX: Added 'branches' here to pull the exact branch name for the notification
  const { activeBranchId, branches } = useBranch(); 
  const [isPosMounted, setIsPosMounted] = useState(false);

  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [productOrder, setProductOrder] = useState<number[]>([])
  const [activeBatches, setActiveBatches] = useState<Record<number, InventoryBatch[]>>({})
  const [mtdSalesStats, setMtdSalesStats] = useState<Record<number, number>>({})
  
  const [retailSubTab, setRetailSubTab] = useState<'active' | 'inactive'>('active')
  const [hiddenRetailIds, setHiddenRetailIds] = useState<number[]>([])

  const [invoiceImages, setInvoiceImages] = useState({ left: LOGO_LEFT_SRC, right: LOGO_RIGHT_SRC, watermark: WATERMARK_SRC });

  const [lang] = useState<'en' | 'kh'>('en')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'retail' | 'wholesale'>('retail')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [riceCategories, setRiceCategories] = useState<string[]>(RICE_CATEGORIES)
  const [isCategorySettingsOpen, setIsCategorySettingsOpen] = useState(false);
  const [isVisibilitySettingsOpen, setIsVisibilitySettingsOpen] = useState(false);
  const [visibilitySearch, setVisibilitySearch] = useState(''); // 🔥 NEW: Search state for the settings modal

  const EyeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
  const EyeOffIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 2 20 20" /><path d="M6.71 6.71A10.61 10.61 0 0 0 2 12s3 7 10 7a10.5 10.5 0 0 0 5.39-1.5M17.64 17.64A10.5 10.5 0 0 0 22 12s-3-7-10-7a10.5 10.5 0 0 0-2.43.28M12 15a3 3 0 0 1-2.95-2.5" />
    </svg>
  );

  // 🔥 TELEGRAM STOCK ALERT ENGINE
  const triggerStockAlert = async (productName: string = 'Unknown Product', currentStock: number = 0, minStockLevel: number = 0, weight: number = 50) => {
    // 🧠 HSR LOGIC: Spam filtering is now handled natively during the checkout loop.
    // Only alert if stock drops to or below the minimum threshold, or goes negative
    if (currentStock > minStockLevel && currentStock > 0) return;
    
    const dateStr = new Date().toLocaleString('en-GB');
    const branchName = activeBranchId === 0 ? "Global HQ" : branches?.find((b: any) => b.id === activeBranchId)?.name || "Unknown Branch";
    const productType = weight < 50 ? 'Retail' : 'Wholesale';
    
    // ✅ FIX: Formatted exactly to your spec without the redundant title header
    const message = `📅 Date: ${dateStr}\n🏬 Branch: *${activeBranchId} - ${branchName}*\n🌾 ${productType} Product: *${productName}*\n📦 Current Stock: *${currentStock}*`;

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

  // 🔥 NEW: PROFESSIONAL DND-KIT SENSORS & HANDLERS
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5, // Desktop: requires 5px of movement before drag starts (Instant feeling)
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

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRiceCategories((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        // 🛡️ ISOLATION FIX: Lock category reordering to the active branch
        const branchKey = activeBranchId === 0 ? 'category_order' : `category_order_${activeBranchId}`;
        supabase.from('app_settings').upsert(
          { setting_key: branchKey, setting_value: newOrder },
          { onConflict: 'setting_key' }
        ).then();
        
        return newOrder;
      });
    }
  };

  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDeviceMobile, setIsDeviceMobile] = useState(false)

  // 🟢 NEW: FULL SCREEN TAKEOVER & SEARCH STATE
  const [activeFullScreen, setActiveFullScreen] = useState<'none' | 'import' | 'mix'>('none');

  // 🟢 NEW: IMPORT STOCK STATES
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [importForm, setImportForm] = useState({ supplier_id: '', product_id: '', qty: '0', unit_cost: '0', paid_amount: '0', payment_method: 'Cash ៛' });
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isAddSupplierOpen, setIsAddSupplierOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '', location: '' });
  
  // 🟢 ADDED: CREATE NEW PRODUCT STATE
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  // 🔥 FIX: Added 'linked_wholesale_id' to state!
  const [newItem, setNewItem] = useState({ name: '', price: 0 as any, cost_price: 0 as any, weight: 50 as any, stock: 0 as any, min_stock_level: 10 as any, linked_wholesale_id: '' as any });

  // 🔥 NEW: Link Bag Search Portal States
  const [isLinkBagModalOpen, setIsLinkBagModalOpen] = useState(false);
  const [linkBagSearch, setLinkBagSearch] = useState('');

  // 🔥 ADDED: RETAIL SORT STATE
  const [retailPriceSort, setRetailPriceSort] = useState<'none' | 'asc' | 'desc'>('none');

  // 🟢 NEW: MIX RICE STATES
  const [rice1Id, setRice1Id] = useState<string>('');
  const [rice1Qty, setRice1Qty] = useState<number | ''>('');
  const [rice1BatchId, setRice1BatchId] = useState<number | null>(null);
  const [rice2Id, setRice2Id] = useState<string>('');
  const [rice2Qty, setRice2Qty] = useState<number | ''>('');
  const [rice2BatchId, setRice2BatchId] = useState<number | null>(null);
  const [showThirdRice, setShowThirdRice] = useState(false);
  const [rice3Id, setRice3Id] = useState<string>('');
  const [rice3Qty, setRice3Qty] = useState<number | ''>('');
  const [rice3BatchId, setRice3BatchId] = useState<number | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<'rice1' | 'rice2' | 'rice3' | 'target' | 'bag' | null>(null);
  const [mixDropdownSearch, setMixDropdownSearch] = useState('');
  const [dropdownTab, setDropdownTab] = useState<'wholesale' | 'retail'>('wholesale');
  const [calcResult, setCalcResult] = useState<{ blendedCogsPerKg: number, totalYieldKg: number, totalCost: number } | null>(null);
  const [syncMode, setSyncMode] = useState<'none' | 'existing' | 'new'>('none');
  const [targetProductId, setTargetProductId] = useState<string>('');
  const [bagId, setBagId] = useState<string>('');
  const [bagQty, setBagQty] = useState<number | ''>('');
  const [newMixName, setNewMixName] = useState('');
  const [newMixPrice, setNewMixPrice] = useState<number | ''>(0);
  const [newMixType, setNewMixType] = useState<'wholesale' | 'half' | 'retail'>('wholesale');
  const [globalHistory, setGlobalHistory] = useState<MixHistory[]>([]);
  const [mixHistory, setMixHistory] = useState<MixHistory[]>([]);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [historyEdits, setHistoryEdits] = useState<Record<string, { yieldKg: number, mixedCogs: number }>>({});

  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false) 

  const [cartCustomerNameOverride, setCartCustomerNameOverride] = useState('')
  const [cartCustomerLocationOverride, setCartCustomerLocationOverride] = useState('')
  const [cartCustomerMapOverride, setCartCustomerMapOverride] = useState('')
  const [cartCustomerPhoneOverride, setCartCustomerPhoneOverride] = useState('')
  
  const [isCartCustomerEditOpen, setIsCartCustomerEditOpen] = useState(false)
  const [cartCustomerEditForm, setCartCustomerEditForm] = useState({ name: '', phone: '', location: '', google_map: '' })

  const [paymentRows, setPaymentRows] = useState<{id: number, method: string, amount: number | '', isAuto?: boolean}[]>([
    { id: Date.now(), method: 'Cash ៛', amount: '', isAuto: true }
  ]);

  const [isCreateCustomerModalOpen, setIsCreateCustomerModalOpen] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', location: '', owner: '', type: '' })

  const [selectedMobileProduct, setSelectedMobileProduct] = useState<any>(null)
  const [mobilePrice, setMobilePrice] = useState<number | ''>('')
  const [mobileQty, setMobileQty] = useState<number | ''>('')
  const [mobileName, setMobileName] = useState<string>('')
  // 🔥 NEW: States for the Mobile Batch Popup Modal
  const [mobileBatchId, setMobileBatchId] = useState<number | null>(null)
  const [isMobileBatchModalOpen, setIsMobileBatchModalOpen] = useState(false)
  const [mobileBagId, setMobileBagId] = useState<number | null>(null) 
  const [mobileBagQty, setMobileBagQty] = useState<number | ''>(1) 
  const [mobileBagPrice, setMobileBagPrice] = useState<number | ''>('') // 🔥 NEW: Track dynamic bag price
  const [isMobileBagModalOpen, setIsMobileBagModalOpen] = useState(false) 
  const [mobileBagCoveredByDepot, setMobileBagCoveredByDepot] = useState(false) 
  const mobileQtyRef = useRef<any>(null)

  const [exchangeModal, setExchangeModal] = useState<{ isOpen: boolean, product: Product | null, consumedKg: string | number }>({
    isOpen: false, product: null, consumedKg: ''
  })
  
  const [adjustmentModal, setAdjustmentModal] = useState<{
    isOpen: boolean, type: 'discount' | 'deposit' | 'bag' | null,
    amount: number | string, qty: number | string, note: string,
    isCoveredByDepot: boolean, selectedBagName: string, isBagMenuOpen?: boolean
  }>({
    isOpen: false, type: null, amount: '', qty: 1, note: '',
    isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false
  });

  const [showAdjustmentMenu, setShowAdjustmentMenu] = useState(false);
  
  // 🔥 FIX: Added preCheckoutStock to remember the exact old stock & COGS before the new bag is opened
  const [autoOpenModal, setAutoOpenModal] = useState<{ isOpen: boolean, items: (Product & { bags_needed: number })[], preCheckoutStock?: Record<number, { stock: number, cost_price: number }> }>({ isOpen: false, items: [] });
  
  const [repackSubstitutes, setRepackSubstitutes] = useState<Record<number, number>>({});
  const [repackSearch, setRepackSearch] = useState<Record<number, string>>({});
  const [repackMenuOpen, setRepackMenuOpen] = useState<Record<number, boolean>>({});
  // 🔥 ADDED: Tracks which cart item has its custom batch dropdown open
  const [openBatchMenuId, setOpenBatchMenuId] = useState<number | null>(null);

  const [saleSummary, setSaleSummary] = useState<{ total: number, receivedRiel: number, receivedUsd: number, totalReceivedInRiel: number, change: number, type?: 'retail' | 'wholesale', isCashless?: boolean, items?: any[], isDebt?: boolean } | null>(null)
  const [showInvoicePreview, setShowInvoicePreview] = useState(false)
  const [completedSale, setCompletedSale] = useState<any>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  
  const invoiceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsPosMounted(true);
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.get('edit')) {
        // 🔥 SECURITY FIX: Isolate local storage to prevent ghost carts bleeding across branches
        const savedCart = localStorage.getItem(`pos_cart_${activeBranchId}`);
        if (savedCart) setCart(JSON.parse(savedCart)); else setCart([]);
        
        const savedCust = localStorage.getItem(`pos_customer_${activeBranchId}`);
        if (savedCust) setSelectedCustomerId(savedCust); else setSelectedCustomerId('');

        const savedOverride = localStorage.getItem(`pos_override_${activeBranchId}`);
        if (savedOverride) setCartCustomerNameOverride(savedOverride); else setCartCustomerNameOverride('');
        
        const savedTab = localStorage.getItem(`pos_tab_${activeBranchId}`);
        if (savedTab) setActiveTab(savedTab as 'retail' | 'wholesale'); else setActiveTab('retail');

        const savedSort = localStorage.getItem(`pos_retail_price_sort_${activeBranchId}`);
        if (savedSort) setRetailPriceSort(savedSort as any); else setRetailPriceSort('none');
      }
    } catch (e) { console.error('Error loading POS state', e) }
  }, [activeBranchId]); // Relies on activeBranchId to dynamically swap memory banks

  useEffect(() => {
    if (isPosMounted && !editingInvoiceId) {
      localStorage.setItem(`pos_cart_${activeBranchId}`, JSON.stringify(cart));
      localStorage.setItem(`pos_customer_${activeBranchId}`, selectedCustomerId);
      localStorage.setItem(`pos_override_${activeBranchId}`, cartCustomerNameOverride);
      localStorage.setItem(`pos_tab_${activeBranchId}`, activeTab);
      localStorage.setItem(`pos_retail_price_sort_${activeBranchId}`, retailPriceSort);
    }
  }, [cart, selectedCustomerId, cartCustomerNameOverride, activeTab, retailPriceSort, isPosMounted, editingInvoiceId, activeBranchId]);

  // 🔥 PERFORMANCE FIX: Cache the heavy reduce loop so it only runs when the cart actually changes
  const totalRiel = React.useMemo(() => {
    return cart.reduce((sum, item) => {
      const isNegativeItem = 
        item.custom_name.includes('ដូរ') || 
        item.custom_name.includes('បញ្ចុះតម្លៃ') || 
        item.custom_name.includes('កក់');
        
      const price = Number(item.custom_price_riel) || 0;
      const qty = Number(item.quantity) || 0;
      const itemTotal = price * qty;
      return isNegativeItem ? sum - Math.abs(itemTotal) : sum + itemTotal;
    }, 0);
  }, [cart]);

  const totalUSD = React.useMemo(() => totalRiel / EXCHANGE_RATE, [totalRiel]); 

  const isCartValid = React.useMemo(() => cart.length > 0 && cart.every(item => 
    item.quantity !== '' && Number(item.quantity) > 0 && 
    item.custom_price_riel !== '' && Number(item.custom_price_riel) >= 0
  ), [cart]);

  useEffect(() => {
    const loadImages = async () => {
      const leftB64 = await fetchImageAsBase64(LOGO_LEFT_SRC);
      const rightB64 = await fetchImageAsBase64(LOGO_RIGHT_SRC);
      const waterB64 = await fetchImageAsBase64(WATERMARK_SRC);
      setInvoiceImages({ left: leftB64, right: rightB64, watermark: waterB64 });
    };
    loadImages();
  }, []);

  useEffect(() => {
    setPaymentRows(prev => {
      if (prev.length === 1 && prev[0].isAuto) {
        const newAmount = totalRiel === 0 ? '' : totalRiel;
        if (prev[0].amount !== newAmount) {
          return [{ ...prev[0], amount: newAmount }];
        }
      }
      return prev;
    });
  }, [totalRiel]);

  useEffect(() => {
    if (saleSummary) {
      const timer = setTimeout(() => {
        setSaleSummary(null);
        setCompletedSale(null);
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [saleSummary]);

  useEffect(() => {
    if (showInvoicePreview) {
      const timer = setTimeout(() => {
        setShowInvoicePreview(false);
        setCompletedSale(null);
        setPreviewImageUrl(null);
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [showInvoicePreview]);

  useEffect(() => {
    const checkDeviceType = () => {
      const isMobileBrowser = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isSmallScreen = window.innerWidth < 1024;
      setIsDeviceMobile(isMobileBrowser || isSmallScreen);
    };

    checkDeviceType();
    window.addEventListener('resize', checkDeviceType);

    // 🟢 CAPTURE URL FIRST BEFORE ANYTHING ELSE WIPES IT
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');

    // 💣 SECURITY WIPE: Only destroy active carts if we are NOT loading an edit session
    if (!editId) {
      setCart([]);
      setSelectedCustomerId('');
      setCartCustomerNameOverride('');
      setPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '', isAuto: true }]);
      setEditingInvoiceId(null);
      setActiveFullScreen('none');
    }

    const stabilizeConnection = async () => {
      try {
        await loadProductsAndSettings()
        await loadCustomers()
        await loadBatches()
        await loadMtdSales()
        await loadSuppliers()
        await loadMixHistory()

        if (editId) {
          setEditingInvoiceId(editId);
          
          // 🔥 DETECT IF THIS IS A RETAIL OR WHOLESALE INVOICE
          const isRetailEdit = editId.startsWith('RET-') || editId.startsWith('ret-');
          setActiveTab(isRetailEdit ? 'retail' : 'wholesale'); 
          
          const targetTable = isRetailEdit ? 'retail_sales' : 'sales';
          const targetColumn = isRetailEdit ? 'transaction_id' : 'invoice_id';

          const { data: saleRows } = await supabase.from(targetTable).select('*').eq(targetColumn, editId).eq('branch_id', activeBranchId);
          
          if (saleRows && saleRows.length > 0) {
            const rebuiltCart = saleRows.map((row: any, index: number) => { // 🔥 ADDED INDEX
              const isSpecialRow = (row.custom_rice_type || row.rice_type).includes('ដូរ') || (row.custom_rice_type || row.rice_type).includes('បានប្រើ') || (row.custom_rice_type || row.rice_type).includes('បញ្ចុះតម្លៃ') || (row.custom_rice_type || row.rice_type).includes('កក់') || (row.custom_rice_type || row.rice_type).includes('ថ្លៃបាវ') || (row.custom_rice_type || row.rice_type).includes('បាវ');
              
              // 🔥 Chronological sorting to rebuild old invoices perfectly paired
              let sortOrder = Date.now() + index; 
              if ((row.custom_rice_type || row.rice_type).includes('ដូរ')) sortOrder = -9999999999999 + index; 
              if ((row.custom_rice_type || row.rice_type).includes('បានប្រើ')) sortOrder = -9999999999990 + index;
              if ((row.custom_rice_type || row.rice_type).includes('បញ្ចុះតម្លៃ') || (row.custom_rice_type || row.rice_type).includes('កក់')) sortOrder = 9999999999999 + index; 

              return {
                id: row.id,
                db_row_id: row.id,
                product_id: row.product_id, 
                name: row.rice_type, 
                custom_name: row.custom_rice_type || row.rice_type, 
                custom_price_riel: Number(row.price_per_bag || 0),
                quantity: Number(row.qty),
                cost_price: Number(row.cogs_price || 0),
                stock: 0, 
                price: Number(row.price_per_bag || 0),
                weight: 50,
                isSpecial: isSpecialRow,
                bypass_stock: isSpecialRow,
                sortOrder: sortOrder,
                selected_batch_id: null
              };
            });
            
            setCart(rebuiltCart);

            const cName = saleRows[0].customer_name;
            if (cName && cName !== 'Walk-in' && cName !== 'Walk in') {
              setCartCustomerNameOverride(cName); // Instantly show original name in UI
              const { data: custData } = await supabase.from('customers').select('id').eq('name', cName).limit(1);
              if (custData && custData.length > 0) {
                setSelectedCustomerId(custData[0].id.toString());
              }
            }
          }
        }
      } catch (err) {
        console.warn("Supabase network polling retrying silently...", err)
      }
    }
    
    stabilizeConnection()

    // 📡 WEBSOCKET ISOLATION: Append branch ID to prevent cross-tenant refresh chatter
    const posProductsChannel = supabase.channel(`pos-products-update-${activeBranchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => loadProductsAndSettings())
      .subscribe();

    const posBatchesChannel = supabase.channel(`pos-batches-update-${activeBranchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_batches' }, () => loadBatches())
      .subscribe();

    return () => {
      window.removeEventListener('resize', checkDeviceType);
      supabase.removeChannel(posProductsChannel);
      supabase.removeChannel(posBatchesChannel);
    };
  }, [activeBranchId])

  useEffect(() => {
    if (selectedCustomer) {
      setCartCustomerNameOverride(selectedCustomer.name || '');
      setCartCustomerPhoneOverride(selectedCustomer.phone || '');
      setCartCustomerLocationOverride(selectedCustomer.location || '');
      setCartCustomerMapOverride((selectedCustomer as any).google_map || '');
    } else {
      setCartCustomerNameOverride('Walk-in');
      setCartCustomerLocationOverride('');
      setCartCustomerMapOverride('');
      setCartCustomerPhoneOverride('');
    }
  }, [selectedCustomerId, customers])

  // 🔥 PERFORMANCE FIX: Wrap in setTimeout so the tab switch renders instantly FIRST, then assigns the customer in the background.
  useEffect(() => {
    if (activeTab === 'wholesale' && !selectedCustomerId && customers.length > 0 && !editingInvoiceId) {
      const walkInCust = customers.find(c => c.name.toLowerCase() === 'walk-in' || c.name.toLowerCase() === 'walk in');
      if (walkInCust) setSelectedCustomerId(walkInCust.id.toString());
    }
  }, [activeTab, customers, editingInvoiceId])

  useEffect(() => {
    const handleVisibilityAndResize = () => {
      if (document.visibilityState === 'visible') {
        document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
        document.body.style.transform = 'scale(1)';
      }
    };

    window.addEventListener('resize', handleVisibilityAndResize);
    window.addEventListener('visibilitychange', handleVisibilityAndResize);
    window.addEventListener('orientationchange', handleVisibilityAndResize);
    window.addEventListener('pageshow', handleVisibilityAndResize);
    
    handleVisibilityAndResize();

    return () => {
      window.removeEventListener('resize', handleVisibilityAndResize);
      window.removeEventListener('visibilitychange', handleVisibilityAndResize);
      window.removeEventListener('orientationchange', handleVisibilityAndResize);
      window.removeEventListener('pageshow', handleVisibilityAndResize);
    };
  }, []);

  useEffect(() => {
    if (completedSale && invoiceRef.current && !previewImageUrl && showInvoicePreview) {
      const nodeToCapture = invoiceRef.current;

      const timer = setTimeout(async () => {
        if (!nodeToCapture) return;

        try {
          await document.fonts.ready;
          await new Promise(r => setTimeout(r, 800));

          const isMobile = window.innerWidth < 1024;
          
          if (isMobile) {
            await htmlToImage.toPng(nodeToCapture, { 
              pixelRatio: 1, 
              backgroundColor: '#ffffff', 
              skipAutoScale: true, 
              cacheBust: true 
            });
          }
          
          const dataUrl = await htmlToImage.toPng(nodeToCapture, { 
            pixelRatio: 3, 
            backgroundColor: '#ffffff',
            skipAutoScale: true,
            cacheBust: true
          });
          
          setPreviewImageUrl(dataUrl);
          setIsGeneratingPreview(false);
          executeAutoSaveOnly(dataUrl, completedSale.invoiceNo);
        } catch (error) {
          console.error("Preview generation failed:", error);
          setIsGeneratingPreview(false);
        }
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [completedSale, previewImageUrl, showInvoicePreview])

  const loadProductsAndSettings = useCallback(async () => {
    const { data: prodData } = await supabase.from('products').select('*').eq('is_archived', false).eq('branch_id', activeBranchId).order('id', { ascending: true })
    if (prodData) setProducts(prodData)
    
    // 🔥 SECURITY FIX: Isolate settings fetches to the active branch
    const orderKey = activeBranchId === 0 ? 'pos_product_order' : `pos_product_order_${activeBranchId}`;
    const hiddenKey = activeBranchId === 0 ? 'hidden_retail_ids' : `hidden_retail_ids_${activeBranchId}`;
    const catOrderKey = activeBranchId === 0 ? 'category_order' : `category_order_${activeBranchId}`;

    const { data: setObj } = await supabase.from('app_settings').select('*').eq('setting_key', orderKey).maybeSingle()
    if (setObj && setObj.setting_value) setProductOrder(setObj.setting_value)

    const { data: hiddenSet } = await supabase.from('app_settings').select('*').eq('setting_key', hiddenKey).maybeSingle()
    if (hiddenSet && hiddenSet.setting_value) setHiddenRetailIds(hiddenSet.setting_value)

    const { data: catOrderSet } = await supabase.from('app_settings').select('*').eq('setting_key', catOrderKey).maybeSingle();
    if (catOrderSet && catOrderSet.setting_value) {
      const savedCats = catOrderSet.setting_value;
      const missingCats = RICE_CATEGORIES.filter(c => !savedCats.includes(c)); 
      setRiceCategories([...savedCats, ...missingCats]);
    }
  }, [activeBranchId]);

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('*').eq('branch_id', activeBranchId).order('name', { ascending: true })
    setCustomers(data || [])
  }, [activeBranchId]);

  const loadBatches = useCallback(async () => {
    const { data } = await supabase.from('inventory_batches')
      .select('*')
      .eq('branch_id', activeBranchId)
      .eq('is_hidden', false) 
      .order('created_at', { ascending: true });

    if (data) {
      const batchMap: Record<number, InventoryBatch[]> = {};
      const batchesToHide: number[] = [];

      const rawMap: Record<number, any[]> = {};
      data.forEach((b: any) => {
        if (!rawMap[b.product_id]) rawMap[b.product_id] = [];
        rawMap[b.product_id].push(b);
      });

      Object.keys(rawMap).forEach(prodIdStr => {
        const prodId = Number(prodIdStr);
        const batches = rawMap[prodId];

        if (batches.length <= 1) {
           batchMap[prodId] = batches; 
           return;
        }

        let activeBatchIndex = 0;

        while (activeBatchIndex < batches.length - 1) {
           const currentBatch = batches[activeBatchIndex];
           const nextBatch = batches[activeBatchIndex + 1];
           
           if ((currentBatch.remaining_qty || 0) <= 0 && (nextBatch.remaining_qty || 0) > 0) {
              batchesToHide.push(currentBatch.id);
              activeBatchIndex++;
           } else {
              break;
           }
        }

        batchMap[prodId] = batches.slice(activeBatchIndex);
      });

      setActiveBatches(batchMap);

      if (batchesToHide.length > 0) {
        supabase.from('inventory_batches').update({ is_hidden: true }).in('id', batchesToHide).then();
      }
    }
  }, [activeBranchId]);

  const loadMtdSales = useCallback(async () => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const { data } = await supabase.from('sales').select('product_id, qty').gte('created_at', firstDay).eq('branch_id', activeBranchId);
    if (data) {
      const stats: Record<number, number> = {};
      data.forEach((s: any) => {
        stats[s.product_id] = (stats[s.product_id] || 0) + Number(s.qty);
      });
      setMtdSalesStats(stats);
    }
  }, [activeBranchId]);

  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase.from('suppliers').select('*').eq('is_archived', false).eq('branch_id', activeBranchId).order('name', { ascending: true })
    if (data) setSuppliers(data)
  }, [activeBranchId]);

  const loadMixHistory = useCallback(async () => {
    // 🔒 LEAK FIX: Read from isolated branch key instead of global!
    const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
    const { data } = await supabase.from('app_settings').select('setting_value').eq('setting_key', branchKey).maybeSingle()
    if (data && data.setting_value) {
      setGlobalHistory(data.setting_value);
      setMixHistory(data.setting_value);
    }
  }, [activeBranchId]);

  const loadAllData = useCallback(async () => {
    await Promise.all([
      loadProductsAndSettings(),
      loadCustomers(),
      loadBatches(),
      loadMtdSales(),
      loadSuppliers(),
      loadMixHistory()
    ]);
  }, [loadProductsAndSettings, loadCustomers, loadBatches, loadMtdSales, loadSuppliers, loadMixHistory]);

  // 🚀 Activate silent background updates
  useFocusRefresh(loadAllData);

  const formatRielSymbol = (amountInRiel: number) => `${new Intl.NumberFormat('en-US').format(Math.round(amountInRiel))} ៛`;
  const formatRielFromNative = (rielAmount: number) => `${new Intl.NumberFormat('en-US').format(Math.round(rielAmount))} ៛`;

  // --- 🟢 NEW CORE LOGIC FOR IMPORT AND MIX ---

  const importTotalCalc = (Number(importForm.qty) || 0) * (Number(importForm.unit_cost) || 0);

  const handleOpenAddProduct = () => {
    setNewItem({ 
      name: '', 
      price: '' as any, 
      cost_price: '' as any, 
      // 🔥 UI FIX: Make weight blank for Wholesale so you are forced to type 10, 25, or 50!
      weight: (activeTab === 'retail' && activeFullScreen === 'none') ? 1 : ('' as any), 
      stock: '' as any, 
      min_stock_level: 10 as any,
      linked_wholesale_id: '' as any // 🔥 FIX: TypeScript needs this to match the state shape!
    });
    setIsAddModalOpen(true);
  };

  // 🔥 SMART TYPIST: Auto-extracts weight from product name!
  const handleProductNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    let newWeight = newItem.weight;
    
    // Only auto-adjust if we are making a Wholesale/Import bag
    if (activeTab !== 'retail' || activeFullScreen !== 'none') {
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
    setIsProcessing(true);
    try {
      const payload = {
        name: newItem.name,
        price: Number(newItem.price) || 0,
        cost_price: Number(newItem.cost_price) || 0,
        weight: Number(newItem.weight) || 50,
        stock: Number(newItem.stock) || 0,
        min_stock_level: Number(newItem.min_stock_level) || 10,
        linked_wholesale_id: newItem.linked_wholesale_id ? Number(newItem.linked_wholesale_id) : null, // 🔥 ADDED WHOLESALE LINK
        mtd_kg_used: 0,
        mtd_bags_used: 0,
        branch_id: activeBranchId 
      }
      const { data, error } = await supabase.from('products').insert([payload]).select();
      
      if (!error && data && data.length > 0) {
        setIsAddModalOpen(false);
        setNewItem({ name: '', price: 0 as any, cost_price: 0 as any, weight: 50 as any, stock: 0 as any, min_stock_level: 10 as any, linked_wholesale_id: '' as any }); // 🔥 FIX: Added linked_wholesale_id here too
        setProducts(prev => [...prev, data[0]]);
        setImportForm(prev => ({ ...prev, product_id: String(data[0].id) }));
        showToast('success', 'Product Created', 'Ready to receive stock.');
      } else if (error) {
        throw error;
      }
    } catch (err: any) {
      showToast('error', 'Creation Failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleAddSupplier() {
    if (!newSupplier.name) return showToast('error', 'Validation Error', 'Supplier name is required');
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.from('suppliers').insert([{ 
        name: newSupplier.name, phone: newSupplier.phone, location: newSupplier.location, branch_id: activeBranchId 
      }]).select();
      if (error) throw error;
      setIsAddSupplierOpen(false);
      setNewSupplier({ name: '', phone: '', location: '' });
      if (data && data.length > 0) {
        setSuppliers(prev => [...prev, data[0]]);
        setImportForm(prev => ({ ...prev, supplier_id: String(data[0].id) }));
        showToast('success', 'Supplier Added', `${data[0].name} has been added successfully.`);
      }
    } catch (err: any) { showToast('error', 'Error', err.message); } finally { setIsProcessing(false); }
  }

  async function handleProcessImport(isPayLater: boolean) {
    // 🔥 HSR FIX: Check strictly for empty strings so typing '0' is completely allowed!
    if (!importForm.supplier_id || !importForm.product_id || importForm.qty === '' || importForm.unit_cost === '') {
      return showToast('error', 'Missing Data', 'Please fill in Supplier, Product, Qty, and Cost.');
    }
    setIsProcessing(true);
    const qty = Number(importForm.qty);
    const unitCost = Number(importForm.unit_cost);
    const totalCost = qty * unitCost;
    const paidAmount = isPayLater ? (Number(importForm.paid_amount) || 0) : totalCost;
    
    if (paidAmount > totalCost) {
      setIsProcessing(false);
      return showToast('error', 'Invalid Amount', 'Cannot pay more than the total cost.');
    }

    try {
      const supplierName = suppliers.find(s => String(s.id) === String(importForm.supplier_id))?.name || 'Unknown Supplier';
      const product = products.find(p => String(p.id) === String(importForm.product_id));
      if (!product) throw new Error("Product ID mismatch");

      // Calculate explicitly for the payload
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
      showToast('success', 'Stock Received', `${qty} bags added to inventory.`);
      setActiveFullScreen('none');
      loadProductsAndSettings();
      loadBatches();
      loadSuppliers();
    } catch (err: any) { showToast('error', 'Error', err.message); } finally { setIsProcessing(false); }
  }

  // Math Engine
  const getCogs = (prod: Product, batchId: number | null) => {
    if (batchId) { const batch = activeBatches[prod.id]?.find(b => b.id === batchId); if (batch) return batch.cost_price; }
    return prod.cost_price;
  }
  const rice1 = products.find(p => p.id.toString() === rice1Id);
  const rice2 = products.find(p => p.id.toString() === rice2Id);
  const rice3 = products.find(p => p.id.toString() === rice3Id);
  const targetProd = products.find(p => p.id.toString() === targetProductId);
  const bagProd = products.find(p => p.id.toString() === bagId);

  useEffect(() => {
    const q1 = Number(rice1Qty) || 0, q2 = Number(rice2Qty) || 0, q3 = showThirdRice ? (Number(rice3Qty) || 0) : 0, qBag = Number(bagQty) || 0;
    if (rice1 && rice2 && (showThirdRice ? rice3 : true) && (q1 + q2 + q3) > 0) {
      const kg1 = q1 * (Number(rice1.weight) >= 50 ? 50 : 1);
      const kg2 = q2 * (Number(rice2.weight) >= 50 ? 50 : 1);
      const kg3 = q3 * (rice3 ? (Number(rice3.weight) >= 50 ? 50 : 1) : 1);
      const totalYieldKg = kg1 + kg2 + kg3;
      const totalCost = (q1 * getCogs(rice1, rice1BatchId)) + (q2 * getCogs(rice2, rice2BatchId)) + (rice3 ? (q3 * getCogs(rice3, rice3BatchId)) : 0) + (bagProd ? (qBag * bagProd.cost_price) : 0);
      setCalcResult({ blendedCogsPerKg: totalYieldKg > 0 ? (totalCost / totalYieldKg) : 0, totalYieldKg, totalCost });
    } else { setCalcResult(null); setSyncMode('none'); }
  }, [rice1Id, rice2Id, rice3Id, rice1Qty, rice2Qty, rice3Qty, rice1BatchId, rice2BatchId, rice3BatchId, showThirdRice, bagQty, products, rice1, rice2, rice3, bagProd, activeBatches])

  let outputUnit = 'Kg', outputMultiplier = 1, finalYield = 0, finalCogs = 0;
  if (calcResult) {
    if (syncMode === 'new') { outputMultiplier = newMixType === 'wholesale' ? 50 : newMixType === 'half' ? 25 : 1; outputUnit = newMixType === 'wholesale' ? 'Bags' : newMixType === 'half' ? '25kg Bags' : 'Kg'; } 
    else if (syncMode === 'existing' && targetProd) { outputMultiplier = Number(targetProd.weight) >= 50 ? 50 : 1; outputUnit = Number(targetProd.weight) >= 50 ? 'Bags' : 'Kg'; } 
    else { outputMultiplier = 50; outputUnit = 'Bags'; }
    finalYield = calcResult.totalYieldKg / outputMultiplier; finalCogs = calcResult.blendedCogsPerKg * outputMultiplier;
  }

  useEffect(() => { if (bagId && finalYield > 0 && bagQty === '') setBagQty(Math.ceil(finalYield)); }, [finalYield, bagId]);

  const handleResetMix = () => {
    setRice1Id(''); setRice1Qty(''); setRice1BatchId(null); setRice2Id(''); setRice2Qty(''); setRice2BatchId(null);
    setRice3Id(''); setRice3Qty(''); setRice3BatchId(null); setShowThirdRice(false); setCalcResult(null); setSyncMode('none');
    setNewMixName(''); setNewMixPrice(0); setTargetProductId(''); setBagId(''); setBagQty(''); setActiveDropdown(null);
  }

  async function handleExecuteInventorySync() {
    if (!calcResult || !rice1 || !rice2) return;
    const qtyToDeduct1 = Number(rice1Qty) || 0, qtyToDeduct2 = Number(rice2Qty) || 0, qtyToDeduct3 = showThirdRice ? (Number(rice3Qty) || 0) : 0, qtyToDeductBag = Number(bagQty) || 0;
    if (!bagId || qtyToDeductBag <= 0) return showToast('error', 'Missing Bag', 'Please select a packaging bag and enter the quantity.');
    setIsProcessing(true);
    try {
      if (syncMode === 'new') {
        const { data: existingProd } = await supabase.from('products').select('id').ilike('name', newMixName.trim()).eq('branch_id', activeBranchId).eq('is_archived', false).maybeSingle();
        if (existingProd) { showToast('error', 'Duplicate Name', 'Product name exists.'); setIsProcessing(false); return; }
      }

      const recipeString = `Recipe: ${qtyToDeduct1}x ${rice1.name} + ${qtyToDeduct2}x ${rice2.name}${showThirdRice && rice3 ? ` + ${qtyToDeduct3}x ${rice3.name}` : ''}`;
      const ingredientsPayload = [];
      if (rice1 && qtyToDeduct1 > 0) ingredientsPayload.push({ id: rice1.id, qty: qtyToDeduct1, batchId: rice1BatchId });
      if (rice2 && qtyToDeduct2 > 0) ingredientsPayload.push({ id: rice2.id, qty: qtyToDeduct2, batchId: rice2BatchId });
      if (showThirdRice && rice3 && qtyToDeduct3 > 0) ingredientsPayload.push({ id: rice3.id, qty: qtyToDeduct3, batchId: rice3BatchId });

      const mixPayload: any = {
          branch_id: activeBranchId,
          sync_mode: syncMode,
          yield_kg: finalYield,
          final_cogs: finalCogs,
          recipe_string: recipeString,
          ingredients: ingredientsPayload,
          bag: bagProd && qtyToDeductBag > 0 ? { id: bagProd.id, qty: qtyToDeductBag } : null
      };

      if (syncMode === 'new') {
          mixPayload.new_product = {
              name: newMixName,
              price: Number(String(newMixPrice).replace(/,/g, '')) || 0,
              cost_price: Math.round(finalCogs),
              weight: newMixType === 'wholesale' ? 50 : newMixType === 'half' ? 25 : 1
          };
      } else {
          mixPayload.target_product = { id: targetProd?.id, name: targetProd?.name };
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc('execute_rice_mix', { p_payload: mixPayload });
      if (rpcError) throw rpcError;

      const yieldStr = `${finalYield.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${outputUnit}`;
      const newRecord: MixHistory = {
        id: Date.now().toString(), time: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        rice1Name: rice1.name, rice1Ratio: qtyToDeduct1, rice2Name: rice2.name, rice2Ratio: qtyToDeduct2, rice3Name: showThirdRice && rice3 ? rice3.name : undefined, rice3Ratio: showThirdRice ? qtyToDeduct3 : undefined,
        mixedCogs: finalCogs, yieldStr: yieldStr, bagUsed: bagProd ? bagProd.name : undefined, bagQty: bagProd ? qtyToDeductBag : undefined, branch_id: activeBranchId,
        targetProductId: rpcData.targetProductId, targetBatchId: rpcData.targetBatchId, yieldKg: finalYield, ingredients: rpcData.usedIngredients, bagId: bagProd ? bagProd.id : undefined,
      }
      
      const updatedGlobalHistory = [newRecord, ...globalHistory].slice(0, 100); 
      setGlobalHistory(updatedGlobalHistory); setMixHistory(updatedGlobalHistory);
      const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
      await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: updatedGlobalHistory }, { onConflict: 'setting_key' })

      showToast('success', 'Sync Successful', 'Inventory synced and stored in batch!');
      handleResetMix(); setActiveFullScreen('none'); loadProductsAndSettings(); loadBatches();
    } catch (err: any) { showToast('error', 'Error', err.message); } finally { setIsProcessing(false); }
  }

  const mixDropdownFilteredProducts = products.filter(p => {
    if (mixDropdownSearch && !p.name.toLowerCase().includes(mixDropdownSearch.toLowerCase())) return false;
    if (activeDropdown === 'bag') return p.name.includes('បាវ');
    if (activeDropdown === 'rice1' || activeDropdown === 'rice2' || activeDropdown === 'rice3') { 
      if (p.weight < 50) return false; 
      return true; 
    }
    if (activeDropdown === 'target') { const isWholesale = Number(p.weight) >= 50; if (dropdownTab === 'wholesale' && !isWholesale) return false; if (dropdownTab === 'retail' && isWholesale) return false; return true; }
    return true;
  }).sort((a, b) => riceCategoryComparator(a, b, 'cost_price')); // 🚦 MASTER SORT APPLIED

  const handleSelectMixProduct = (p: Product, target: string) => {
    if (target === 'rice1') { setRice1Id(p.id.toString()); setRice1BatchId(null); }
    if (target === 'rice2') { setRice2Id(p.id.toString()); setRice2BatchId(null); }
    if (target === 'rice3') { setRice3Id(p.id.toString()); setRice3BatchId(null); }
    if (target === 'target') setTargetProductId(p.id.toString());
    if (target === 'bag') setBagId(p.id.toString());
    setActiveDropdown(null);
  }

  const renderMixDropdownMenu = (target: string) => {
    if (activeDropdown !== target) return null;
    return (
      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, backgroundColor: '#fff', border: '1px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)', zIndex: 101, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {target === 'target' && (
          <div className="saas-tab-container" style={{ margin: '8px', marginBottom: 0, padding: '4px', border: 'none', boxShadow: 'none', background: '#f1f5f9' }}>
            <button onClick={(e) => { e.stopPropagation(); setDropdownTab('wholesale'); }} className={`saas-tab ${dropdownTab === 'wholesale' ? 'active' : ''}`} style={{ flex: 1, textAlign: 'center', padding: '8px' }}>🌾 Wholesale</button>
            <button onClick={(e) => { e.stopPropagation(); setDropdownTab('retail'); }} className={`saas-tab ${dropdownTab === 'retail' ? 'active' : ''}`} style={{ flex: 1, textAlign: 'center', padding: '8px' }}>🛍️ Retail</button>
          </div>
        )}
        <div className="hide-scrollbar" style={{ maxHeight: '220px', overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {mixDropdownFilteredProducts.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No products found</div>
          ) : (
            mixDropdownFilteredProducts.map(p => (
              <div key={p.id} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSelectMixProduct(p, target); }} style={{ padding: '12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', borderRadius: '8px', background: '#ffffff' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}>
                <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#1e293b', marginBottom: '4px' }}>{p.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                  <span>Cost: <b style={{ color: '#b58a3d' }}>{formatRiel(p.cost_price)}</b></span>
                  <span>Stock: <b style={{ color: p.stock > 0 ? '#10b981' : '#ef4444' }}>{p.stock}</b></span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  const toggleProductVisibility = async (productId: number) => {
    const isHidden = hiddenRetailIds.includes(productId);
    const newHidden = isHidden ? hiddenRetailIds.filter(id => id !== productId) : [...hiddenRetailIds, productId];
    setHiddenRetailIds(newHidden);
    
    // Save to isolated branch database
    const branchKey = activeBranchId === 0 ? 'hidden_retail_ids' : `hidden_retail_ids_${activeBranchId}`;
    await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: newHidden }, { onConflict: 'setting_key' });
  }

  const getKeywordIndex = (name: string) => {
    const lower = (name || '').toLowerCase();
    for (let i = 0; i < MAIN_KEYWORDS.length; i++) {
      if (lower.includes(MAIN_KEYWORDS[i].toLowerCase())) return i;
    }
    return 999;
  };

  function handleProductClick(product: Product) {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    const defaultQty = 1; 
    if (isMobile) {
      setSelectedMobileProduct(product);
      setMobileName(product.name);
      setMobilePrice(activeTab === 'wholesale' ? 0 : Number(product.price));
      setMobileQty(defaultQty);
      setMobileBatchId(null);
      setMobileBagId(null); 
      setMobileBagQty(1); // 🔥 FIX: Safely hard-reset Bag Qty to 1
      setMobileBagPrice(''); // 🔥 FIX: Wipe old Bag Price memory
      setMobileBagCoveredByDepot(false); 
      setIsMobileBatchModalOpen(false); 
      setIsMobileBagModalOpen(false); 
      setTimeout(() => {
        mobileQtyRef.current?.focus();
      }, 50);
    } else {
      addToCartDirect(product, defaultQty); // Desktop remains instant 1-click
    }
  }

  function addToCartDirect(product: Product, qtyToAdd: number | '' = 1) {
    const existing = cart.find((item) => item.product_id === product.id && !item.isSpecial)
    const priceInRiel = activeTab === 'wholesale' ? 0 : Number(product.price); 
    if (existing) {
      setCart(cart.map((item) => item.product_id === product.id && !item.isSpecial ? { ...item, quantity: (Number(item.quantity) || 0) + (Number(qtyToAdd) || 0) } : item))
    } else {
      setCart([...cart, { 
        ...product, product_id: product.id, id: Math.random(), quantity: qtyToAdd, custom_name: product.name, custom_price_riel: priceInRiel,
        cost_price: Number(product.cost_price || 0), isSpecial: false, selected_batch_id: null, sortOrder: Date.now() // 🔥 ERF FIX: Chronological Anchor
      }])
    }
  }

  function handleAddMobileProductToCart(forceAdd: boolean | any = false) {
    const isForced = forceAdd === true;
    if (!selectedMobileProduct) return;
    const rawQtyStr = String(mobileQty).replace(/,/g, '');
    const finalQty = parseFloat(rawQtyStr) || 0;
    const finalPrice = typeof mobilePrice === 'number' ? mobilePrice : (parseFloat(String(mobilePrice).replace(/,/g, '')) || 0);
    
    const defaultPrice = activeTab === 'wholesale' ? 0 : Number(selectedMobileProduct.price || 0);
    
    // 🔥 FIX: Completely removed the annoying "1x" confirmation popup here so adding is instant!

    if (!isForced && (finalQty <= 0 || mobileQty === '')) {
      if (!window.confirm('🛑 Missing Quantity\n\nPlease enter a quantity greater than 0.\n\nClick [OK] to add to cart anyway, or [Cancel] to recheck.')) return;
    }

    if (!isForced && (finalPrice <= 0 || mobilePrice === '')) {
      if (!window.confirm('🛑 Missing Price\n\nPlease enter the selling price before adding to cart.\n\nClick [OK] to add to cart anyway, or [Cancel] to recheck.')) return;
    }

    if (!isForced && finalQty > 10000) {
      if (!window.confirm(`🛑 High Quantity Warning\n\nQuantity (${finalQty.toLocaleString()}) is unusually high.\n\nClick [OK] to add anyway, or [Cancel] to recheck.`)) return;
    }

    const costPrice = Number(selectedMobileProduct.cost_price || 0);
    if (!isForced && finalPrice < costPrice) {
      if (!window.confirm(`📉 Price Below Cost\n\nYou are selling this for ${formatRiel(finalPrice)}, but the cost is ${formatRiel(costPrice)}.\n\nClick [OK] to sell below cost anyway, or [Cancel] to recheck.`)) return;
    }

    let newCart = [...cart];
    const existingIndex = newCart.findIndex((item) => item.product_id === selectedMobileProduct.id && !item.isSpecial);
    
    let insertIndex = newCart.length;
    let baseSortOrder = Date.now(); // 🔥 ERF FIX: Establish exact timestamp for grouping

    if (existingIndex !== -1) { 
      newCart[existingIndex] = { 
        ...newCart[existingIndex], custom_name: mobileName, custom_price_riel: finalPrice, quantity: (Number(newCart[existingIndex].quantity) || 0) + finalQty,
        selected_batch_id: mobileBatchId
      };
      baseSortOrder = newCart[existingIndex].sortOrder || Date.now(); // Inherit parent timestamp
      insertIndex = existingIndex + 1; 
    } else {
      newCart.push({ 
        ...selectedMobileProduct, product_id: selectedMobileProduct.id, id: Math.random(), custom_name: mobileName, custom_price_riel: finalPrice, 
        cost_price: Number(selectedMobileProduct.cost_price || 0), quantity: finalQty, isSpecial: false, 
        selected_batch_id: mobileBatchId, sortOrder: baseSortOrder 
      });
      insertIndex = newCart.length;
    }

    if (mobileBagId) {
      const bagProd = products.find(p => p.id === mobileBagId);
      if (bagProd) {
        const bagQtyNum = mobileBagQty === '' ? 1 : Number(mobileBagQty);
        const finalBagPrice = mobileBagCoveredByDepot ? 0 : Number(mobileBagPrice || 0); // 🔥 PULLS CUSTOM TYPED PRICE
        
        newCart.splice(insertIndex, 0, {
          ...bagProd,
          product_id: bagProd.id,
          id: Math.random(),
          custom_name: mobileBagCoveredByDepot ? `ប្តូរបាវ ${bagProd.name} (Covered by Depot)` : `ប្តូរបាវ ${bagProd.name}`,
          custom_price_riel: finalBagPrice, // 🔥 INJECTS CUSTOM PRICE
          cost_price: Number(bagProd.cost_price || 0),
          quantity: bagQtyNum,
          isSpecial: true,
          bypass_stock: false, 
          sortOrder: baseSortOrder + 1 
        });
      }
    }

    setCart(newCart);
    setSelectedMobileProduct(null);
    setMobileBagId(null);
  }

  function handleAddCartAdjustment() {
    if (!adjustmentModal.type) return;
    const isCoveredBag = adjustmentModal.type === 'bag' && adjustmentModal.isCoveredByDepot;
    const amountVal = isCoveredBag ? 0 : (Number(adjustmentModal.amount) || 0);
    const qtyVal = Number(adjustmentModal.qty) || 1;
    const noteVal = adjustmentModal.note.trim();
    
    if (!isCoveredBag && amountVal <= 0) {
      showToast('error', 'Invalid Amount', 'Please enter an amount greater than 0.');
      return;
    }

    let baseName = '';
    if (adjustmentModal.type === 'discount') baseName = 'បញ្ចុះតម្លៃ';
    if (adjustmentModal.type === 'deposit') baseName = 'កក់';
    if (adjustmentModal.type === 'bag') {
      const bagTitle = adjustmentModal.selectedBagName || 'ថ្លៃបាវ ប្រ៊េន';
      baseName = isCoveredBag ? `${bagTitle} (Covered by Depot)` : bagTitle;
    }

    const customName = noteVal ? `${baseName} (${noteVal})` : baseName;
    const matchedBagProd = products.find(p => p.name === adjustmentModal.selectedBagName);
    const fallbackId = matchedBagProd ? matchedBagProd.id : (products[0]?.id || 1);

    let cogsVal = 0;
    if (adjustmentModal.type === 'bag') {
      cogsVal = matchedBagProd ? Number(matchedBagProd.cost_price || 1200) : 1200;
    }
    if (adjustmentModal.type === 'deposit') cogsVal = Math.abs(amountVal);

    const newAdjustmentItem: CartItem = {
      id: Math.random(),
      product_id: fallbackId,
      name: baseName,
      custom_name: customName,
      custom_price_riel: Math.abs(amountVal),
      price: Math.abs(amountVal),
      cost_price: cogsVal,
      quantity: qtyVal,
      weight: 0,
      stock: 0,
      isSpecial: true,
      bypass_stock: true, 
      sortOrder: adjustmentModal.type === 'bag' ? Date.now() + 1 : 9999999999999 // 🔥 Drop discounts & deposits strictly to bottom
    };

    setCart([...cart, newAdjustmentItem]);
    setAdjustmentModal({ isOpen: false, type: null, amount: '', qty: 1, note: '', isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false });
    setShowAdjustmentMenu(false);
  }

  async function handleConfirmExchange() {
    if (!exchangeModal.product) return;
    const prod = exchangeModal.product;
    const consumedKg = Number(exchangeModal.consumedKg) || 0;
    const wWeight = Number(prod.weight) || 50;
    let linkedRetail = products.find(p => p.linked_wholesale_id === prod.id);

    if (consumedKg >= wWeight) {
       showToast('error', 'Invalid Amount', `Consumed amount cannot be ${wWeight}kg or more for a single bag return.`);
       return;
    }

    setIsProcessing(true);

    try {
      if (consumedKg > 0 && !linkedRetail) {
         const newRetailName = prod.name; 
         const perKgPrice = Math.round(Number(prod.price || 0) / wWeight);
         const perKgCogs = Math.round(Number(prod.cost_price || 0) / wWeight);

         const { data: newProd, error } = await supabase.from('products').insert([{
           branch_id: activeBranchId, 
           name: newRetailName,
           price: perKgPrice,
           cost_price: perKgCogs,
           weight: 1,
           stock: 0,
           min_stock_level: 10,
           linked_wholesale_id: prod.id,
           is_archived: false
         }]).select().single();

         if (error) throw new Error("Failed to auto-create retail product: " + error.message);
         
         linkedRetail = newProd as Product;
         setProducts(prev => [...prev, newProd as Product]);

         const newHidden = Array.from(new Set([...hiddenRetailIds, newProd.id]));
         setHiddenRetailIds(newHidden);
         // 🔥 SECURITY FIX: Isolate the setting_key by branch to prevent cross-tenant UI overrides
         const branchKey = activeBranchId === 0 ? 'hidden_retail_ids' : `hidden_retail_ids_${activeBranchId}`;
         await supabase.from('app_settings').upsert(
           { setting_key: branchKey, setting_value: newHidden },
           { onConflict: 'setting_key' }
         );
      }

      const newItems: any[] = [];

      if (consumedKg === 0) {
        newItems.push({
          ...prod, product_id: prod.id, id: Math.random(), custom_name: `ដូរ ${prod.name}`, custom_price_riel: prod.price,
          cost_price: Number(prod.cost_price || 0), quantity: 1, isSpecial: true, isReturnFullBag: true, bypass_stock: false, sortOrder: -9999999999999 // 🔥 Force Returns absolutely to the top
        });
      } else {
        const returnedKg = 50 - consumedKg;
        const perKgPrice = Math.round(Number(prod.price || 0) / 50);
        const perKgCogs = Math.round(Number(prod.cost_price || 0) / 50);

        newItems.push({
          ...prod, 
          id: Math.random(), 
          product_id: prod.id, 
          custom_name: `ដូរ ${prod.name}`, 
          custom_price_riel: prod.price,
          cost_price: Number(prod.cost_price || 0), 
          quantity: 1, 
          isSpecial: true, 
          bypass_stock: true, 
          add_loose_kg: returnedKg, 
          loose_retail_id: linkedRetail?.id, 
          sortOrder: -9999999999999 // 🔥 Force Returns absolutely to the top
        });

        newItems.push({
          ...(linkedRetail || prod), 
          id: Math.random(), 
          product_id: linkedRetail ? linkedRetail.id : prod.id, 
          custom_name: `បានប្រើ ${prod.name}`, 
          custom_price_riel: perKgPrice,
          cost_price: perKgCogs, 
          quantity: consumedKg, 
          isSpecial: true, 
          bypass_stock: true, 
          sortOrder: -9999999999990 // 🔥 Pin directly below the return
        });
      }

      setCart([...cart, ...newItems]);
      setExchangeModal({ isOpen: false, product: null, consumedKg: '' });
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  function updateCartItem(id: number, field: string, value: any) {
    // 🔥 UI FIX: Wrapped in functional state update to prevent dropped inputs from rapid scanner/tablet tapping
    setCart(prevCart => {
      let updatedCart = prevCart.map((item) => item.id === id ? { ...item, [field]: value } : item);

      if (field === 'custom_price_riel') {
        const editedItem = updatedCart.find(i => i.id === id);
        if (editedItem && editedItem.custom_name.startsWith('ដូរ ')) {
          const baseName = editedItem.custom_name.replace('ដូរ ', '');
          const consumedName = `បានប្រើ ${baseName}`;
          const wWeight = Number(editedItem.weight) || 50;
          const newPerKgPrice = Math.round(Number(value) / wWeight) || 0;

          updatedCart = updatedCart.map(item => {
            if (item.custom_name === consumedName) {
              return { ...item, custom_price_riel: newPerKgPrice };
            }
            return item;
          });
        }
      }
      return updatedCart;
    });
  }

  function removeFromCart(id: number) {
    setCart(cart.filter(item => item.id !== id))
  }

  const handleProductDragStart = (e: React.DragEvent, id: number) => {
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.setData('product_id', String(id));
    e.dataTransfer.effectAllowed = 'move';
  }

  const handleProductDragOver = (e: React.DragEvent) => { e.preventDefault(); }

  const handleProductDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    const sourceId = Number(e.dataTransfer.getData('text/plain'));
    if (!sourceId || sourceId === targetId) return;

    let currentOrder = [...productOrder];
    products.forEach(p => { if (!currentOrder.includes(p.id)) currentOrder.push(p.id); });

    const sIdx = currentOrder.indexOf(sourceId);
    const tIdx = currentOrder.indexOf(targetId);
    currentOrder.splice(sIdx, 1);
    currentOrder.splice(tIdx, 0, sourceId);

    setProductOrder(currentOrder);
    // 🔥 SECURITY FIX: Isolate product reordering strictly to the active branch
    const branchKey = activeBranchId === 0 ? 'pos_product_order' : `pos_product_order_${activeBranchId}`;
    await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: currentOrder }, { onConflict: 'setting_key' });
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    const finalName = newCustomerForm.name.trim() || 'Walk-in';
    const { data, error } = await supabase.from('customers').insert([{
      name: finalName, phone: newCustomerForm.phone.trim(), location: newCustomerForm.location.trim(),
      owner: newCustomerForm.owner.trim() || null, type: newCustomerForm.type.trim(),
      branch_id: activeBranchId 
    }]).select().single();

    if (!error && data) {
      setCustomers([...customers, data].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setSelectedCustomerId(data.id.toString());
      setIsCreateCustomerModalOpen(false);
      setNewCustomerForm({ name: '', phone: '', location: '', owner: '', type: '' });
      setCustomerSearchTerm('');
    } else {
      showToast('error', 'Error', `Error creating customer: ${error?.message}`);
    }
  }

  // ✅ FIX: Passed localBatchUsage AND freshBatches to prevent React State delays
  async function getFIFOSplits(productId: number, qtySold: number, fallbackCogs: number, localBatchUsage: Record<number, number>, freshBatches?: Record<number, InventoryBatch[]>) {
    let remainingQtyToFulfill = qtySold;
    const splits: any[] = [];
    
    let availableBatches = [];
    
    // 1. Bypass React State: Use fresh batches if injected from Auto-Open
    if (freshBatches && freshBatches[productId]) {
      availableBatches = freshBatches[productId];
    } else {
      const { data: batches } = await supabase.from('inventory_batches')
        .select('*')
        .eq('product_id', productId)
        .eq('branch_id', activeBranchId) 
        .eq('is_hidden', false)
        .order('created_at', { ascending: true });
      availableBatches = batches || [];
    }

    for (const batch of availableBatches) {
      if (remainingQtyToFulfill <= 0) break;
      
      // Calculate TRUE available stock by subtracting what we already used in this checkout loop
      const alreadyUsed = localBatchUsage[batch.id] || 0;
      const availableInBatch = Math.max(0, (batch.remaining_qty || 0) - alreadyUsed);
      
      if (availableInBatch <= 0) continue;

      const qtyTaken = Math.min(availableInBatch, remainingQtyToFulfill);
      splits.push({ qty: qtyTaken, cogs_price: batch.cost_price, batch_id: batch.id, current_remaining: availableInBatch });
      
      // Track usage to prevent the next cart item from double-dipping this batch
      localBatchUsage[batch.id] = alreadyUsed + qtyTaken;
      remainingQtyToFulfill -= qtyTaken;
    }
    if (remainingQtyToFulfill > 0) splits.push({ qty: remainingQtyToFulfill, cogs_price: fallbackCogs, batch_id: null, current_remaining: 0 });
    return splits;
  }

  function cancelEditMode() {
    setEditingInvoiceId(null);
    setCart([]);
    setSelectedCustomerId('');
    setCartCustomerNameOverride('');
    setPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '', isAuto: true }]);
    localStorage.removeItem('pos_cart');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  async function initiateCheckout() {
    // 🧠 SMART GUARD & REQUIRED FIELDS: Verify entire cart before allowing checkout
    for (const item of cart) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.custom_price_riel) || 0;
      
      // 🔥 FIX: Include item.isSpecial and 'Covered by Depot' / 'ថ្លៃបាវ' (Bag Fees) to allow 0៛ checkout
      const isSpecial = item.isSpecial || item.custom_name.includes('ដូរ') || item.custom_name.includes('បញ្ចុះតម្លៃ') || item.custom_name.includes('កក់') || item.custom_name.includes('បានប្រើ') || item.custom_name.includes('ថ្លៃបាវ') || item.custom_name.includes('Covered by Depot');

      if (!isSpecial) {
        if (qty <= 0 || item.quantity === '') {
          if (!window.confirm(`🛑 Missing Quantity\n\nPlease enter a valid quantity for [${item.custom_name}].\n\nClick [OK] to checkout anyway, or [Cancel] to recheck.`)) return;
        }
        if (price <= 0 || item.custom_price_riel === '') {
          if (!window.confirm(`🛑 Missing Price\n\nYou forgot to enter the price for [${item.custom_name}].\n\nClick [OK] to checkout anyway, or [Cancel] to recheck.`)) return;
        }
        if (qty > 10000) {
          if (!window.confirm(`🛑 Quantity Warning\n\nItem [${item.custom_name}] has a quantity of ${qty.toLocaleString()}.\n\nDid you type the price into the quantity field?\n\nClick [OK] to checkout anyway, or [Cancel] to recheck.`)) return;
        }
        
        // 🧠 SMART GUARD: Prevent Selling Below Cost Price at Checkout
        const costPrice = Number(item.cost_price || 0);
        if (price < costPrice) {
          if (!window.confirm(`📉 Price Too Low\n\nItem [${item.custom_name}] is priced at ${formatRiel(price)}, which is below its cost price of ${formatRiel(costPrice)}.\n\nClick [OK] to complete checkout anyway, or [Cancel] to recheck.`)) return;
        }
      }
    }

    // We can safely remove the old isCartValid check since the interactive loop above catches everything!
    if (cart.length === 0) {
      window.alert("Your cart is empty!");
      return;
    }

    if (activeTab === 'wholesale' && !selectedCustomerId) {
      if (!window.confirm(`🛑 Customer Required\n\n${lang === 'kh' ? 'សូមជ្រើសរើសអតិថិជនសម្រាប់ដុំ!' : 'Please select a customer for wholesale'}\n\nClick [OK] to checkout anyway, or [Cancel] to recheck.`)) return;
    }
    
    if (showPaymentSelector && liveTotalReceivedInRiel < totalRiel && !editingInvoiceId) {
      if (!window.confirm('🛑 Invalid Payment\n\nAmount received is less than the total due. This will be recorded as Debt.\n\nClick [OK] to proceed with partial/no payment, or [Cancel] to recheck.')) return;
    }

    const simulatedStockUpdates: Record<number, number> = {};
    
    for (const item of cart) {
         const isReturn = item.custom_name.includes('ដូរ');
         const isCharge = item.custom_name.includes('បានប្រើ');
         const isBypass = item.bypass_stock || isCharge;
         const finalQty = isReturn ? -Math.abs(Number(item.quantity)) : Number(item.quantity);
         
         if (!isBypass) {
             simulatedStockUpdates[item.product_id] = (simulatedStockUpdates[item.product_id] ?? products.find(p=>p.id===item.product_id)?.stock ?? 0) - finalQty;
         }
         if (item.add_loose_kg && item.loose_retail_id && !editingInvoiceId) {
             simulatedStockUpdates[item.loose_retail_id] = (simulatedStockUpdates[item.loose_retail_id] ?? products.find(p=>p.id===item.loose_retail_id)?.stock ?? 0) + item.add_loose_kg;
         }
    }

    const itemsNeedingBags: (Product & { bags_needed: number })[] = [];
    for (const [prodId, finalStock] of Object.entries(simulatedStockUpdates)) {
        if (finalStock <= -1) {
            const p = products.find(x => x.id === Number(prodId));
            const pWeight = Number(p?.weight || 0);
            if (p && pWeight < 25 && p.linked_wholesale_id) {
                const wholesaleProd = products.find(w => w.id === p.linked_wholesale_id);
                const wholesaleWeight = wholesaleProd ? Number(wholesaleProd.weight) : 50;
                const bagsNeeded = Math.ceil(Math.abs(finalStock) / wholesaleWeight);
                itemsNeedingBags.push({ ...p, bags_needed: bagsNeeded });
            } else if (p && pWeight < 25 && !p.linked_wholesale_id) {
                // 🔥 OVERSELL FIX: Removed the error block. Retail stock will now quietly drop into negative numbers!
            } else if (p && pWeight >= 25) {
                // 🔥 OVERSELL FIX: Removed the error block. Wholesale bags will now quietly drop into negative numbers!
            }
        }
    }

    // 🔥 STRICT FIFO: Capture the exact stock and old COGS currently in the bin BEFORE the new bag is opened
    const preCheckoutStock: Record<number, { stock: number, cost_price: number }> = {};
    for (const item of cart) {
        const p = products.find(x => x.id === item.product_id);
        if (p) {
            let currentCogs = Number(p.cost_price || 0);
            if (p.linked_wholesale_id) {
                const wp = products.find(w => w.id === p.linked_wholesale_id);
                if (wp) {
                    const wBatches = activeBatches[wp.id] || [];
                    const cb = wBatches.length > 0 ? [...wBatches].sort((a,b) => a.id - b.id)[0] : null;
                    const wCogs = cb ? Number(cb.cost_price) : Number(wp.cost_price || 0);
                    currentCogs = wCogs / (Number(wp.weight) || 50);
                }
            }
            preCheckoutStock[p.id] = { stock: Number(p.stock || 0), cost_price: currentCogs };
        }
    }

    if (itemsNeedingBags.length > 0) {
        setAutoOpenModal({ isOpen: true, items: itemsNeedingBags, preCheckoutStock });
        return;
    }

    executeCheckout(products, undefined, preCheckoutStock);
  }

  async function handleConfirmAutoOpen() {
    setIsProcessing(true);
    try {
        for (const p of autoOpenModal.items) {
            const targetWholesaleId = repackSubstitutes[p.id] || p.linked_wholesale_id;
            const wholesaleProd = products.find(w => w.id === targetWholesaleId);
            
            if (!wholesaleProd) {
                throw new Error(`Wholesale bag not found for ${p.name}.`);
            }
            // 🔥 OVERSELL FIX: We removed the "wholesaleProd.stock < p.bags_needed" check.
            // The system will now happily let the wholesale bag drop to negative to fulfill the retail auto-open!
            
            const { error } = await supabase.rpc('pull_wholesale_bags', {
                p_retail_id: p.id,
                p_wholesale_id: wholesaleProd.id,
                p_bags_needed: p.bags_needed,
                p_branch_id: activeBranchId // 🔒 FIX: Added missing branch ID so the RPC doesn't crash!
            });
            if (error) throw error;

            // 🔥 NEW: Check if pulling this bag empties the Wholesale stock!
            const newWholesaleStock = Number(wholesaleProd.stock) - p.bags_needed;
            triggerStockAlert(wholesaleProd.name, newWholesaleStock, Number(wholesaleProd.min_stock_level) || 0, Number(wholesaleProd.weight) || 50);
        }
        
        setAutoOpenModal({ isOpen: false, items: [] });
        setRepackSubstitutes({});
        setRepackSearch({});
        setRepackMenuOpen({});
        
        // This refresh will now pull the newly linked bag data, syncing POS and Rice Inventory automatically
        const { data: prodData } = await supabase.from('products').select('*').eq('is_archived', false).eq('branch_id', activeBranchId).order('id', { ascending: true });
        
        // ✅ FIX: Fetch fresh batches explicitly and pass them directly into Checkout bypassing React State
        const { data: batchData } = await supabase.from('inventory_batches').select('*').eq('branch_id', activeBranchId).eq('is_hidden', false).order('created_at', { ascending: true });
        
        let newBatchMap: Record<number, InventoryBatch[]> = {};
        if (batchData) {
            batchData.forEach((b: any) => {
                if (!newBatchMap[b.product_id]) newBatchMap[b.product_id] = [];
                newBatchMap[b.product_id].push(b);
            });
        }

        if (prodData) {
            setProducts(prodData);
            setActiveBatches(newBatchMap);
            await executeCheckout(prodData, newBatchMap, autoOpenModal.preCheckoutStock);
        }
    } catch (err: any) {
        showToast('error', 'Auto-Open Failed', err.message);
        setIsProcessing(false);
    }
  }
  
  // MAIN CHECKOUT ENGINE (ATOMIC VERSION)
  async function executeCheckout(
    latestProducts: Product[], 
    latestBatchesOverride?: Record<number, InventoryBatch[]>,
    preCheckoutStockParams?: Record<number, { stock: number, cost_price: number }>
  ) {
    setIsProcessing(true);

    const localBatchUsage: Record<number, number> = {};
    const currentBatches = latestBatchesOverride || activeBatches;

    try {
      const currentCart = [...cart];
      const currentTotalRiel = totalRiel;
      
      const finalCustomerName = cartCustomerNameOverride.trim() || 'Walk-in';
      const finalOwner = selectedCustomer?.owner || null; 
      const finalLocation = cartCustomerLocationOverride !== '' ? cartCustomerLocationOverride : (selectedCustomer?.location || '');
      const finalPhone = cartCustomerPhoneOverride !== '' ? cartCustomerPhoneOverride : (selectedCustomer?.phone || '');

      const activePayments = showPaymentSelector ? paymentRows.filter(r => (Number(r.amount) || 0) > 0) : [];
      const actualTotalReceived = showPaymentSelector ? liveTotalReceivedInRiel : 0;
      const actualRemaining = currentTotalRiel - actualTotalReceived;

      let effectiveSplits: { method: string, amount_usd: number, amount_riel: number, face_amount: number }[] = [];

      // 🔥 Extract Deposits to register as actual Payments
      let depositTotalRiel = 0;
      let depositMethod = 'Cash ៛';
      currentCart.forEach(item => {
         if (item.custom_name.includes('កក់')) {
             depositTotalRiel += (Number(item.custom_price_riel) || 0) * Math.abs(Number(item.quantity) || 0);
             if (item.custom_name.toLowerCase().includes('qr')) {
                 depositMethod = 'QR ៛';
             }
         }
      });

      if (activePayments.length === 0) {
        if (!isSimpleCustomer) {
          effectiveSplits.push({ method: 'Unpaid / Debt', amount_usd: 0, amount_riel: currentTotalRiel, face_amount: currentTotalRiel });
        } else {
          effectiveSplits.push({ method: 'Cash ៛', amount_usd: 0, amount_riel: currentTotalRiel, face_amount: currentTotalRiel });
        }
      } else {
        activePayments.forEach(p => {
            let amtFace = Number(p.amount);
            if (p.method.includes('$')) {
               effectiveSplits.push({ method: p.method, amount_usd: amtFace, amount_riel: 0, face_amount: amtFace });
            } else {
               effectiveSplits.push({ method: p.method, amount_usd: 0, amount_riel: amtFace, face_amount: amtFace });
            }
        });

        if (actualRemaining > 0 && !isSimpleCustomer) {
            effectiveSplits.push({ method: 'Unpaid / Debt', amount_usd: 0, amount_riel: actualRemaining, face_amount: actualRemaining });
        }

        if (actualRemaining < 0) {
           const changeAmountRiel = Math.abs(actualRemaining);
           effectiveSplits.push({ method: 'Cash ៛', amount_usd: 0, amount_riel: -changeAmountRiel, face_amount: -changeAmountRiel });
        }
      }

      // 🟢 Inject Deposit as Payment
      if (depositTotalRiel > 0) {
          effectiveSplits.push({ method: depositMethod, amount_usd: 0, amount_riel: depositTotalRiel, face_amount: depositTotalRiel });
      }

      // 🔥 Generate a collision-proof ID
      const uniqueSuffix = Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
      
      // 🔥 FIX: Check for editingInvoiceId FIRST, so both Retail and Wholesale keep their original IDs when editing!
      const activeTxId = editingInvoiceId 
          ? editingInvoiceId 
          : (activeTab === 'retail' ? `RET-${uniqueSuffix}` : `INV-${uniqueSuffix}`);

      let primaryMethodStr = effectiveSplits.map(s => {
        if (s.method === 'Unpaid / Debt') return s.method;
        return `${s.method}: ${s.face_amount}`;
      }).join(', ');

      // 🔥 FIX: Wraps quantity in Math.abs() so discounts and returns always look pretty like (x1) instead of (x-1)
      const combinedRiceTypes = currentCart.map(item => `${item.custom_name} (x${Math.abs(Number(item.quantity))})`).join(', ');
      const baseSaleRows: any[] = [];
      const stockUpdates: Record<number, number> = {}; 
      const fifoUpdates: Record<number, number> = {}; 

      // 🟢 BUILD SALES ROWS AND INVENTORY DEDUCTIONS
      for (const item of currentCart) {
          const isReturn = item.custom_name.includes('ដូរ');
          const isDiscount = item.custom_name.includes('បញ្ចុះតម្លៃ');
          const isDeposit = item.custom_name.includes('កក់');
          const isCharge = item.custom_name.includes('បានប្រើ');

          const isNegativeItem = isReturn || isDiscount || isDeposit;
          const isBypass = item.bypass_stock || isCharge || isDeposit; 
          const finalQty = isNegativeItem ? -Math.abs(Number(item.quantity)) : Number(item.quantity);

          let finalCogs = Number(item.cost_price || 0);
          if (activeTab === 'retail') {
              const dbProduct = latestProducts.find(p => p.id === item.product_id);
              if (dbProduct && dbProduct.linked_wholesale_id) {
                  const wholesaleProd = latestProducts.find(wp => wp.id === dbProduct.linked_wholesale_id);
                  if (wholesaleProd) {
                     const wBatches = currentBatches[wholesaleProd.id] || [];
                     const currentBatch = wBatches.length > 0 ? [...wBatches].sort((a,b) => a.id - b.id)[0] : null;
                     const wholesaleBagCogs = currentBatch ? Number(currentBatch.cost_price) : Number(wholesaleProd.cost_price || 0);
                     finalCogs = wholesaleBagCogs / (Number(wholesaleProd.weight) || 50);
                  }
              }
          }

          if (isDiscount) finalCogs = 0; 
          if (isDeposit) finalCogs = Number(item.custom_price_riel || 0);

          if (item.add_loose_kg && item.loose_retail_id && !editingInvoiceId) {
             stockUpdates[item.loose_retail_id] = (stockUpdates[item.loose_retail_id] || 0) + item.add_loose_kg;
          }
          
          if (isNegativeItem || isBypass || editingInvoiceId || item.selected_batch_id) {
            const specificBatch = item.selected_batch_id ? activeBatches[item.product_id]?.find(b => b.id === item.selected_batch_id) : null;
            const rowCogs = specificBatch ? specificBatch.cost_price : finalCogs;

            baseSaleRows.push({
              db_row_id: item.db_row_id,
              branch_id: activeBranchId, 
              product_id: item.product_id, 
              customer_name: finalCustomerName, 
              rice_type: item.name,
              custom_rice_type: item.custom_name !== item.name ? item.custom_name : null, 
              qty: finalQty, 
              price_per_bag: Number(item.custom_price_riel || 0), 
              cogs_price: rowCogs, 
              owner: finalOwner
            });

            if (specificBatch && !isBypass) {
                fifoUpdates[specificBatch.id] = (fifoUpdates[specificBatch.id] || 0) - finalQty;
            }
          } else {
            const splits = await getFIFOSplits(item.product_id, finalQty, finalCogs, localBatchUsage, currentBatches);
            for (const split of splits) {
              baseSaleRows.push({
                db_row_id: item.db_row_id,
                branch_id: activeBranchId, 
                product_id: item.product_id, 
                customer_name: finalCustomerName, 
                rice_type: item.name,
                custom_rice_type: item.custom_name !== item.name ? item.custom_name : null, 
                qty: split.qty, 
                price_per_bag: Number(item.custom_price_riel || 0), 
                cogs_price: split.cogs_price, 
                owner: finalOwner
              });
              
              if (split.batch_id && !isBypass) {
                fifoUpdates[split.batch_id] = (fifoUpdates[split.batch_id] || 0) - split.qty;
              }
            }
          }

          if (!isBypass) {
            stockUpdates[item.product_id] = (stockUpdates[item.product_id] || 0) - finalQty;
          }
      }

      // 🟢 PREPARE ATOMIC PAYLOAD DATA
      const newBatchesToCreate: any[] = [];
      let deletedSaleIds: string[] = [];

      if (editingInvoiceId) {
        // 🔥 FIX: Dynamically detect the table so Retail edits properly revert stock!
        const targetTable = activeTab === 'retail' ? 'retail_sales' : 'sales';
        const targetColumn = activeTab === 'retail' ? 'transaction_id' : 'invoice_id';

        const { data: existingSales } = await supabase.from(targetTable).select('*').eq(targetColumn, editingInvoiceId);
        
        if (existingSales) {
          for (const old of existingSales) {
              if (old.product_id && old.qty) {
                  stockUpdates[old.product_id] = (stockUpdates[old.product_id] || 0) + Number(old.qty);
                  
                  const { data: batches } = await supabase.from('inventory_batches')
                      .select('id')
                      .eq('product_id', old.product_id)
                      .eq('branch_id', activeBranchId)
                      .order('id', { ascending: false })
                      .limit(1);

                  if (batches && batches.length > 0) {
                      fifoUpdates[batches[0].id] = (fifoUpdates[batches[0].id] || 0) + Number(old.qty);
                  } else {
                      newBatchesToCreate.push({
                          product_id: old.product_id,
                          product_name: old.rice_type || 'Restored',
                          cost_price: old.cogs_price || 0,
                          remaining_qty: old.qty,
                          branch_id: activeBranchId
                      });
                  }
              }
          }

          const cartIds = currentCart.map(c => c.db_row_id).filter(Boolean);
          deletedSaleIds = existingSales.map(s => String(s.id)).filter(id => !cartIds.includes(Number(id)));
        }
      }

      let splitCogsSum = baseSaleRows.reduce((sum, r) => {
          const rowName = r.custom_rice_type || r.rice_type || '';
          if (rowName.includes('កក់')) return sum;
          return sum + (Number(r.qty) * Number(r.cogs_price));
      }, 0);
      
      let splitSalesSum = baseSaleRows.reduce((sum, r) => {
          const rowName = r.custom_rice_type || r.rice_type || '';
          if (rowName.includes('កក់')) return sum;
          return sum + (Number(r.qty) * Number(r.price_per_bag));
      }, 0);

      const finalSaleRows = baseSaleRows.map(r => {
        const { db_row_id, ...cleanRow } = r;
        
        // 🔥 FIX: Wholesale uses 'invoice_id', Retail uses 'transaction_id'
        const txPayload = activeTab === 'retail' 
            ? { transaction_id: activeTxId } 
            : { invoice_id: activeTxId };
            
        if (db_row_id) return { ...cleanRow, id: db_row_id, ...txPayload, payment_method: primaryMethodStr };
        return { ...cleanRow, ...txPayload, payment_method: primaryMethodStr };
      });

      const rowsWithId = finalSaleRows.filter(r => r.id);
      const rowsWithoutId = finalSaleRows.filter(r => !r.id);

      const summaryRow = {
        invoice_id: activeTxId,
        branch_id: activeBranchId, 
        customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
        customer_name: finalCustomerName,
        owner: finalOwner,
        rice_types: combinedRiceTypes,
        total_sales: splitSalesSum,
        total_cogs: splitCogsSum,
        total_profit: splitSalesSum - splitCogsSum,
        delivery_status: actualRemaining > 0 ? 'Pending' : 'Delivered',
        payment_method: primaryMethodStr,
        balance_due: actualRemaining > 0 ? actualRemaining : 0,
        customer_location: finalLocation,
        is_done: actualRemaining <= 0 
      };

      const mappedPayments = effectiveSplits.filter(split => split.method !== 'Unpaid / Debt').map(split => ({
         invoice_id: activeTxId,
         branch_id: activeBranchId, 
         amount_paid_usd: split.amount_usd, 
         amount_paid_riel: split.amount_riel, 
         payment_method: split.method,
         recorded_by: finalOwner || 'System',
         customer_name: finalCustomerName // 🔥 Added Customer Name here
      }));

      const customerUpdatePayload = (!isSimpleCustomer && selectedCustomerId) ? {
          customer_id: selectedCustomerId,
          branch_id: activeBranchId,
          last_purchase_date: new Date().toISOString()
      } : null;

      // 📦 THE MASTER ATOMIC PAYLOAD 📦
      const atomicPayload = {
          invoice_summary: summaryRow,
          is_edit: !!editingInvoiceId,
          deleted_sale_ids: deletedSaleIds,
          insert_sales: activeTab === 'wholesale' ? rowsWithoutId : [],
          update_sales: activeTab === 'wholesale' ? rowsWithId : [],
          insert_retail_sales: activeTab === 'retail' ? rowsWithoutId : [],
          update_retail_sales: activeTab === 'retail' ? rowsWithId : [],
          payments: mappedPayments,
          stock_updates: Object.entries(stockUpdates).map(([id, delta]) => ({ product_id: id, delta })),
          batch_updates: Object.entries(fifoUpdates).map(([id, delta]) => ({ batch_id: id, delta })),
          new_batches: newBatchesToCreate,
          customer_update: customerUpdatePayload
      };

      // 🚀 ONE SECURE TRIP TO THE DATABASE
      const { error: atomicError } = await supabase.rpc('process_checkout', { p_payload: atomicPayload });
      
      if (atomicError) {
          throw new Error(`Transaction Failed: ${atomicError.message}`);
      }

      // 🔥 FIRE TELEGRAM ALERTS FOR DEDUCTED STOCK
      for (const [prodIdStr, delta] of Object.entries(stockUpdates)) {
          const numericDelta = Number(delta);
          if (numericDelta < 0) {
              const prod = latestProducts.find(p => p.id === Number(prodIdStr));
              if (prod) {
                  const previousStock = Number(prod.stock || 0);
                  const updatedStock = previousStock + numericDelta;

                  const crossedMinStock = previousStock > (prod.min_stock_level || 0) && updatedStock <= (prod.min_stock_level || 0) && updatedStock > 0;
                  const hitZero = previousStock > 0 && updatedStock === 0;
                  const wentNegativeFirstTime = previousStock >= 0 && updatedStock < 0;

                  if (crossedMinStock || hitZero || wentNegativeFirstTime) {
                      triggerStockAlert(prod.name, updatedStock, Number(prod.min_stock_level) || 0, Number(prod.weight) || 50);
                  }
              }
          }
      }

      const currentDate = new Date();
      setCompletedSale({
        invoiceNo: activeTxId, 
        cartSnapshot: currentCart, 
        customer: { name: finalCustomerName, phone: finalPhone, location: finalLocation },
        dateObj: { day: String(currentDate.getDate()).padStart(2, '0'), month: String(currentDate.getMonth() + 1).padStart(2, '0'), year: currentDate.getFullYear() },
        changeDue: actualRemaining < 0 ? Math.abs(actualRemaining) : 0,
        amountReceived: actualTotalReceived + depositTotalRiel 
      });

      if (activeTab === 'wholesale' && !isSimpleCustomer) {
        setIsGeneratingPreview(true);
        setShowInvoicePreview(true);
        setSaleSummary(null);
      } else {
        setShowInvoicePreview(false);
        setSaleSummary({ 
          total: currentTotalRiel + depositTotalRiel, 
          receivedRiel: 0, 
          receivedUsd: 0, 
          totalReceivedInRiel: actualTotalReceived + depositTotalRiel,
          change: actualRemaining < 0 ? Math.abs(actualRemaining) : 0, 
          type: activeTab, 
          isCashless: (actualTotalReceived + depositTotalRiel) === 0, 
          items: currentCart,
          isDebt: actualRemaining > 0 && !isSimpleCustomer
        });
      }

      setCart([]);
      localStorage.removeItem('pos_cart'); 
      setIsMobileCartOpen(false);
      setEditingInvoiceId(null);
      window.history.replaceState({}, document.title, window.location.pathname);
      loadProductsAndSettings();
      loadBatches();
      loadMtdSales();

      if (activeTab === 'wholesale') {
        const walkInCust = customers.find(c => c.name.toLowerCase() === 'walk-in' || c.name.toLowerCase() === 'walk in');
        if (walkInCust) setSelectedCustomerId(walkInCust.id.toString());
      } else {
        setSelectedCustomerId('');
      }

    } catch (err: any) {
      showToast('error', 'System Error', err.message || String(err));
    } finally {
      setIsProcessing(false);
      setPaymentRows([{ id: Date.now(), method: 'Cash ៛', amount: '', isAuto: true }]);
    }
  }

  async function executeAutoSaveOnly(dataUrl: string, invoiceId: string) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const secureUUID = typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID() 
        : Math.random().toString(36).substring(2) + Date.now().toString(36);
        
      const fileName = `${invoiceId}-${secureUUID}.png`; 
      
      const { error: uploadError } = await supabase.storage.from('invoices').upload(fileName, blob, { 
        contentType: 'image/png' 
      });
      
      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('invoices').getPublicUrl(fileName);
        await supabase.from('sales').update({ invoice_url: publicUrlData.publicUrl }).eq('invoice_id', invoiceId).eq('branch_id', activeBranchId);
        await supabase.from('invoice_summaries').update({ invoice_url: publicUrlData.publicUrl }).eq('invoice_id', invoiceId).eq('branch_id', activeBranchId);
      } else {
        console.error("Supabase Storage Error:", uploadError.message);
      }
    } catch (error: any) {
      console.error("Auto-capture cloud upload failed:", error);
    }
  }

  const handleDesktopDownloadPNG = () => {
    if (!previewImageUrl || !completedSale) return;
    const link = document.createElement('a');
    link.download = `Invoice-${completedSale.invoiceNo}.png`;
    link.href = previewImageUrl;
    link.click();
  }

  const handleMobileShare = async () => {
    if (!previewImageUrl || !completedSale) return;
    try {
      const res = await fetch(previewImageUrl);
      const blob = await res.blob();
      const file = new File([blob], `Invoice-${completedSale.invoiceNo}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Invoice ${completedSale.invoiceNo}` });
      } else {
        handleDesktopDownloadPNG();
      }
    } catch (err) { console.error(err); }
  }

  const handleNativePrint = () => { window.print(); }

  const currentT = t[lang] || t['en'];
  
  // 🔥 PERFORMANCE FIX: Cache the Cart Sort so typing quantities is perfectly smooth
  const sortedCart = React.useMemo(() => {
    return [...cart].sort((a, b) => {
      const getPriority = (item: CartItem) => {
        const name = item.custom_name || item.name || '';
        if (name.includes('ដូរ')) return -2;
        if (name.includes('បានប្រើ')) return -1;
        if (name.includes('បញ្ចុះតម្លៃ') || name.includes('កក់')) return 999;
        return 0; // Regular rice and bags stay in their exact paired sequence
      };
      const pA = getPriority(a);
      const pB = getPriority(b);
      if (pA !== pB) return pA - pB;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }, [cart]);

  // 🔥 PERFORMANCE FIX: The Massive Grid Cache. This prevents the entire product board from reloading when you click the cart!
  const filteredProducts = React.useMemo(() => {
    // 1. Initial Order
    const ordered = [...products].sort((a, b) => {
      const idxA = productOrder.indexOf(a.id);
      const idxB = productOrder.indexOf(b.id);
      if (idxA === -1 && idxB === -1) return a.id - b.id;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    // 2. Filter
    const filtered = ordered.filter(p => {
      if (searchQuery && !p.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      const weightVal = parseFloat(String(p.weight) || '0');
      
      if (activeTab === 'wholesale' && weightVal <= 1) return false; 
      if (activeTab === 'retail' && weightVal > 1) return false;

      const isHidden = hiddenRetailIds.includes(p.id);

      if (activeTab === 'retail') {
        if (retailSubTab === 'active' && isHidden) return false;
        if (retailSubTab === 'inactive' && !isHidden) return false;
      }

      if (activeTab === 'wholesale') {
        if (isHidden) return false; 
        if (activeCategory === '❌ Out of Stock') return Number(p.stock) <= 0;
      }

      if (activeTab !== 'retail' && activeCategory !== 'All' && activeCategory !== '❌ Out of Stock') {
        if (activeCategory === '🔥 Hot') {
          const top10Ids = Object.entries(mtdSalesStats).sort(([,a], [,b]) => b - a).slice(0, 10).map(([id]) => Number(id));
          return top10Ids.includes(p.id);
        }
        
        const name = p.name || '';
        if (activeCategory === 'ផ្សេងៗ') {
          if (MAIN_KEYWORDS.some(kw => name.includes(kw))) return false;
        } else {
          if (!name.includes(activeCategory)) return false;
        }
      }
      return true;
    });

    // 3. Final Sort
    filtered.sort((a, b) => {
      // 🚨 OVERRIDE 1: "Hot" category sorts purely by sales volume
      if (activeTab === 'wholesale' && activeCategory === '🔥 Hot') {
        return (mtdSalesStats[b.id] || 0) - (mtdSalesStats[a.id] || 0);
      }

      // 🚨 OVERRIDE 2: Retail manual price sort button
      if (activeTab === 'retail' && retailPriceSort !== 'none') {
        const priceA = Number(a.price || 0);
        const priceB = Number(b.price || 0);
        return retailPriceSort === 'asc' ? priceA - priceB : priceB - priceA;
      }

      // 🚦 DEFAULT: Master Category Sort (Groups by family, then price high-to-low)
      const priceKeyToCompare = activeTab === 'retail' ? 'price' : 'cost_price';
      
      // Grab the dynamic wholesale COGS if applicable
      const aCompare = { ...a };
      const bCompare = { ...b };
      if (activeTab === 'wholesale') {
        aCompare.cost_price = Number(activeBatches[a.id]?.[0]?.cost_price || a.cost_price || 0);
        bCompare.cost_price = Number(activeBatches[b.id]?.[0]?.cost_price || b.cost_price || 0);
      }
      
      return riceCategoryComparator(aCompare, bCompare, priceKeyToCompare);
    });

    return filtered;
  }, [products, productOrder, searchQuery, activeTab, activeCategory, hiddenRetailIds, retailSubTab, mtdSalesStats, retailPriceSort, activeBatches]);

  const filteredCustomers = customers.filter(c => 
    (c.name || '').toLowerCase().includes(customerSearchTerm.toLowerCase()) || (c.phone || '').includes(customerSearchTerm)
  )
  const selectedCustomer = customers.find(c => c.id.toString() === selectedCustomerId.toString())

  // 🔥 FIX: Added safe optional chaining (?.) to prevent 'possibly undefined' errors
  const isSimpleCustomer = !selectedCustomer || ['walk-in', 'walk in', 'mom'].includes((selectedCustomer?.name || '').toLowerCase());
  const showPaymentSelector = activeTab === 'retail' || isSimpleCustomer;

  // 🔥 PERFORMANCE FIX: Prevent payment math from recalculating 100 times when you type an amount
  const liveTotalReceivedInRiel = React.useMemo(() => {
    return paymentRows.reduce((sum, row) => {
      const amt = Number(row.amount) || 0;
      if (row.method.includes('$')) return sum + (amt * EXCHANGE_RATE);
      return sum + amt;
    }, 0);
  }, [paymentRows]);

  const hasValidPayment = !showPaymentSelector || liveTotalReceivedInRiel >= totalRiel;

  const getCategorizedItemsForInvoice = (cartItems: any[]) => {
    let normalItems: any[] = [], specialItems: any[] = [], negativeItems: any[] = [], serviceItems: any[] = [];
    cartItems.forEach(item => {
      if (Number(item.custom_price_riel) === 0) return;

      const desc = item.custom_name;
      const total = item.custom_price_riel * item.quantity;
      if (desc.includes('សេវាឡាន (អតិថិជន)')) serviceItems.push({ ...item, total: total });
      else if (desc.includes('សេវាឡាន')) {  }
      else if (desc.includes('ដូរ') || desc.includes('បញ្ចុះតម្លៃ') || desc.includes('កក់')) negativeItems.push({ ...item, total: -Math.abs(total) });
      else if (desc.includes('ថ្លៃបាវ') || desc.includes('បានប្រើ')) specialItems.push({ ...item, total: total });
      else normalItems.push({ ...item, total: total });
    });
    return [...normalItems, ...specialItems, ...negativeItems, ...serviceItems];
  }

  const renderPaymentSection = (isMobileCart: boolean = false) => {
    if (!showPaymentSelector) return null;
    return (
      <div style={{ marginBottom: '10px', padding: '4px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Receive</span>
            <button onClick={() => setPaymentRows([...paymentRows, { id: Date.now(), method: 'Cash ៛', amount: '', isAuto: false }])} style={{ background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', cursor: 'pointer' }}>+ Split</button>
          </div>
        </div>
        
        {paymentRows.map((row, index) => (
          <div key={row.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
            <select 
              value={row.method} 
              onChange={e => {
                const newRows = [...paymentRows];
                newRows[index].method = e.target.value;
                setPaymentRows(newRows);
              }}
              className="saas-input"
              style={{ width: '45%', cursor: 'pointer', padding: '8px' }}
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
                onFocus={() => {
                  if (row.isAuto) {
                    const newRows = [...paymentRows];
                    newRows[index].amount = '';
                    newRows[index].isAuto = false;
                    setPaymentRows(newRows);
                  }
                }}
                onChange={(val: any) => {
                  // 🔥 RELIABILITY & TS FIX: Strip commas, then convert back to number to satisfy `number | ''` type
                  const newRows = [...paymentRows];
                  const cleanVal = String(val).replace(/,/g, '');
                  newRows[index].amount = cleanVal === '' ? '' : Number(cleanVal);
                  newRows[index].isAuto = false;
                  setPaymentRows(newRows);
                }}
                className="saas-input"
                style={{ width: '100%', textAlign: 'right', padding: '8px' }}
              />
            </div>
            
            {paymentRows.length > 1 && (
              <button onClick={() => setPaymentRows(paymentRows.filter(r => r.id !== row.id))} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '16px', cursor: 'pointer', padding: '0 4px', fontWeight: 'bold' }}>✕</button>
            )}
          </div>
        ))}
      </div>
    )
  }

  const renderCartAdjustmentsToolbar = () => (
    <div style={{ position: 'relative', marginBottom: '12px' }}>
      <button 
        onClick={() => setShowAdjustmentMenu(!showAdjustmentMenu)} 
        style={{ width: '100%', padding: '8px 12px', fontSize: '12px', fontWeight: 'bold', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#334155', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>+ Add Adjustment / Fee</span>
        <span>{showAdjustmentMenu ? '▲' : '▼'}</span>
      </button>

      {showAdjustmentMenu && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: '6px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 8px 20px rgba(0,0,0,0.15)', zIndex: 50, overflow: 'hidden' }}>
          <button 
            onClick={() => { setAdjustmentModal({ isOpen: true, type: 'discount', amount: '', qty: 1, note: '', isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false }); setShowAdjustmentMenu(false); }} 
            style={{ width: '100%', padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid #f1f5f9', fontSize: '13px', color: '#334155', cursor: 'pointer', display: 'block' }}
          >
            🏷️ Discount (បញ្ចុះតម្លៃ)
          </button>
          
          {/* 🔥 ONLY SHOW DEPOSIT IF IT IS A WHOLESALE CUSTOMER WITH AN ACCOUNT */}
          {!isSimpleCustomer && activeTab === 'wholesale' && (
            <button 
              onClick={() => { setAdjustmentModal({ isOpen: true, type: 'deposit', amount: '', qty: 1, note: '', isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false }); setShowAdjustmentMenu(false); }} 
              style={{ width: '100%', padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid #f1f5f9', fontSize: '13px', color: '#334155', cursor: 'pointer', display: 'block' }}
            >
              💵 Deposit / Prepayment (កក់)
            </button>
          )}

          <button 
            onClick={() => { setAdjustmentModal({ isOpen: true, type: 'bag', amount: 1000, qty: 1, note: '', isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false }); setShowAdjustmentMenu(false); }} 
            style={{ width: '100%', padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', fontSize: '13px', color: '#334155', cursor: 'pointer', display: 'block' }}
          >
            🛍️ Bag Fee (ថ្លៃបាវ)
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', width: '100%', height: '100dvh', overflow: 'hidden', backgroundColor: '#ffffff', boxSizing: 'border-box' }}>
      
      {/* SELECTION ENGINE VIEW GRID PANEL */}
      <div className="hide-scrollbar" style={{ flex: 1, height: '100%', overflowY: 'auto', backgroundColor: '#f8fafc', minWidth: 0, WebkitOverflowScrolling: 'touch' }}>
        
        <div className="main-wrapper">
          
          {/* 🟢 STICKY HEADER WRAPPER AROUND TITLE, TABS & SEARCH */}
          <div className="pos-sticky-header">
            <div className="header-container" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="header-left" style={{ flex: 1, minWidth: 0, marginRight: '12px' }}>
                <h1 className="saas-page-title" style={{ margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {editingInvoiceId ? `✏️ Editing: ${editingInvoiceId}` : `🛒 ${currentT.title}`}
                </h1>
              </div>
              {editingInvoiceId && (
                <button 
                  onClick={cancelEditMode} 
                  className="saas-btn saas-btn-danger"
                  style={{ flexShrink: 0, padding: '6px 16px', fontSize: '13px', fontWeight: 'bold' }}
                >
                  ❌ Cancel
                </button>
              )}
            </div>

            {/* 🔥 FIX: Removed the bottom margin for Retail so it snaps perfectly to the grid below */}
            <div style={{ marginBottom: activeTab === 'retail' ? '0' : '16px' }}>
              <div className="saas-tab-container hide-scrollbar" style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', marginBottom: activeTab === 'retail' ? '12px' : '0px', width: '100%' }}>
                <button onClick={() => { 
                  setActiveTab('retail'); 
                  setSelectedCustomerId(''); 
                  setCustomerSearchTerm(''); 
                  // 🔥 PERFORMANCE FIX: Deleted the database load functions! Websockets handle data now.
                }} className={`saas-tab ${activeTab === 'retail' ? 'active' : ''}`} style={{ flex: 1, minWidth: '120px', textAlign: 'center' }}>
                  {currentT.retail}
                </button>
                
                <button onClick={() => { 
                  setActiveTab('wholesale');
                  if (!selectedCustomerId) {
                    const walkInCust = customers.find(c => c.name.toLowerCase() === 'walk-in' || c.name.toLowerCase() === 'walk in');
                    if (walkInCust) setSelectedCustomerId(walkInCust.id.toString());
                  }
                  // 🔥 PERFORMANCE FIX: Deleted the database load functions! Websockets handle data now.
                }} className={`saas-tab ${activeTab === 'wholesale' ? 'active' : ''}`} style={{ flex: 1, minWidth: '120px', textAlign: 'center' }}>
                  {currentT.wholesale}
                </button>
              </div>

              {activeTab === 'retail' && (
                <div className="hide-scrollbar" style={{ display: 'flex', flexWrap: 'nowrap', gap: '8px', alignItems: 'center', overflowX: 'auto', width: '100%', paddingBottom: '4px' }}>
                  
                  {/* 🔥 RESTORED ACTIVE/INACTIVE CONTAINER (Cleaned of Drag-and-Drop) */}
                  <div className="hide-scrollbar" style={{ flex: 1, display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', background: '#f8fafc', border: '1px solid #e2e8f0', height: '48px', padding: '4px', boxSizing: 'border-box', borderRadius: '8px', alignItems: 'center' }}>
                    <button 
                      onClick={() => setRetailSubTab('active')} 
                      style={{ flex: 1, height: '100%', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', borderRadius: '6px', fontSize: '13px', whiteSpace: 'nowrap', border: 'none', background: retailSubTab === 'active' ? '#b58a3d' : 'transparent', color: retailSubTab === 'active' ? '#fff' : '#64748b', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                      Active ({products.filter(p => parseFloat(String(p.weight)) < 50 && !hiddenRetailIds.includes(p.id)).length})
                    </button>
                    
                    <button 
                      onClick={() => setRetailSubTab('inactive')} 
                      style={{ 
                        flex: 1, 
                        height: '100%', 
                        margin: 0, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        padding: '0 12px', 
                        borderRadius: '8px', 
                        fontSize: '14px',
                        whiteSpace: 'nowrap',
                        border: 'none',
                        background: retailSubTab === 'inactive' ? '#ef4444' : 'transparent',
                        color: retailSubTab === 'inactive' ? '#fff' : '#64748b',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Non-Active ({products.filter(p => parseFloat(String(p.weight)) < 50 && hiddenRetailIds.includes(p.id)).length})
                    </button>
                  </div>
                  
                  {/* 🟢 SQUARE ADD BUTTON (42px Height) */}
                  <button 
                    onClick={() => {
                        setNewItem({ name: '', price: '' as any, cost_price: '' as any, weight: 1, stock: '' as any, min_stock_level: 10, linked_wholesale_id: '' as any });
                        setIsAddModalOpen(true);
                    }} 
                    className="saas-btn" 
                    style={{ 
                      flexShrink: 0, 
                      background: '#10b981', 
                      color: '#fff', 
                      width: isDeviceMobile ? '42px' : 'auto',
                      height: '42px',
                      padding: isDeviceMobile ? '0' : '0 16px', 
                      borderRadius: '8px', 
                      fontWeight: 'bold', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      gap: '6px', 
                      border: 'none', 
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)', 
                      cursor: 'pointer' 
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    {!isDeviceMobile && <span>Add New</span>}
                  </button>
                  
                  {/* 🟢 SQUARE SORT BUTTON (42px Height) WITH SLIM VECTOR */}
                  <button 
                    onClick={() => {
                        const next = retailPriceSort === 'none' ? 'desc' : retailPriceSort === 'desc' ? 'asc' : 'none';
                        setRetailPriceSort(next);
                        localStorage.setItem('pos_retail_price_sort', next);
                    }} 
                    className="saas-btn saas-btn-secondary" 
                    style={{ 
                      flexShrink: 0, 
                      color: retailPriceSort !== 'none' ? '#3b82f6' : '#0f172a', 
                      width: isDeviceMobile ? '42px' : 'auto',
                      height: '42px',
                      padding: isDeviceMobile ? '0' : '0 16px', 
                      borderRadius: '8px', 
                      fontWeight: 'bold', 
                      fontSize: '13px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      gap: '4px', 
                      cursor: 'pointer',
                      border: '1px solid #cbd5e1',
                      background: retailPriceSort !== 'none' ? '#eff6ff' : '#ffffff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>
                    </div>
                    {retailPriceSort === 'desc' && <span style={{ marginLeft: isDeviceMobile ? '0' : '4px', fontSize: '12px' }}>↓</span>}
                    {retailPriceSort === 'asc' && <span style={{ marginLeft: isDeviceMobile ? '0' : '4px', fontSize: '12px' }}>↑</span>}
                    {!isDeviceMobile && <span style={{ marginLeft: '4px' }}>Sort Price</span>}
                  </button>
                </div>
              )}
            </div>

            {/* 🔥 FIX: Completely collapse this wrapper on Retail to prevent invisible flex gaps */}
            <div style={{ display: activeTab === 'retail' ? 'none' : 'flex', flexDirection: 'column', gap: '16px', width: '100%', minWidth: 0 }}>
              
              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '8px', alignItems: 'flex-start', width: '100%' }}>
                {/* ❌ REMOVED PRODUCT SEARCH INPUT HERE */}
                
                {/* CUSTOMER SEARCH */}
                {activeTab === 'wholesale' && (
                  <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                    {!selectedCustomer ? (
                      <div style={{ position: 'relative' }}>
                        
                        {/* 💻 DESKTOP: INLINE SEARCH INPUT */}
                        {!isDeviceMobile && (
                          <>
                            {isCustomerModalOpen && (
                              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onMouseDown={() => setIsCustomerModalOpen(false)}></div>
                            )}
                            
                            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '16px', zIndex: isCustomerModalOpen ? 101 : 2 }}>🔍</span>
                            <input 
                              type="text"
                              placeholder={currentT.selectCustomer.replace('🔍 ', '').replace('🔍', '').trim()}
                              value={customerSearchTerm}
                              onChange={e => setCustomerSearchTerm(e.target.value)}
                              onFocus={() => setIsCustomerModalOpen(true)}
                              className="saas-input"
                              style={{ paddingLeft: '38px', width: '100%', position: 'relative', zIndex: isCustomerModalOpen ? 100 : 1, borderColor: isCustomerModalOpen ? '#3b82f6' : undefined, fontSize: isDeviceMobile ? '15px' : '14px', height: '42px', boxSizing: 'border-box' }}
                            />

                            {/* 💻 DESKTOP: INLINE DROPDOWN TRAY (Fillout Card Style) */}
                            {isCustomerModalOpen && (
                              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', zIndex: 101, overflow: 'hidden' }}>
                                <div className="hide-scrollbar" style={{ maxHeight: '350px', overflowY: 'auto', padding: '12px', backgroundColor: '#ffffff' }}>
                                  
                                  <button onClick={(e) => { e.preventDefault(); setIsCreateCustomerModalOpen(true); setIsCustomerModalOpen(false); }} className="saas-btn" style={{ width: '100%', padding: '10px', backgroundColor: '#ffffff', color: '#0f172a', border: '1px dashed #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
                                    <span style={{ fontSize: '16px' }}>+</span> Add New Customer
                                  </button>
                                  
                                  {filteredCustomers.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '14px' }}>No customers found</div>
                                  ) : (
                                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                                      {filteredCustomers.map((c, index) => (
                                        <div 
                                          key={c.id} 
                                          onClick={(e) => { e.preventDefault(); setSelectedCustomerId(c.id.toString()); setCustomerSearchTerm(''); setIsCustomerModalOpen(false); }} 
                                          style={{ padding: '12px 16px', cursor: 'pointer', backgroundColor: '#ffffff', borderBottom: index === filteredCustomers.length - 1 ? 'none' : '1px solid #e2e8f0' }}
                                        >
                                          <div style={{ fontWeight: 500, fontSize: '14px', color: '#0f172a', marginBottom: '8px' }}>{c.name}</div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                              <div style={{ fontSize: '13px', color: '#64748b' }}>Location: {c.location || '-'}</div>
                                              <div style={{ fontSize: '13px', color: '#64748b' }}>Phone Number: {c.phone || '-'}</div>
                                            </div>
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault(); e.stopPropagation();
                                                setSelectedCustomerId(c.id.toString());
                                                setCartCustomerEditForm({ name: c.name || '', phone: c.phone || '', location: c.location || '', google_map: (c as any).google_map || '' });
                                                setIsCartCustomerEditOpen(true); setIsCustomerModalOpen(false);
                                              }}
                                              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontSize: '13px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#475569', cursor: 'pointer', fontWeight: 500 }}
                                            >
                                              Edit <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}

                       {/* 📱 MOBILE: MODAL TRIGGER BUTTON */}
                        {isDeviceMobile && (
                          <>
                            <div 
                              onClick={() => setIsCustomerModalOpen(true)}
                              className="saas-input"
                              style={{ width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', backgroundColor: '#ffffff', color: '#94a3b8', fontSize: '15px', paddingLeft: '14px', height: '42px', boxSizing: 'border-box' }}
                            >
                              <span style={{ marginRight: '6px', fontSize: '16px' }}>🔍</span>
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search customers...</span>
                            </div>

                            {/* 📱 MOBILE: TOP-ANCHORED SEARCH MODAL (Fillout Style) */}
                            {isCustomerModalOpen && typeof document !== 'undefined' && createPortal(
                              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', zIndex: 100000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'max(16px, env(safe-area-inset-top, 16px)) 16px 16px 16px' }} onMouseDown={() => { setIsCustomerModalOpen(false); setCustomerSearchTerm(''); }}>
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
                                        placeholder="Search for option..."
                                        value={customerSearchTerm}
                                        onChange={e => setCustomerSearchTerm(e.target.value)}
                                        style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: '14px', border: '1px solid #3b82f6', borderRadius: '6px', outline: 'none', color: '#0f172a', boxSizing: 'border-box' }}
                                      />
                                    </div>
                                    <button onClick={(e) => { e.preventDefault(); setIsCustomerModalOpen(false); setCustomerSearchTerm(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      ✕
                                    </button>
                                  </div>
                                  
                                  <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: '#f8fafc' }}>
                                    <button onClick={(e) => { e.preventDefault(); setIsCreateCustomerModalOpen(true); setIsCustomerModalOpen(false); }} className="saas-btn" style={{ width: '100%', padding: '12px', backgroundColor: '#ffffff', color: '#0f172a', border: '1px dashed #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
                                      <span style={{ fontSize: '16px' }}>+</span> Add New Customer
                                    </button>

                                    {filteredCustomers.length === 0 ? (
                                      <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '14px' }}>No customers found</div>
                                    ) : (
                                      <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                                        {filteredCustomers.map((c, index) => (
                                          <div 
                                            key={c.id} 
                                            onClick={(e) => { e.preventDefault(); setSelectedCustomerId(c.id.toString()); setCustomerSearchTerm(''); setIsCustomerModalOpen(false); }} 
                                            style={{ padding: '12px 16px', cursor: 'pointer', backgroundColor: '#ffffff', borderBottom: index === filteredCustomers.length - 1 ? 'none' : '1px solid #e2e8f0' }}
                                          >
                                            <div style={{ fontWeight: 500, fontSize: '14px', color: '#0f172a', marginBottom: '8px' }}>{c.name}</div>
                                            
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ fontSize: '13px', color: '#64748b' }}>Location: {c.location || '-'}</div>
                                                <div style={{ fontSize: '13px', color: '#64748b' }}>Phone Number: {c.phone || '-'}</div>
                                              </div>
                                              <button
                                                onClick={(e) => {
                                                  e.preventDefault(); e.stopPropagation();
                                                  setSelectedCustomerId(c.id.toString());
                                                  setCartCustomerEditForm({ name: c.name || '', phone: c.phone || '', location: c.location || '', google_map: (c as any).google_map || '' });
                                                  setIsCartCustomerEditOpen(true); setIsCustomerModalOpen(false);
                                                }}
                                                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontSize: '13px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#475569', cursor: 'pointer', fontWeight: 500 }}
                                              >
                                                Edit <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>,
                              document.body
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="saas-input" style={{ backgroundColor: '#fefcf3', borderColor: '#eadeca', color: '#4a3b1b', position: 'relative', display: 'flex', alignItems: 'center', paddingRight: '36px', height: '42px', boxSizing: 'border-box' }}>
                        <button onClick={() => { setSelectedCustomerId(''); setCustomerSearchTerm(''); }} style={{ position: 'absolute', top: '50%', right: '8px', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        
                        {/* 🔥 NEW: Clean, truncated single-line view so it fits easily side-by-side with product search */}
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}>
                          <div style={{ fontWeight: 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '6px', fontSize: isDeviceMobile ? '15px' : '14px' }}>
                            <span style={{ fontSize: isDeviceMobile ? '15px' : '14px' }}>👤</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCustomer.name}</span>
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SCROLLABLE CATEGORY TABS WITH MIX & IMPORT BUTTONS APPENDED */}
              {activeTab !== 'retail' && (
                // 🔥 FIX: Added maxWidth: '100%' and paddingBottom to smoothly allow scroll without clipping drop shadows
                <div className="saas-tab-container hide-scrollbar" style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, border: 'none', boxShadow: 'none', padding: '0 4px 8px 4px', background: 'transparent', gap: '8px', margin: 0 }}>
                  
                  {/* 🔥 ADDED DIRECT HORIZONTAL SORTING */}
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={riceCategories} strategy={horizontalListSortingStrategy}>
                      {riceCategories.map(cat => (
                        <SortableHorizontalTab 
                          key={cat} 
                          cat={cat} 
                          isActive={activeCategory === cat} 
                          lang={lang} 
                          onClick={() => setActiveCategory(cat)} 
                        />
                      ))}
                    </SortableContext>
                  </DndContext>

                  {/* ⚙️ NEW: SETTINGS BUTTON FOR CATEGORY ORDER */}
                  <button 
                    onClick={() => setIsCategorySettingsOpen(true)} 
                    className="saas-tab" 
                    style={{ padding: '8px 16px', fontSize: '14px', minWidth: 'max-content', borderRadius: '20px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', cursor: 'pointer' }}
                    title="Manage Categories"
                  >
                    ⚙️
                  </button>
                  
                  {/* 🟢 NEW APPENDED INLINE TOOLS */}
                  <button 
                    onClick={() => setActiveFullScreen('import')}
                    className="saas-tab"
                    style={{ padding: '8px 16px', fontSize: '14px', borderRadius: '20px', minWidth: 'max-content', border: '1px dashed #3b82f6', background: '#eff6ff', color: '#1d4ed8', fontWeight: 'bold', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', cursor: 'pointer' }}
                  >
                    📦 Import Stock
                  </button>
                  <button 
                    onClick={() => setActiveFullScreen('mix')}
                    className="saas-tab"
                    style={{ padding: '8px 16px', fontSize: '14px', borderRadius: '20px', minWidth: 'max-content', border: '1px dashed #8b5cf6', background: '#f5f3ff', color: '#6d28d9', fontWeight: 'bold', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', cursor: 'pointer' }}
                  >
                    🥣 Mix Rice
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* 🟢 END STICKY HEADER WRAPPER */}

          <div>
            {filteredProducts.length === 0 ? (
              <EmptyState 
                icon="📦" 
                title={currentT.noProducts} 
                message="Try adjusting your search or filters." 
              />
            ) : isDeviceMobile ? (
              /* 📱 MOBILE: COMPACT HORIZONTAL NUMBERED LIST (Saves Massive Space) */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredProducts.map((p, index) => (
                  <div
                    key={p.id}
                    onClick={() => handleProductClick(p)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s'
                    }}
                    onMouseDown={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                    onMouseUp={e => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
                  >
                   {/* 1. Left Column: Row Number & Rice Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                      <span style={{
                        minWidth: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        backgroundColor: '#f1f5f9',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        flexShrink: 0
                      }}>
                        {index + 1}
                      </span>
                      <span style={{
                        fontSize: '15px',
                        color: '#1e293b',
                        fontWeight: 'normal',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {p.name}
                      </span>
                    </div>

                    {/* 2. Middle Column: COGS / Price */}
                    <div style={{ fontSize: '14px', color: '#b58a3d', fontWeight: 'bold', flexShrink: 0, padding: '0 8px', textAlign: 'right' }}>
                      {formatRielSymbol(
                        activeTab === 'retail'
                          ? (p.price || 0)
                          : (activeBatches[p.id]?.[0]?.cost_price || p.cost_price || 0)
                      )}
                    </div>

                    {/* 3. Right Column: Stock & Return Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <div style={{ fontSize: '12px', color: Number(p.stock) < (activeTab === 'retail' ? 15 : 5) ? '#dc2626' : '#10b981', fontWeight: 'bold' }}>
                        📦 {p.stock}{activeTab === 'retail' ? ' kg' : ''}
                      </div>

                      {activeTab === 'wholesale' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExchangeModal({ isOpen: true, product: p, consumedKg: '' });
                          }}
                          style={{
                            background: '#fef2f2',
                            color: '#ef4444',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '13px',
                            cursor: 'pointer'
                          }}
                          title="Exchange / Return"
                        >
                          🔄
                        </button>
                     )}
                    </div>
                  </div>
                ))}

                {/* ⚙️ MOBILE CARD AT THE END OF THE LIST */}
                <div
                  onClick={() => setIsVisibilitySettingsOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '2px dashed #cbd5e1', cursor: 'pointer', marginTop: '4px' }}
                >
                  <span style={{ fontSize: '16px', marginRight: '8px' }}>⚙️</span>
                  <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 'bold' }}>Hide / Show Rice</span>
                </div>

              </div>
            ) : (
              /* 💻 LAPTOP: ORIGINAL UNTOUCHED CARD GRID */
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' }}>
                {filteredProducts.map((p) => (
                  <div 
                    key={p.id} 
                    draggable={true} 
                    onDragStart={(e) => handleProductDragStart(e, p.id)} 
                    onDragOver={handleProductDragOver} 
                    onDrop={(e) => handleProductDrop(e, p.id)} 
                    onClick={() => handleProductClick(p)} 
                    className="saas-card"
                    style={{ padding: '14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '100px', transition: 'transform 0.1s', position: 'relative' }} 
                    onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }} 
                    onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '14px', color: '#334155', marginBottom: '8px', fontWeight: 'normal' }}>{p.name}</div>
                    </div>

                    <div style={{ borderTop: '1px dashed #f1f5f9', paddingTop: '8px', marginTop: 'auto', position: 'relative', minHeight: activeTab === 'wholesale' ? '35px' : 'auto' }}>
                      <div style={{ fontSize: '14px', color: '#b58a3d', fontWeight: 'bold' }}>
                        {formatRielSymbol(
                          activeTab === 'retail' 
                            ? (p.price || 0) 
                            : (activeBatches[p.id]?.[0]?.cost_price || p.cost_price || 0)
                        )}
                      </div>
                      
                      {activeTab === 'retail' && (
                        <div style={{ fontSize: '11px', marginTop: '4px', color: Number(p.stock) < 15 ? '#dc2626' : '#10b981', fontWeight: 'bold' }}>
                          📦 {p.stock} kg left
                        </div>
                      )}

                      {activeTab === 'wholesale' && (
                        <div style={{ fontSize: '11px', marginTop: '4px', color: Number(p.stock) < 5 ? '#dc2626' : '#10b981', fontWeight: 'bold' }}>
                          📦 {currentT.stock}: {p.stock}
                        </div>
                      )}
                      
                      {(activeTab === 'wholesale') && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setExchangeModal({ isOpen: true, product: p, consumedKg: '' }); }}
                          style={{ position: 'absolute', bottom: '-4px', right: '-4px', background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', borderRadius: '6px', padding: '4px 8px', fontSize: '14px', cursor: 'pointer' }}
                          title="Exchange / Return"
                        >
                          🔄
                        </button>
                     )}
                    </div>
                  </div>
                ))}

                {/* ⚙️ DESKTOP CARD AT THE END OF THE GRID */}
                <div 
                  onClick={() => setIsVisibilitySettingsOpen(true)}
                  className="saas-card"
                  style={{ padding: '14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100px', border: '2px dashed #cbd5e1', background: '#f8fafc', transition: 'transform 0.1s', boxShadow: 'none' }}
                  onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }} 
                  onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span style={{ fontSize: '24px', marginBottom: '8px' }}>⚙️</span>
                  <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold' }}>Hide / Show Rice</span>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>

      {/* DESKTOP SIDEBAR CART */}
      <div className="desktop-cart-panel" style={{ width: '400px', backgroundColor: '#ffffff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ paddingTop: '16px', paddingRight: '20px', paddingBottom: '16px', paddingLeft: '20px', borderBottom: '1px solid #f1f5f9', backgroundColor: '#f8fafc', flexShrink: 0 }}>
          <h2 style={{ fontSize: '16px', margin: 0, fontWeight: 'bold', color: '#334155' }}>{currentT.cartTitle} ({cart.length})</h2>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: '16px', paddingRight: '16px', paddingBottom: '16px', paddingLeft: '16px' }}>
          
          {activeTab === 'wholesale' && selectedCustomerId && (
            <div 
              onClick={() => {
                setCartCustomerEditForm({
                  name: cartCustomerNameOverride || selectedCustomer?.name || '',
                  phone: cartCustomerPhoneOverride || selectedCustomer?.phone || '',
                  location: cartCustomerLocationOverride || selectedCustomer?.location || '',
                  google_map: cartCustomerMapOverride || (selectedCustomer as any)?.google_map || ''
                });
                setIsCartCustomerEditOpen(true);
              }}
              style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            >
              <div style={{ fontSize: '15px', color: '#0f172a', fontWeight: 'normal' }}>{cartCustomerNameOverride || selectedCustomer?.name}</div>
              <span style={{ fontSize: '16px', color: '#3b82f6' }}>✏️</span>
            </div>
          )}

          {sortedCart.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: '40px', color: '#94a3b8' }}>{currentT.emptyCart}</div>
          ) : (
            sortedCart.map((item) => {
              const isReturn = item.custom_name.includes('ដូរ');
              const isCharge = item.custom_name.includes('បានប្រើ');
              const isSpecial = isReturn || isCharge || item.isSpecial;

              return (
                <div key={item.id} style={{ backgroundColor: isReturn ? '#fef2f2' : isCharge ? '#fffbeb' : '#ffffff', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px', border: `1px solid ${isReturn ? '#fecaca' : isCharge ? '#fde68a' : '#e2e8f0'}`, position: 'relative' }}>
                  <button onClick={() => removeFromCart(item.id)} style={{ position: 'absolute', top: '8px', right: '8px', background: '#fee2e2', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '11px', width: '22px', height: '22px', borderRadius: '50%', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', paddingRight: '28px', minWidth: 0 }}>
                    <input 
                      type="text" 
                      value={item.custom_name} 
                      onChange={(e) => updateCartItem(item.id, 'custom_name', e.target.value)}
                      placeholder="Item Name"
                      disabled={isSpecial}
                      style={{ 
                        fontSize: '14px', color: isReturn ? '#dc2626' : isCharge ? '#b45309' : '#334155', fontWeight: 'normal',
                        flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', padding: 0
                      }} 
                    />
                    
                    {!isSpecial && activeTab === 'wholesale' && (
                      <div style={{ position: 'relative', marginLeft: '8px' }}>
                        {/* Transparent Backdrop to close on outside click */}
                        {openBatchMenuId === item.id && (
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onMouseDown={(e) => { e.preventDefault(); setOpenBatchMenuId(null); }}></div>
                        )}
                        
                        {/* Trigger Button */}
                        <div 
                          onClick={(e) => { e.preventDefault(); setOpenBatchMenuId(openBatchMenuId === item.id ? null : item.id); }}
                          className="saas-input"
                          style={{ padding: '6px 10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', color: '#b58a3d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '160px' }}
                        >
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 'normal' }}>
                            {item.selected_batch_id 
                              ? (() => {
                                  const b = activeBatches[item.product_id]?.find(x => x.id === item.selected_batch_id);
                                  const remaining = b?.remaining_qty || 0;
                                  return b ? (
                                    <span style={{ color: remaining <= 0 ? '#ea580c' : 'inherit', fontWeight: remaining <= 0 ? 'bold' : 'normal' }}>
                                      {remaining <= 0 ? '⚠️ ' : ''}{formatRiel(b.cost_price)} ({remaining})
                                    </span>
                                  ) : '▼ Auto FIFO';
                                })()
                              : (() => {
                                  const defaultB = activeBatches[item.product_id]?.[0];
                                  const remaining = defaultB?.remaining_qty || 0;
                                  return defaultB && remaining <= 0 ? (
                                    <span style={{ color: '#ea580c', fontWeight: 'bold' }}>⚠️ Auto FIFO ({remaining})</span>
                                  ) : '▼ Auto FIFO';
                                })()}
                          </span>
                          <span style={{ fontSize: '10px', color: '#94a3b8', flexShrink: 0 }}>{openBatchMenuId === item.id ? '▲' : '▼'}</span>
                        </div>

                        {/* Custom Dropdown Menu Tray */}
                        {openBatchMenuId === item.id && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', minWidth: '240px', maxWidth: '280px', overflow: 'hidden' }}>
                            <div 
                              onMouseDown={(e) => { e.preventDefault(); updateCartItem(item.id, 'selected_batch_id', null); setOpenBatchMenuId(null); }}
                              style={{ padding: '12px 14px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', backgroundColor: !item.selected_batch_id ? '#f8fafc' : '#ffffff', color: '#0f172a', fontWeight: 'normal' }}
                            >
                              ▼ Auto FIFO (Default)
                            </div>
                            <div className="hide-scrollbar" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                              {activeBatches[item.product_id]?.map((b: any) => {
                                const remaining = b.remaining_qty || 0;
                                const isSelected = item.selected_batch_id === b.id;
                                return (
                                  <div 
                                    key={b.id}
                                    onMouseDown={(e) => { e.preventDefault(); updateCartItem(item.id, 'selected_batch_id', b.id); setOpenBatchMenuId(null); }}
                                    style={{ padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', backgroundColor: isSelected ? '#f8fafc' : '#ffffff', transition: 'background-color 0.1s' }}
                                  >
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#b58a3d', marginBottom: b.notes ? '4px' : '0' }}>
                                      {formatRiel(b.cost_price)} <span style={{ color: '#64748b', fontWeight: 'normal', fontSize: '12px' }}>({remaining} left)</span>
                                    </div>
                                    {b.notes && <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.4 }}>{b.notes}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', gap: activeTab === 'retail' ? '6px' : '8px', alignItems: 'center' }}>
                    {/* 1. Quantity Input */}
                    <div style={{ width: activeTab === 'retail' ? '65px' : '75px' }}>
                      <CurrencyInput 
                        value={item.quantity} 
                        onChange={(v: any) => updateCartItem(item.id, 'quantity', v)} 
                        onFocus={() => updateCartItem(item.id, 'quantity', '')} 
                        className="saas-input" 
                        style={{ textAlign: 'center', padding: '6px' }}
                        disabled={isSpecial}
                      />
                    </div>
                    
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>×</span>
                    
                    {/* 2. Unit Price Input */}
                    <div style={{ flex: 1 }}>
                      <CurrencyInput 
                        value={item.custom_price_riel} 
                        onChange={(v: any) => updateCartItem(item.id, 'custom_price_riel', v)} 
                        onFocus={() => updateCartItem(item.id, 'custom_price_riel', '')} 
                        className="saas-input" 
                        style={{ textAlign: activeTab === 'retail' ? 'center' : 'right', padding: '6px' }} 
                      />
                    </div>
                    
                    {/* 3. Editable Subtotal (ONLY SHOWS ON RETAIL TAB) */}
                    {activeTab === 'retail' && (
                      <>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>=</span>
                        <div style={{ flex: 1 }}>
                          <CurrencyInput 
                            value={Math.round((Number(item.quantity) || 0) * (Number(item.custom_price_riel) || 0))} 
                            onChange={(newTotal: any) => {
                              // When typing a new Total, auto-adjust the Unit Price
                              const qty = Number(item.quantity) || 1;
                              const newUnitPrice = Math.round(Number(newTotal) / qty);
                              updateCartItem(item.id, 'custom_price_riel', newUnitPrice);
                            }} 
                            className="saas-input" 
                            style={{ textAlign: 'right', padding: '6px', fontWeight: 'bold', color: '#0f172a', backgroundColor: '#f8fafc' }} 
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
        
        <div style={{ position: 'sticky', bottom: 0, paddingTop: '12px', paddingRight: '20px', paddingBottom: '16px', paddingLeft: '20px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexShrink: 0, zIndex: 10, boxShadow: '0 -4px 10px rgba(0,0,0,0.02)' }}>
          {renderCartAdjustmentsToolbar()}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', color: '#334155' }}>{currentT.totalKhmer}</span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: totalRiel < 0 ? '#ef4444' : '#b58a3d' }}>{formatRielFromNative(totalRiel)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>{currentT.totalUsd}</span>
            <span style={{ fontSize: '13px', color: '#475569' }}>{formatUSD(totalUSD)}</span>
          </div>

          {renderPaymentSection(false)}
          
          <button 
            onClick={initiateCheckout} 
            disabled={cart.length === 0 || isProcessing} 
            className={`saas-btn ${(cart.length === 0 || isProcessing) ? 'saas-btn-secondary' : 'saas-btn-primary'}`}
            style={{ width: '100%', padding: '16px', fontSize: '16px' }}
          >
            {isProcessing ? 'Processing...' : currentT.checkout}
          </button>
        </div>
      </div>

      {/* MOBILE CART TRAY */}
      {cart.length > 0 && !isMobileCartOpen && !completedSale && !saleSummary && (
        <div className="mobile-fab" onClick={() => setIsMobileCartOpen(true)}>
          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>🛒 View Cart ({cart.length})</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{formatRielFromNative(totalRiel)} &nbsp; ➔</div>
        </div>
      )}

      {isMobileCartOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backdropFilter: 'blur(2px)' }}>
          
          {/* 🔥 INVISIBLE TOP AREA: Exactly calculated to dodge the main header and burger icon */}
          <div style={{ height: 'calc(max(20px, env(safe-area-inset-top, 20px)) + 65px)', flexShrink: 0, width: '100%' }} onClick={() => setIsMobileCartOpen(false)}></div>
          
          {/* 🔥 BOTTOM SHEET CART CONTAINER */}
          <div style={{ 
            flex: 1, 
            width: '100%', 
            backgroundColor: '#ffffff', 
            borderTopLeftRadius: '24px', 
            borderTopRightRadius: '24px', 
            display: 'flex', 
            flexDirection: 'column', 
            position: 'relative', 
            boxShadow: '0 -10px 25px rgba(0,0,0,0.1)', 
            animation: 'posPopupSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' 
          }}>
            
            {/* iOS Style Drag Handle Pill */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center', paddingTop: '12px', paddingBottom: '4px', flexShrink: 0 }}>
              <div style={{ width: '40px', height: '4px', backgroundColor: '#cbd5e1', borderRadius: '10px' }}></div>
            </div>

            {/* Cart Header */}
            <div style={{ padding: '8px 20px 16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ margin: 0, color: '#0f172a', fontSize: '16px', fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: '8px' }}>
                🛒 {currentT.cartTitle.replace('🛒 ', '').trim()} ({cart.length})
              </div>
              <button 
                onClick={() => setIsMobileCartOpen(false)} 
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '14px', width: '32px', height: '32px', borderRadius: '50%', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: '16px', paddingRight: '20px', paddingBottom: '20px', paddingLeft: '20px' }}>
            {activeTab === 'wholesale' && selectedCustomerId && (
              <div 
                onClick={() => {
                  setCartCustomerEditForm({
                    name: cartCustomerNameOverride || selectedCustomer?.name || '',
                    phone: cartCustomerPhoneOverride || selectedCustomer?.phone || '',
                    location: cartCustomerLocationOverride || selectedCustomer?.location || '',
                    google_map: cartCustomerMapOverride || (selectedCustomer as any)?.google_map || ''
                  });
                  setIsCartCustomerEditOpen(true);
                }}
                style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
              >
                <div style={{ fontSize: '15px', color: '#0f172a', fontWeight: 'normal' }}>{cartCustomerNameOverride || selectedCustomer?.name}</div>
                <span style={{ fontSize: '16px', color: '#3b82f6' }}>✏️</span>
              </div>
            )}

            {sortedCart.map((item) => {
              const isReturn = item.custom_name.includes('ដូរ');
              const isCharge = item.custom_name.includes('បានប្រើ');
              const isSpecial = isReturn || isCharge || item.isSpecial;

              return (
                <div key={item.id} style={{ backgroundColor: isReturn ? '#fef2f2' : isCharge ? '#fffbeb' : '#ffffff', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px', border: `1px solid ${isReturn ? '#fecaca' : isCharge ? '#fde68a' : '#e2e8f0'}`, position: 'relative' }}>
                  <button onClick={() => removeFromCart(item.id)} style={{ position: 'absolute', top: '8px', right: '8px', background: '#fee2e2', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '11px', width: '22px', height: '22px', borderRadius: '50%', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', paddingRight: '28px', minWidth: 0 }}>
                    <input 
                      type="text" 
                      value={item.custom_name} 
                      onChange={(e) => updateCartItem(item.id, 'custom_name', e.target.value)}
                      placeholder="Item Name"
                      disabled={isSpecial}
                      style={{ 
                        fontSize: '14px', color: isReturn ? '#dc2626' : isCharge ? '#b45309' : '#334155', fontWeight: 'normal',
                        flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', padding: 0
                      }} 
                    />
                    
                    {!isSpecial && activeTab === 'wholesale' && (
                      <div style={{ position: 'relative', marginLeft: '8px' }}>
                        {/* Transparent Backdrop to close on outside click */}
                        {openBatchMenuId === item.id && (
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onMouseDown={(e) => { e.preventDefault(); setOpenBatchMenuId(null); }}></div>
                        )}
                        
                        {/* Trigger Button */}
                        <div 
                          onClick={(e) => { e.preventDefault(); setOpenBatchMenuId(openBatchMenuId === item.id ? null : item.id); }}
                          className="saas-input"
                          style={{ padding: '6px 10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', color: '#b58a3d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '140px' }}
                        >
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 'normal' }}>
                            {item.selected_batch_id 
                              ? (() => {
                                  const b = activeBatches[item.product_id]?.find(x => x.id === item.selected_batch_id);
                                  const remaining = b?.remaining_qty || 0;
                                  return b ? (
                                    <span style={{ color: remaining <= 0 ? '#ea580c' : 'inherit', fontWeight: remaining <= 0 ? 'bold' : 'normal' }}>
                                      {remaining <= 0 ? '⚠️ ' : ''}{formatRiel(b.cost_price)} ({remaining})
                                    </span>
                                  ) : '▼ Auto FIFO';
                                })()
                              : (() => {
                                  const defaultB = activeBatches[item.product_id]?.[0];
                                  const remaining = defaultB?.remaining_qty || 0;
                                  return defaultB && remaining <= 0 ? (
                                    <span style={{ color: '#ea580c', fontWeight: 'bold' }}>⚠️ Auto FIFO ({remaining})</span>
                                  ) : '▼ Auto FIFO';
                                })()}
                          </span>
                          <span style={{ fontSize: '10px', color: '#94a3b8', flexShrink: 0 }}>{openBatchMenuId === item.id ? '▲' : '▼'}</span>
                        </div>

                        {/* Custom Dropdown Menu Tray */}
                        {openBatchMenuId === item.id && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', minWidth: '240px', maxWidth: '280px', overflow: 'hidden' }}>
                            <div 
                              onMouseDown={(e) => { e.preventDefault(); updateCartItem(item.id, 'selected_batch_id', null); setOpenBatchMenuId(null); }}
                              style={{ padding: '12px 14px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', backgroundColor: !item.selected_batch_id ? '#f8fafc' : '#ffffff', color: '#0f172a', fontWeight: 'normal' }}
                            >
                              ▼ Auto FIFO (Default)
                            </div>
                            <div className="hide-scrollbar" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                              {activeBatches[item.product_id]?.map((b: any) => {
                                const remaining = b.remaining_qty || 0;
                                const isSelected = item.selected_batch_id === b.id;
                                return (
                                  <div 
                                    key={b.id}
                                    onMouseDown={(e) => { e.preventDefault(); updateCartItem(item.id, 'selected_batch_id', b.id); setOpenBatchMenuId(null); }}
                                    style={{ padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', backgroundColor: isSelected ? '#f8fafc' : '#ffffff', transition: 'background-color 0.1s' }}
                                  >
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#b58a3d', marginBottom: b.notes ? '4px' : '0' }}>
                                      {formatRiel(b.cost_price)} <span style={{ color: '#64748b', fontWeight: 'normal', fontSize: '12px' }}>({remaining} left)</span>
                                    </div>
                                    {b.notes && <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.4 }}>{b.notes}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', gap: activeTab === 'retail' ? '6px' : '8px', alignItems: 'center' }}>
                    {/* 1. Quantity Input */}
                    <div style={{ width: activeTab === 'retail' ? '65px' : '75px' }}>
                      <CurrencyInput 
                        value={item.quantity === 0 ? '0' : item.quantity} 
                        onChange={(v: any) => updateCartItem(item.id, 'quantity', v)} 
                        onFocus={() => updateCartItem(item.id, 'quantity', '')} 
                        className="saas-input" 
                        style={{ textAlign: 'center', padding: '6px' }}
                        disabled={isSpecial}
                      />
                    </div>
                    
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>×</span>
                    
                    {/* 2. Unit Price Input */}
                    <div style={{ flex: 1 }}>
                      <CurrencyInput 
                        value={item.custom_price_riel === 0 ? '0' : item.custom_price_riel} 
                        onChange={(v: any) => updateCartItem(item.id, 'custom_price_riel', v)} 
                        onFocus={() => updateCartItem(item.id, 'custom_price_riel', '')} 
                        className="saas-input" 
                        style={{ textAlign: activeTab === 'retail' ? 'center' : 'right', padding: '6px' }} 
                      />
                    </div>
                    
                    {/* 3. Editable Subtotal (ONLY SHOWS ON RETAIL TAB) */}
                    {activeTab === 'retail' && (
                      <>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>=</span>
                        <div style={{ flex: 1 }}>
                          <CurrencyInput 
                            value={Math.round((Number(item.quantity) || 0) * (Number(item.custom_price_riel) || 0))} 
                            onChange={(newTotal: any) => {
                              // When typing a new Total, auto-adjust the Unit Price
                              const qty = Number(item.quantity) || 1;
                              const newUnitPrice = Math.round(Number(newTotal) / qty);
                              updateCartItem(item.id, 'custom_price_riel', newUnitPrice);
                            }} 
                            className="saas-input" 
                            style={{ textAlign: 'right', padding: '6px', fontWeight: 'bold', color: '#0f172a', backgroundColor: '#f8fafc' }} 
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          
          <div style={{ padding: '12px 20px calc(24px + env(safe-area-inset-bottom, 12px)) 20px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', boxShadow: '0 -4px 10px rgba(0,0,0,0.05)', flexShrink: 0 }}>
            {renderCartAdjustmentsToolbar()}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '14px', color: '#475569' }}>{currentT.totalKhmer}</span>
              <span style={{ fontWeight: 'bold', color: totalRiel < 0 ? '#ef4444' : '#b58a3d', fontSize: '20px' }}>{formatRielFromNative(totalRiel)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{currentT.totalUsd}</span>
              <span style={{ color: '#64748b', fontSize: '13px' }}>{formatUSD(totalUSD)}</span>
            </div>
            
            {renderPaymentSection(true)}

            <button 
              onClick={initiateCheckout} 
              disabled={cart.length === 0 || isProcessing} 
              className={`saas-btn ${(cart.length === 0 || isProcessing) ? 'saas-btn-secondary' : 'saas-btn-primary'}`}
              style={{ width: '100%', padding: '16px', fontSize: '16px' }}
            >
              {isProcessing ? 'Processing...' : currentT.checkout}
            </button>
          </div>
          {/* 🔥 FIX: Missing closing tag for the Bottom Sheet Container */}
          </div>
        </div>
      )}

      {/* AUTO OPEN BAG MODAL */}
      <Modal isOpen={autoOpenModal.isOpen} onClose={() => { setAutoOpenModal({ isOpen: false, items: [] }); setRepackSubstitutes({}); setRepackSearch({}); setRepackMenuOpen({}); }} title="Auto-Open Bag Required" icon="⚠️" maxWidth="400px">
        
        <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5', margin: '0 0 16px 0' }}>
          Not enough loose retail rice. Select a wholesale bag to open.
        </p>
        
        <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', color: '#64748b' }}>
          Items needing restocking:
          <ul style={{ paddingLeft: '0', marginTop: '12px', marginBottom: 0 }}>
            {autoOpenModal.items.map((p) => {
              const defaultW = p.linked_wholesale_id ? products.find(w => w.id === p.linked_wholesale_id) : null;
              
              // 🔥 OVERSELL FIX 5: We removed "|| defaultW.stock < p.bags_needed"
              // Now the Auto-Open popup will look completely normal and won't flash red warnings when stock is 0!
              const isOutOfStock = !defaultW; 
              
              const currentSelectedId = repackSubstitutes[p.id] || p.linked_wholesale_id;
              const currentSelectedName = products.find(prod => prod.id === currentSelectedId)?.name || '-- Click to Select a Bag --';
              const searchTerm = repackSearch[p.id] || '';
              
              const availableBags = products
                .filter(prod => 
                  Number(prod.weight) >= 50 && 
                  // 🔥 OVERSELL FIX: Allow bags with 0 or negative stock to be selected as substitutes!
                  (!searchTerm || prod.name.toLowerCase().includes(searchTerm.toLowerCase()))
                )
                .sort((a, b) => riceCategoryComparator(a, b, 'cost_price')); // 🚦 MASTER SORT APPLIED

              return (
                <li key={p.id} style={{ marginBottom: '16px', listStyle: 'none', background: isOutOfStock ? '#fef2f2' : '#ffffff', padding: '12px', borderRadius: '8px', border: `1px solid ${isOutOfStock ? '#fca5a5' : '#cbd5e1'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                     <span style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '14px' }}>{p.name}</span>
                     <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 'bold', background: '#fee2e2', padding: '2px 8px', borderRadius: '12px' }}>Needs {p.bags_needed} bag</span>
                  </div>
                  
                  <div style={{ color: isOutOfStock ? '#dc2626' : '#334155', marginBottom: '8px', fontSize: '12px', fontWeight: 'bold' }}>
                    {isOutOfStock ? '⚠️ Default bag empty! Select a bag:' : 'Select wholesale bag:'}
                  </div>
                  
                  <div style={{ position: 'relative' }}>
                    {/* Dropdown Overlay / Backdrop */}
                    {repackMenuOpen[p.id] && (
                      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onMouseDown={() => setRepackMenuOpen({...repackMenuOpen, [p.id]: false})}></div>
                    )}

                    {/* 🔥 NEUTRAL, PROFESSIONAL DROPDOWN TRIGGER */}
                    <div 
                      onClick={() => setRepackMenuOpen({...repackMenuOpen, [p.id]: !repackMenuOpen[p.id]})}
                      className="saas-input"
                      style={{ width: '100%', padding: '10px 14px', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontWeight: 'bold', position: 'relative', zIndex: repackMenuOpen[p.id] ? 100 : 1, margin: 0, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)' }}
                    >
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {currentSelectedName}
                      </span>
                      <span style={{ fontSize: '12px', marginLeft: '8px', flexShrink: 0, color: '#64748b' }}>{repackMenuOpen[p.id] ? '▲' : '▼ Change'}</span>
                    </div>

                    {/* Dropdown Menu */}
                    {repackMenuOpen[p.id] && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 101, backgroundColor: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                        <input 
                          type="text"
                          placeholder="🔍 Search bag..."
                          value={searchTerm}
                          onChange={(e) => setRepackSearch({...repackSearch, [p.id]: e.target.value})}
                          autoFocus
                          className="saas-input"
                          style={{ width: '100%', padding: '10px 14px', border: 'none', borderBottom: '1px solid #e2e8f0', outline: 'none', fontSize: '14px', borderRadius: '0', margin: 0, boxSizing: 'border-box' }}
                        />
                        <div className="hide-scrollbar" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                          {availableBags.map(sub => (
                            <div 
                              key={sub.id}
                              onClick={() => {
                                setRepackSubstitutes({...repackSubstitutes, [p.id]: sub.id});
                                setRepackMenuOpen({...repackMenuOpen, [p.id]: false});
                                setRepackSearch({...repackSearch, [p.id]: ''}); 
                              }}
                              style={{ padding: '10px 14px', fontSize: '14px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', backgroundColor: currentSelectedId === sub.id ? '#f1f5f9' : '#fff', color: '#0f172a', fontWeight: currentSelectedId === sub.id ? 'bold' : 'normal' }}
                            >
                              {sub.name} <span style={{ color: '#64748b', fontWeight: 'normal', fontSize: '13px' }}>(Stock: {sub.stock})</span>
                            </div>
                          ))}
                          {availableBags.length === 0 && (
                            <div style={{ padding: '12px', fontSize: '14px', color: '#94a3b8', textAlign: 'center' }}>No bags found</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => { setAutoOpenModal({ isOpen: false, items: [] }); setRepackSubstitutes({}); setRepackSearch({}); setRepackMenuOpen({}); }} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleConfirmAutoOpen} disabled={isProcessing} className="saas-btn saas-btn-primary">{isProcessing ? 'Processing...' : 'Yes, Open Bag'}</button>
        </div>
      </Modal>

      {/* 🟢 EDIT CUSTOMER DELIVERY INFO MODAL */}
      <Modal isOpen={isCartCustomerEditOpen} onClose={() => setIsCartCustomerEditOpen(false)} title="Edit Delivery Info" icon="🚚" maxWidth="400px">
        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Customer / Invoice Name</label>
          <input type="text" value={cartCustomerEditForm.name} onChange={(e) => setCartCustomerEditForm({...cartCustomerEditForm, name: e.target.value})} className="saas-input" />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Phone Number</label>
          <input type="text" value={cartCustomerEditForm.phone} onChange={(e) => setCartCustomerEditForm({...cartCustomerEditForm, phone: e.target.value})} className="saas-input" />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Delivery Location</label>
          <input type="text" value={cartCustomerEditForm.location} onChange={(e) => setCartCustomerEditForm({...cartCustomerEditForm, location: e.target.value})} className="saas-input" />
        </div>
        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Google Map Link</label>
          <input type="text" value={cartCustomerEditForm.google_map} onChange={(e) => setCartCustomerEditForm({...cartCustomerEditForm, google_map: e.target.value})} className="saas-input" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button 
            onClick={() => {
              setCartCustomerNameOverride(cartCustomerEditForm.name);
              setCartCustomerLocationOverride(cartCustomerEditForm.location);
              setCartCustomerMapOverride(cartCustomerEditForm.google_map);
              setCartCustomerPhoneOverride(cartCustomerEditForm.phone);
              setIsCartCustomerEditOpen(false);
            }} 
            className="saas-btn saas-btn-secondary"
            style={{ width: '100%', justifyContent: 'center', fontWeight: 'bold' }}
          >
            Change for this Invoice Only
          </button>
          
          <button 
            onClick={async () => {
              setIsProcessing(true);
              try {
                // 🔥 SECURITY FIX: Lock customer database updates to the active branch
                const { error } = await supabase.from('customers').update({
                  name: cartCustomerEditForm.name,
                  phone: cartCustomerEditForm.phone,
                  location: cartCustomerEditForm.location,
                  google_map: cartCustomerEditForm.google_map
                }).eq('id', selectedCustomerId).eq('branch_id', activeBranchId);
                
                if (error) throw error;
                
                setCustomers(customers.map(c => c.id.toString() === selectedCustomerId ? { ...c, ...cartCustomerEditForm } : c));
                setCartCustomerNameOverride(cartCustomerEditForm.name);
                setCartCustomerLocationOverride(cartCustomerEditForm.location);
                setCartCustomerMapOverride(cartCustomerEditForm.google_map);
                setCartCustomerPhoneOverride(cartCustomerEditForm.phone);
                
                showToast('success', 'Database Updated', 'Customer profile permanently updated!');
                setIsCartCustomerEditOpen(false);
              } catch (err: any) {
                showToast('error', 'Update Failed', err.message);
              } finally {
                setIsProcessing(false);
              }
            }} 
            disabled={isProcessing}
            className="saas-btn saas-btn-primary"
            style={{ width: '100%', justifyContent: 'center', fontWeight: 'bold' }}
          >
            {isProcessing ? 'Saving...' : '💾 Update Permanent Database'}
          </button>
        </div>
      </Modal>

      {/* CREATE NEW CUSTOMER MODAL */}
      <Modal isOpen={isCreateCustomerModalOpen} onClose={() => setIsCreateCustomerModalOpen(false)} title="Create New Customer" icon="👤" maxWidth="400px">
        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Name</label>
          <input type="text" value={newCustomerForm.name} onChange={(e) => setNewCustomerForm({...newCustomerForm, name: e.target.value})} className="saas-input" />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Account Owner</label>
          <select value={newCustomerForm.owner} onChange={(e) => setNewCustomerForm({...newCustomerForm, owner: e.target.value})} className="saas-input" style={{ cursor: 'pointer' }}>
            <option value="">-- Select --</option>
            <option value="Pich">Pich</option>
            <option value="Jing">Jing</option>
            <option value="Both">Both</option>
            <option value="Mom">Mom</option>
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Customer Type</label>
          <select value={newCustomerForm.type} onChange={(e) => setNewCustomerForm({...newCustomerForm, type: e.target.value})} className="saas-input" style={{ cursor: 'pointer' }}>
            <option value="">-- Select --</option>
            <option value="ហូប">ហូប</option>
            <option value="លក់បាយ">លក់បាយ</option>
            <option value="លក់ត">លក់ត</option>
            <option value="អំណោយ">អំណោយ</option>
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Location</label>
          <input type="text" value={newCustomerForm.location} onChange={(e) => setNewCustomerForm({...newCustomerForm, location: e.target.value})} className="saas-input" />
        </div>
        
        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Phone Number</label>
          <input type="text" value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({...newCustomerForm, phone: e.target.value})} className="saas-input" />
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setIsCreateCustomerModalOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleCreateCustomer} className="saas-btn saas-btn-primary">Save Customer</button>
        </div>
      </Modal>

      {/* RETURN & EXCHANGE MODAL */}
      <Modal isOpen={exchangeModal.isOpen && !!exchangeModal.product} onClose={() => setExchangeModal({ isOpen: false, product: null, consumedKg: '' })} title="Exchange / Return Bag" icon="🔄" maxWidth="400px">
        <div style={{ marginBottom: '16px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Product to Return</label>
          <div style={{ padding: '10px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#334155' }}>{exchangeModal.product?.name}</div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>How many kg were consumed?</label>
          <CurrencyInput
            autoFocus
            placeholder="e.g. 15"
            value={exchangeModal.consumedKg}
            onChange={(v: any) => setExchangeModal({ ...exchangeModal, consumedKg: v })}
            className="saas-input"
          />
          <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.4 }}>
            * Enter 0 if the bag is fully intact and unopened.<br/>
            * Partial returns add leftover rice to 1kg Retail pool automatically.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setExchangeModal({ isOpen: false, product: null, consumedKg: '' })} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleConfirmExchange} disabled={isProcessing} className="saas-btn saas-btn-danger">{isProcessing ? 'Processing...' : 'Confirm Return'}</button>
        </div>
      </Modal>

      {/* 🟢 CART ADJUSTMENTS MODAL (Discount, Deposit, Bag Fee with Sleek White Bag Selector & Covered-by-Depot Toggle) */}
      <Modal 
        isOpen={adjustmentModal.isOpen} 
        onClose={() => setAdjustmentModal({ isOpen: false, type: null, amount: '', qty: 1, note: '', isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false })} 
        title={
          adjustmentModal.type === 'discount' ? "Add Discount (បញ្ចុះតម្លៃ)" :
          adjustmentModal.type === 'deposit' ? "Add Deposit / Prepayment (កក់)" :
          "Add Bag Fee (ថ្លៃបាវ)"
        }
        icon={adjustmentModal.type === 'discount' ? "🏷️" : adjustmentModal.type === 'deposit' ? "💵" : "🛍️"} 
        maxWidth="400px"
      >
        {/* 🟢 SLEEK WHITE BAG TYPE DROPDOWN TRAY (With Price & COGS Display) */}
        {adjustmentModal.type === 'bag' && (() => {
          const defaultBagProd = products.find(p => p.name === 'ថ្លៃបាវ ប្រ៊េន');
          // 🔥 FIX: Display 1000៛ as the default selling price
          const defaultPrice = defaultBagProd ? Number(defaultBagProd.price || 1000) : 1000;
          const defaultCogs = defaultBagProd ? Number(defaultBagProd.cost_price || 1200) : 1200;

          return (
            <div style={{ marginBottom: '16px', position: 'relative', zIndex: 50 }}>
              <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>
                Choose Bag Type (ប្រភេទបាវ)
              </label>
              
              <div style={{ position: 'relative' }}>
                {/* Trigger Button */}
                <div
                  className="interactive-select-trigger"
                  onClick={() => setAdjustmentModal({ ...adjustmentModal, isBagMenuOpen: !adjustmentModal.isBagMenuOpen })}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '14px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    color: '#0f172a',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                    margin: 0
                  }}
                >
                  <span>{adjustmentModal.selectedBagName || 'ថ្លៃបាវ ប្រ៊េន'}</span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{adjustmentModal.isBagMenuOpen ? '▲' : '▼'}</span>
                </div>

                {/* Pure White Dropdown Tray */}
                {adjustmentModal.isBagMenuOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                      zIndex: 100,
                      overflow: 'hidden',
                      margin: 0
                    }}
                  >
                    {/* Default Option with Price & COGS */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setAdjustmentModal({
                          ...adjustmentModal,
                          selectedBagName: 'ថ្លៃបាវ ប្រ៊េន',
                          amount: defaultPrice,
                          isBagMenuOpen: false
                        });
                      }}
                      style={{
                        padding: '10px 14px',
                        fontSize: '14px',
                        color: '#0f172a',
                        cursor: 'pointer',
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: adjustmentModal.selectedBagName === 'ថ្លៃបាវ ប្រ៊េន' ? '#f8fafc' : '#ffffff',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <span>ថ្លៃបាវ ប្រ៊េន (Default)</span>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        Price: <b>{new Intl.NumberFormat('en-US').format(defaultPrice)} ៛</b> | COGS: <b>{new Intl.NumberFormat('en-US').format(defaultCogs)} ៛</b>
                      </span>
                    </div>

                    {/* Filtered Bag Products from Database with Price & COGS */}
                    {products
                      .filter(p => p.name?.includes('បាវ') && p.name !== 'ថ្លៃបាវ ប្រ៊េន')
                      .sort((a, b) => riceCategoryComparator(a, b, 'cost_price')) // 🚦 MASTER SORT APPLIED
                      .map(p => (
                        <div
                          key={p.id}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setAdjustmentModal({
                              ...adjustmentModal,
                              selectedBagName: p.name,
                              amount: Number(p.price || 0),
                              isBagMenuOpen: false
                            });
                          }}
                          style={{
                            padding: '10px 14px',
                            fontSize: '14px',
                            color: '#0f172a',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f1f5f9',
                            backgroundColor: adjustmentModal.selectedBagName === p.name ? '#f8fafc' : '#ffffff',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <span>{p.name}</span>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            Price: <b>{new Intl.NumberFormat('en-US').format(Number(p.price || 0))} ៛</b> | COGS: <b>{new Intl.NumberFormat('en-US').format(Number(p.cost_price || 0))} ៛</b>
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {/* 🟢 2. COVERED BY DEPOT CHECKBOX TOGGLE */}
        {adjustmentModal.type === 'bag' && (
          <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="coveredByDepot"
              checked={adjustmentModal.isCoveredByDepot}
              onChange={(e) => setAdjustmentModal({ ...adjustmentModal, isCoveredByDepot: e.target.checked })}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="coveredByDepot" style={{ fontSize: '13px', color: '#334155', cursor: 'pointer', fontWeight: 'bold' }}>
              Covered by Depot (Free Bag for Customer)
            </label>
          </div>
        )}

        {/* 3. AMOUNT INPUT (Hidden automatically when bag is covered by depot) */}
        {!adjustmentModal.isCoveredByDepot && (
          <div style={{ marginBottom: '16px' }}>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Amount / Price (៛)</label>
            <CurrencyInput
              autoFocus
              placeholder="0"
              value={adjustmentModal.amount}
              onChange={(v: any) => setAdjustmentModal({ ...adjustmentModal, amount: v })}
              className="saas-input"
            />
          </div>
        )}

        {/* 4. QUANTITY INPUT */}
        {adjustmentModal.type === 'bag' && (
          <div style={{ marginBottom: '16px' }}>
            <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Quantity</label>
            <CurrencyInput
              placeholder="1"
              value={adjustmentModal.qty}
              onChange={(v: any) => setAdjustmentModal({ ...adjustmentModal, qty: v })}
              className="saas-input"
            />
          </div>
        )}

        {/* 5. OPTIONAL NOTE */}
        <div style={{ marginBottom: '24px' }}>
          <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '8px' }}>Optional Note / Description</label>
          <input
            type="text"
            placeholder={
              adjustmentModal.type === 'discount' ? "e.g. VIP Member" : 
              adjustmentModal.type === 'deposit' ? "e.g. Paid yesterday" : 
              adjustmentModal.isCoveredByDepot ? "e.g. Depot absorbed bag replacement" : "e.g. Extra empty bag"
            }
            value={adjustmentModal.note}
            onChange={(e) => setAdjustmentModal({ ...adjustmentModal, note: e.target.value })}
            className="saas-input"
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={() => setAdjustmentModal({ isOpen: false, type: null, amount: '', qty: 1, note: '', isCoveredByDepot: false, selectedBagName: 'ថ្លៃបាវ ប្រ៊េន', isBagMenuOpen: false })} className="saas-btn saas-btn-secondary">Cancel</button>
          <button onClick={handleAddCartAdjustment} className="saas-btn saas-btn-primary">Add to Cart</button>
        </div>
      </Modal>

      {/* TOP-DOCKED MOBILE PRODUCT ADD POPUP */}
      {!!selectedMobileProduct && typeof document !== 'undefined' && createPortal(
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 2147483647,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            paddingTop: '10px',
            paddingLeft: '16px',
            paddingRight: '16px'
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedMobileProduct(null);
          }}
        >
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleAddMobileProductToCart();
            }}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '14px 18px',
              width: '100%',
              maxWidth: '400px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
              animation: 'posPopupSlideDown 0.15s ease-out'
            }}
            onFocusCapture={() => {
              window.scrollTo(0, 0);
              setTimeout(() => window.scrollTo(0, 0), 50);
              setTimeout(() => window.scrollTo(0, 0), 150);
              setTimeout(() => window.scrollTo(0, 0), 300);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fde68a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  flexShrink: 0
                }}>
                  ✏️
                </div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'normal', color: '#0f172a' }}>
                  {currentT.mobileModalTitle}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedMobileProduct(null)} 
                style={{ background: 'none', border: 'none', fontSize: '18px', color: '#64748b', cursor: 'pointer', fontWeight: 'normal' }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', fontWeight: 'normal', margin: 0 }}>
                  Product Identifier
                </label>
                {/* 🔥 Show "Batch" label above the icon if batches are present */}
                {activeTab === 'wholesale' && activeBatches[selectedMobileProduct?.id]?.length > 0 && (
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', margin: 0, color: '#b58a3d' }}>
                    Batch
                  </label>
                )}
              </div>
              
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* 🔥 FIX: Flex: 1 and minWidth: 0 prevents the input from getting crushed! */}
                <input 
                  type="text" 
                  value={mobileName} 
                  onChange={(e) => setMobileName(e.target.value)} 
                  className="saas-input" 
                  style={{ 
                    flex: 1, 
                    minWidth: 0, 
                    boxSizing: 'border-box', 
                    fontWeight: 'normal',
                    fontSize: '16px',
                    height: '42px'
                  }}
                />

                {/* 🔥 JUST THE DROPDOWN ICON BUTTON */}
                {activeTab === 'wholesale' && activeBatches[selectedMobileProduct?.id]?.length > 0 && (
                  <>
                    <button 
                      onClick={(e) => { e.preventDefault(); setIsMobileBatchModalOpen(true); }}
                      className="saas-btn"
                      style={{ 
                        width: '42px', 
                        height: '42px', 
                        padding: 0, 
                        background: mobileBatchId ? '#fefcf3' : '#f8fafc', 
                        border: `1px solid ${mobileBatchId ? '#b58a3d' : '#cbd5e1'}`, 
                        borderRadius: '8px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        flexShrink: 0,
                        boxSizing: 'border-box'
                      }}
                    >
                      <span style={{ color: mobileBatchId ? '#b58a3d' : '#64748b', fontSize: '14px', fontWeight: mobileBatchId ? 'bold' : 'normal' }}>▼</span>
                    </button>

                    {/* 🔥 THE POPUP MODAL (Appears from TOP, bypasses global CSS centering) */}
                    {isMobileBatchModalOpen && (
                      <div 
                        onMouseDown={() => setIsMobileBatchModalOpen(false)}
                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', zIndex: 2147483647, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 'max(80px, env(safe-area-inset-top, 80px))', paddingLeft: '16px', paddingRight: '16px', paddingBottom: '16px', backdropFilter: 'blur(2px)' }}
                      >
                        <div 
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{ background: '#ffffff', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '20px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', animation: 'posPopupSlideDown 0.2s ease-out', display: 'flex', flexDirection: 'column', maxHeight: '75vh' }}
                        >
                          
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
                            {/* 🔥 Changed h3 to div to bypass global centering CSS rule */}
                            <div style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              📦 Select Batch
                            </div>
                            <button onClick={(e) => { e.preventDefault(); setIsMobileBatchModalOpen(false); }} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', fontSize: '14px', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                          </div>

                          <div className="hide-scrollbar" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                            
                            {/* Auto FIFO Option */}
                            <div 
                              onClick={() => { setMobileBatchId(null); setIsMobileBatchModalOpen(false); }}
                              style={{ padding: '14px', borderRadius: '8px', border: !mobileBatchId ? '2px solid #3b82f6' : '1px solid #e2e8f0', backgroundColor: !mobileBatchId ? '#eff6ff' : '#ffffff', cursor: 'pointer', transition: 'all 0.1s' }}
                            >
                              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>▼ Auto FIFO (Default)</div>
                            </div>

                            {/* List of Batches Matching the Cart Design EXACTLY */}
                            {activeBatches[selectedMobileProduct.id]?.map((b: any) => {
                              const remaining = b.remaining_qty || 0;
                              const isSelected = mobileBatchId === b.id;
                              
                              // Formatting date cleanly
                              const formattedDate = new Date(b.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                              
                              return (
                                <div 
                                  key={b.id}
                                  onClick={() => { setMobileBatchId(b.id); setIsMobileBatchModalOpen(false); }}
                                  style={{ padding: '14px', borderRadius: '8px', border: isSelected ? '2px solid #b58a3d' : '1px solid #e2e8f0', backgroundColor: isSelected ? '#f8fafc' : '#ffffff', cursor: 'pointer', transition: 'background-color 0.1s' }}
                                >
                                  {/* EXACT MATCH TO YOUR SCREENSHOT: Price + Gray Stock text side by side */}
                                  {/* Added Date formatting appended after the stock */}
                                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#b58a3d', marginBottom: b.notes ? '4px' : '0' }}>
                                    {formatRiel(b.cost_price)} <span style={{ color: '#64748b', fontWeight: 'normal', fontSize: '12px' }}>({remaining} left) • {formattedDate}</span>
                                  </div>
                                  
                                  {/* EXACT MATCH TO YOUR SCREENSHOT: Plain text for the recipe/notes */}
                                  {b.notes && (
                                    <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, marginTop: '4px' }}>
                                      {b.notes}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '18px' }}>
              <div style={{ flex: 1 }}>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', fontWeight: 'normal', marginBottom: '6px' }}>
                  Quantity
                </label>
                <CurrencyInput 
                  ref={mobileQtyRef}
                  autoFocus={true}
                  enterKeyHint="next"
                  value={mobileQty} 
                  onChange={(v: any) => setMobileQty(v)} 
                  className="saas-input" 
                  style={{ 
                    width: '100%', 
                    boxSizing: 'border-box', 
                    textAlign: 'center',
                    fontWeight: 'normal',
                    fontSize: '16px' 
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', fontWeight: 'normal', marginBottom: '6px' }}>
                  Price (៛)
                </label>
                <CurrencyInput 
                  enterKeyHint="done"
                  value={mobilePrice} 
                  onChange={(v: any) => setMobilePrice(v)} 
                  onKeyDown={(e: any) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget?.blur();
                      handleAddMobileProductToCart();
                    }
                  }}
                  className="saas-input" 
                  style={{ 
                    width: '100%', 
                    boxSizing: 'border-box', 
                    textAlign: 'center',
                    fontWeight: 'normal',
                    color: '#b58a3d',
                    fontSize: '16px' 
                  }}
                />
              </div>
            </div>

            {/* 🔥 NEW UI: Bag Selection Row */}
            {activeTab === 'wholesale' && (
              <div style={{ marginBottom: '18px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: '#334155' }}>
                  Changing bag?
                </label>
                
                {/* 🔘 Custom Select Button Trigger */}
                <button 
                  onClick={(e) => { e.preventDefault(); setIsMobileBagModalOpen(true); }}
                  className="saas-input"
                  style={{ 
                    width: '100%', 
                    textAlign: 'left', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    backgroundColor: mobileBagId ? '#fefcf3' : '#ffffff', 
                    borderColor: mobileBagId ? '#b58a3d' : '#cbd5e1',
                    height: '42px',
                    cursor: 'pointer',
                    marginBottom: mobileBagId ? '10px' : '0'
                  }}
                >
                  <span style={{ color: mobileBagId ? '#8a7650' : '#475569', fontWeight: mobileBagId ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {mobileBagId ? (() => {
                      const b = products.find(p => p.id === mobileBagId);
                      return b ? `🛍️ ${b.name} (${formatRiel(b.price || 0)} ៛)` : '▼ Select Bag';
                    })() : '-- No Bag Change --'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {mobileBagId && (
                      <span 
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMobileBagId(null); }}
                        style={{ color: '#ef4444', fontSize: '16px', padding: '0 8px', marginRight: '4px' }}
                      >✕</span>
                    )}
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>{isMobileBagModalOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* 🔥 BAG SELECTION POPUP MODAL */}
                {isMobileBagModalOpen && (
                  <div 
                    onMouseDown={() => setIsMobileBagModalOpen(false)}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', zIndex: 2147483647, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 'max(80px, env(safe-area-inset-top, 80px))', paddingLeft: '16px', paddingRight: '16px', paddingBottom: '16px', backdropFilter: 'blur(2px)' }}
                  >
                    <div 
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{ background: '#ffffff', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '20px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', animation: 'posPopupSlideDown 0.2s ease-out', display: 'flex', flexDirection: 'column', maxHeight: '75vh' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
                        <div style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          🛍️ Select Bag
                        </div>
                        <button onClick={(e) => { e.preventDefault(); setIsMobileBagModalOpen(false); }} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', fontSize: '14px', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                      </div>

                      <div className="hide-scrollbar" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                        <div 
                          onClick={() => { setMobileBagId(null); setIsMobileBagModalOpen(false); }}
                          style={{ padding: '14px', borderRadius: '8px', border: !mobileBagId ? '2px solid #3b82f6' : '1px solid #e2e8f0', backgroundColor: !mobileBagId ? '#eff6ff' : '#ffffff', cursor: 'pointer', transition: 'all 0.1s' }}
                        >
                          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>-- No Bag Change --</div>
                        </div>

                        {products
                          .filter(p => p.name?.includes('បាវ'))
                          .sort((a, b) => riceCategoryComparator(a, b, 'cost_price')) // 🚦 MASTER SORT APPLIED
                          .map((bag: any) => {
                          const isSelected = mobileBagId === bag.id;
                          return (
                            <div 
                              key={bag.id}
                              onClick={() => { 
                                setMobileBagId(bag.id); 
                                setMobileBagPrice(Number(bag.price || 0)); // 🔥 AUTO-FILLS DEFAULT BAG PRICE
                                setIsMobileBagModalOpen(false); 
                              }}
                              style={{ padding: '14px', borderRadius: '8px', border: isSelected ? '2px solid #b58a3d' : '1px solid #e2e8f0', backgroundColor: isSelected ? '#f8fafc' : '#ffffff', cursor: 'pointer', transition: 'background-color 0.1s' }}
                            >
                              <div style={{ fontSize: '14px', fontWeight: 'bold', color: isSelected ? '#b58a3d' : '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>{bag.name}</span>
                                <span>{formatRiel(bag.price || 0)} ៛</span>
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Stock: {bag.stock} left</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 🔥 SPLIT SIDE-BY-SIDE QTY & PRICE INPUTS */}
                {mobileBagId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', fontWeight: 'normal', marginBottom: '6px' }}>Bag Qty</label>
                        <CurrencyInput
                          value={mobileBagQty === 0 ? '0' : mobileBagQty}
                          onChange={(v: any) => setMobileBagQty(v)}
                          onFocus={() => { if (mobileBagQty === 1) setMobileBagQty(''); }}
                          className="saas-input"
                          style={{ textAlign: 'center', height: '38px', fontWeight: 'normal', fontSize: '16px' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', fontWeight: 'normal', marginBottom: '6px', color: mobileBagCoveredByDepot ? '#94a3b8' : '#b58a3d' }}>Bag Price (៛)</label>
                        <CurrencyInput
                          value={mobileBagCoveredByDepot ? '0' : (mobileBagPrice === 0 ? '0' : mobileBagPrice)} // 🔥 FIX: Forces string '0' to ensure it renders when disabled!
                          onChange={(v: any) => setMobileBagPrice(v)}
                          onFocus={() => { if (mobileBagPrice === 0) setMobileBagPrice(''); }}
                          disabled={mobileBagCoveredByDepot}
                          className="saas-input"
                          style={{ textAlign: 'center', height: '38px', backgroundColor: mobileBagCoveredByDepot ? '#f1f5f9' : '#ffffff', color: mobileBagCoveredByDepot ? '#94a3b8' : '#b58a3d', fontWeight: 'normal', fontSize: '16px' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '2px' }}>
                      <input
                        type="checkbox"
                        id="mobileCoveredByDepot"
                        checked={mobileBagCoveredByDepot}
                        onChange={(e) => setMobileBagCoveredByDepot(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#3b82f6' }}
                      />
                      <label htmlFor="mobileCoveredByDepot" style={{ fontSize: '13px', color: '#475569', fontWeight: '500', cursor: 'pointer' }}>
                        Free for Customer (Covered by Depot)
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                type="button"
                onClick={() => setSelectedMobileProduct(null)} 
                className="saas-btn saas-btn-secondary"
                style={{ fontWeight: 'normal' }}
              >
                {currentT.cancel}
              </button>
              <button 
                type="submit"
                className="saas-btn saas-btn-primary"
                style={{ fontWeight: 'normal' }}
              >
                {currentT.add}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* SALE SUMMARY MODAL */}
      <Modal isOpen={!!saleSummary} onClose={() => { setSaleSummary(null); setCompletedSale(null); }} title={saleSummary?.isCashless ? 'Sale Recorded! ✅' : saleSummary?.isDebt ? 'Partial Payment Logged ⏳' : 'Sale Complete! ✅'} icon={saleSummary?.isDebt ? "⏳" : "💰"} maxWidth="400px">
        {saleSummary?.change ? (
          saleSummary.change > 0 && (
            <div style={{ background: '#ecfdf5', padding: '20px', borderRadius: '12px', border: '2px dashed #10b981', marginBottom: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#047857', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Change to Return</div>
              <div style={{ fontSize: '38px', color: '#047857', fontWeight: 'bold', margin: '4px 0' }}>{formatRielFromNative(saleSummary.change)}</div>
              <div style={{ fontSize: '13px', color: '#059669', marginTop: '4px' }}>Out of {formatRielFromNative(saleSummary.totalReceivedInRiel)} received</div>
            </div>
          )
        ) : null}

        <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px', textTransform: 'uppercase', textAlign: 'center' }}>Items Description Formula</div>
          <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '12px' }}>
            {saleSummary?.items?.map((item: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#334155' }}>
                <span>{item.custom_name}</span>
                <span>x{item.quantity}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '16px', marginTop: '16px', fontSize: '14px' }}>
            <span style={{ color: '#64748b' }}>Total Sale:</span>
            <span style={{ color: (saleSummary?.total ?? 0) < 0 ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>{formatRielFromNative(saleSummary?.total ?? 0)}</span>
          </div>
        </div>

        <button onClick={() => { setSaleSummary(null); setCompletedSale(null); setPreviewImageUrl(null); }} className="saas-btn saas-btn-secondary" style={{ width: '100%', padding: '16px', fontSize: '15px' }}>
            Close Window
        </button>
      </Modal>

      {/* FINAL INVISIBLE DOM CAPTURE AREA */}
      {completedSale && (
        <div style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          zIndex: -9999, 
          opacity: 0.01,
          pointerEvents: 'none' 
        }}>
          <div id="invoice-capture-area" ref={invoiceRef} style={{ width: '794px', height: '559px', backgroundColor: '#ffffff', position: 'relative', margin: 0, padding: '19px', boxSizing: 'border-box', fontFamily: "'Noto Sans Khmer', Arial, sans-serif", fontSize: '12.8px', color: '#000000', overflow: 'hidden' }}>
            <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer&display=swap" rel="stylesheet" crossOrigin="anonymous" />
            
            <img 
              src={invoiceImages.watermark} 
              className="invoice-watermark" 
              style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '22%', height: 'auto', opacity: 0.12, zIndex: 0, pointerEvents: 'none', objectFit: 'contain' }} 
              alt="Watermark" 
              decoding="sync"
            />

            <div className="content" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              <div style={{ position: 'absolute', top: 0, left: 0, width: '60px', height: '70px', zIndex: 2 }}>
                <img src={invoiceImages.left} alt="Left Logo" style={{ width: '100%', height: '100%', display: 'block' }} decoding="sync" />
              </div>
              <div style={{ position: 'absolute', top: 0, right: 0, width: '85px', height: '75px', zIndex: 2 }}>
                <img src={invoiceImages.right} alt="Right Logo" style={{ width: '95%', height: '100%', display: 'block' }} decoding="sync" />
              </div>

              <header style={{ textAlign: 'center', marginBottom: '14px', lineHeight: 1.2 }}>
                <h1 style={{ fontSize: '23px', margin: '0 0 2px 0', fontWeight: 'bold', color: 'green' }}>ដេប៉ូអង្ករ រ៉េឌៀន</h1>
                <p style={{ margin: '1px 0', fontSize: '12.5px', color: 'green' }}>មានបោះដុំ លក់រាយអង្ករដែលមានគុណភាពខ្ពស់គ្រប់ប្រភេទ និងមានទទួលវិចខ្ចប់អំណោយក្នុងតម្លៃសមរម្យ</p>
                <p style={{ margin: '1px 0', fontSize: '12.5px' }}>📲 077 797 798 / 📞 081 797 798 / 📞 088 97 97 798</p>
                <p style={{ margin: '1px 0', fontSize: '12.5px' }}>📍 ផ្ទះលេខ 72 ផ្លូវលំ សង្កាត់ស្ទឹងមានជ័យ1 ខណ្ឌមានជ័យ រាជធានីភ្នំពេញ</p>
              </header>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
                <tbody>
                  <tr>
                    <td style={{ fontSize: '12.5px', padding: '2px 3px', width: '33%', textAlign: 'left' }}>
                      ឈ្មោះអតិថិជន: <span>{completedSale.customer?.name || ''}</span>
                    </td>
                    <td style={{ fontSize: '12.5px', padding: '2px 3px', width: '34%', textAlign: 'center' }}>
                      ទីតាំង: <span>{completedSale.customer?.location || ''}</span>
                    </td>
                    <td style={{ fontSize: '12.5px', padding: '2px 3px', width: '33%', textAlign: 'left' }}>
                      លេខទូរសព្ទ: <span>{completedSale.customer?.phone || ''}</span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px', fontSize: '12.5px', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '25%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'center', fontWeight: 'bold', padding: '2px 3px' }}>No.<br/>ល.រ</th>
                    <th style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'center', fontWeight: 'bold', padding: '2px 3px' }}>Item Descriptions<br/>រាយឈ្មោះទំនិញ</th>
                    <th style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'center', fontWeight: 'bold', padding: '2px 3px' }}>Quantity<br/>ចំនួន</th>
                    <th style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'center', fontWeight: 'bold', padding: '2px 3px' }}>Unit Price<br/>តម្លៃរាយ</th>
                    <th style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'center', fontWeight: 'bold', padding: '2px 3px' }}>Subtotal<br/>តម្លៃសរុប</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const displayItems = getCategorizedItemsForInvoice(completedSale.cartSnapshot);
                    const rows = [];
                    let grandTotal = 0;
                    let itemIndex = 0;
                    const maxRows = Math.max(10, displayItems.length);
                    
                    for (let i = 0; i < maxRows; i++) {
                      const item = displayItems[i];
                      if (item) {
                        itemIndex++;
                        let total = item.custom_price_riel * item.quantity;
                        const desc = item.custom_name;

                        if (desc.includes('ដូរ') || desc.includes('បញ្ចុះតម្លៃ') || desc.includes('កក់')) {
                          total = -Math.abs(total);
                        }
                        grandTotal += total;

                        const isCenter = desc.includes('ដូរ') || desc.includes('បញ្ចុះតម្លៃ') || desc.includes('កក់') || desc.includes('សេវាឡាន (អតិថិជន)');

                        rows.push(
                          <tr key={i} style={{ height: '16px' }}>
                            <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center' }}>{itemIndex}</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: isCenter ? 'center' : 'left', wordWrap: 'break-word', overflow: 'hidden' }}>{desc}</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center' }}>{item.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center' }}>{item.custom_price_riel.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px', textAlign: 'center', color: total < 0 ? 'red' : 'inherit' }}>{total.toLocaleString('en-US')}</td>
                          </tr>
                        );
                      } else {
                        rows.push(
                          <tr key={i} style={{ height: '16px' }}>
                            <td style={{ border: '1px solid #000', padding: '2px 3px' }}>&nbsp;</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px' }}>&nbsp;</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px' }}>&nbsp;</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px' }}>&nbsp;</td>
                            <td style={{ border: '1px solid #000', padding: '2px 3px' }}>&nbsp;</td>
                          </tr>
                        );
                      }
                    }
                    return (
                      <>
                        {rows}
                        <tr>
                          <td colSpan={4} style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'right', fontWeight: 'bold', padding: '2px 3px' }}>Total | សរុប</td>
                          <td style={{ border: '1px solid #000', backgroundColor: '#fffacd', textAlign: 'center', fontWeight: 'bold', padding: '2px 3px', color: grandTotal < 0 ? 'red' : 'inherit' }}>{grandTotal.toLocaleString('en-US')}</td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>

              <div style={{ margin: 'auto 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '12.5px', padding: '0 10px' }}>
                 <div style={{ display: 'flex', gap: '80px' }}>
                    <div style={{ textAlign: 'center' }}>
                       <p style={{ margin: 0 }}>ហត្ថលេខាអ្នកទិញ</p>
                       <div style={{ marginTop: '35px', marginBottom: '3px' }}>..........................................</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                       <p style={{ margin: 0 }}>ហត្ថលេខាអ្នកលក់</p>
                       <div style={{ marginTop: '35px', marginBottom: '3px' }}>..........................................</div>
                    </div>
                 </div>
                 <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0 }}>ថ្ងៃទី {completedSale.dateObj.day} ខែ {completedSale.dateObj.month} ឆ្នាំ {completedSale.dateObj.year}</p>
                 </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* RENDERED INVOICE PREVIEW MODAL */}
      <Modal isOpen={showInvoicePreview && !!completedSale} onClose={() => { setShowInvoicePreview(false); setCompletedSale(null); setPreviewImageUrl(null); }} title="Invoice Ready" icon="📄" maxWidth="850px">
        {completedSale?.changeDue > 0 && (
          <div style={{ width: '100%', background: '#ecfdf5', border: '2px dashed #10b981', borderRadius: '12px', padding: '16px 24px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#059669', fontWeight: 'bold', textTransform: 'uppercase' }}>Amount Received</div>
              <div style={{ fontSize: '18px', color: '#047857', fontWeight: 'bold' }}>{formatRielFromNative(completedSale.amountReceived)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', color: '#047857', fontWeight: 'bold', textTransform: 'uppercase' }}>Change Due ➔</div>
              <div style={{ fontSize: '32px', color: '#047857', fontWeight: 'bold' }}>{formatRielFromNative(completedSale.changeDue)}</div>
            </div>
          </div>
        )}

        <div style={{ width: '100%', padding: '0 10px', display: 'flex', justifyContent: 'center', flexShrink: 1, minHeight: 0, marginBottom: '24px' }}>
          {isGeneratingPreview || !previewImageUrl ? (
            <div style={{ padding: '40px', backgroundColor: '#f8fafc', borderRadius: '8px', color: '#334155', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '24px' }}>⏳</span> Generating High-Resolution Invoice...
            </div>
          ) : (
            <img src={previewImageUrl} alt="Invoice Preview" style={{ width: '100%', maxWidth: '794px', maxHeight: '60vh', borderRadius: '4px', objectFit: 'contain', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }} />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button onClick={() => { setShowInvoicePreview(false); setCompletedSale(null); setPreviewImageUrl(null); }} className="saas-btn saas-btn-danger">❌ {currentT.close}</button>
          
          {/* DESKTOP BUTTONS */}
          {!isDeviceMobile && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleDesktopDownloadPNG} disabled={!previewImageUrl} className="saas-btn" style={{ background: '#f59e0b', color: '#fff' }}>💾 {currentT.openInvoice}</button>
              <button onClick={handleNativePrint} className="saas-btn saas-btn-primary">🖨️ Print / PDF</button>
            </div>
          )}

          {/* MOBILE BUTTONS */}
          {isDeviceMobile && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleMobileShare} disabled={!previewImageUrl} className="saas-btn" style={{ background: '#3b82f6', color: '#fff' }}>📤 Share</button>
              <button onClick={handleNativePrint} className="saas-btn saas-btn-primary">🖨️ Print</button>
            </div>
          )}
        </div>
      </Modal>



      {/* --- GLOBAL CSS --- */}

{/* 🟢 FULL SCREEN TAKEOVER: IMPORT STOCK */}
      {/* 🔥 FIX: Added typeof document !== 'undefined' for Next.js SSR safety */}
      {isPosMounted && activeFullScreen === 'import' && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#f8fafc', zIndex: 999900, overflowY: 'auto' }}>
          
          <div style={{ 
            /* 🔥 FIX: Changed 48px to 16px. Because the burger icon is covered by the portal, we can move the title perfectly to the top left! */
            paddingTop: isDeviceMobile ? 'max(16px, env(safe-area-inset-top, 16px))' : '32px',
            paddingRight: isDeviceMobile ? '16px' : '32px',
            paddingBottom: isDeviceMobile ? '16px' : '32px',
            paddingLeft: isDeviceMobile ? '16px' : '32px',
            boxSizing: 'border-box',
            width: '100%', maxWidth: '800px', margin: '0 auto', minHeight: '100dvh', display: 'flex', flexDirection: 'column' 
          }}>
            
            <div style={{ margin: '0 0 24px 0', padding: 0, display: 'flex', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                {/* 🔥 FIX: Restored Emojis and perfect alignment */}
                <h1 className="saas-page-title" style={{ margin: 0, fontSize: isDeviceMobile ? '20px' : '24px', color: '#4a3b1b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📦 Import Stock
                </h1>
              </div>
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
                {isDeviceMobile ? (
                  <button onClick={() => setActiveFullScreen('none')} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '26px', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    ❌
                  </button>
                ) : (
                  <button onClick={() => setActiveFullScreen('none')} className="saas-btn saas-btn-danger" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#ffffff' }}>
                    ❌ Discard & Return
                  </button>
                )}
              </div>
            </div>
            
            <div className="saas-card fade-in" style={{ width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '10px' }}>
                {/* SUPPLIER */}
                <div style={{ position: 'relative', zIndex: isSupplierDropdownOpen ? 100 : 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
                    <label className="saas-card-title" style={{ fontSize: '11px', margin: 0 }}>Select Supplier</label>
                    <button onClick={() => setIsAddSupplierOpen(true)} className="saas-btn" style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', padding: 0 }}>+ Add New Supplier</button>
                  </div>
                  {isSupplierDropdownOpen ? (
                    <div style={{ position: 'relative' }}>
                      <input autoFocus className="saas-input" placeholder="Search..." value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} onBlur={() => setTimeout(() => setIsSupplierDropdownOpen(false), 200)} />
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)', maxHeight: '220px', overflowY: 'auto', zIndex: 10 }}>
                        {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                          <div key={s.id} onMouseDown={(e) => { e.stopPropagation(); setImportForm({...importForm, supplier_id: String(s.id)}); setIsSupplierDropdownOpen(false); }} style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '14px', color: '#0f172a' }}>{s.name}</div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => { setIsSupplierDropdownOpen(true); setSupplierSearch(''); }} style={{ width: '100%', padding: '12px', fontSize: '15px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: '#f8fafc' }}>
                      {importForm.supplier_id ? suppliers.find(s => String(s.id) === String(importForm.supplier_id))?.name || 'Unknown' : '-- Choose a Supplier --'}
                    </div>
                  )}
                </div>

                {/* PRODUCT */}
                <div style={{ position: 'relative', zIndex: isProductDropdownOpen ? 90 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
                    <label className="saas-card-title" style={{ fontSize: '11px', margin: 0 }}>Select Product (Rice)</label>
                    <button onClick={handleOpenAddProduct} className="saas-btn" style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', padding: 0 }}>+ Create New Product</button>
                  </div>
                  {isProductDropdownOpen ? (
                    <div style={{ position: 'relative' }}>
                      <input autoFocus className="saas-input" placeholder="Search..." value={productSearch} onChange={e => setProductSearch(e.target.value)} onBlur={() => setTimeout(() => setIsProductDropdownOpen(false), 200)} />
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', boxShadow: '0 10px 15px rgba(0,0,0,0.1)', maxHeight: '220px', overflowY: 'auto', zIndex: 10 }}>
                        {products
                        .filter(p => p.weight >= 50 && p.name.toLowerCase().includes(productSearch.toLowerCase()))
                        .sort((a, b) => riceCategoryComparator(a, b, 'cost_price')) // 🚦 MASTER SORT APPLIED
                        .map(p => (
                        <div key={p.id} onMouseDown={(e) => { e.stopPropagation(); setImportForm({...importForm, product_id: String(p.id)}); setIsProductDropdownOpen(false); }} style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#1e293b', marginBottom: '4px' }}>{p.name} <span style={{ color: '#64748b', fontSize: '11px', fontWeight: 'normal' }}>({p.weight}kg)</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                              <span>Cost: <b style={{ color: '#b58a3d' }}>{formatRiel(p.cost_price)}</b></span>
                              <span>Stock: <b style={{ color: p.stock > 0 ? '#10b981' : '#ef4444' }}>{p.stock}</b></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => { setIsProductDropdownOpen(true); setProductSearch(''); }} style={{ width: '100%', padding: '12px', fontSize: '15px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: '#f8fafc' }}>
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
                      </select>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                  <button onClick={() => handleProcessImport(true)} disabled={isProcessing} className="saas-btn" style={{ flex: 1, padding: '14px', background: '#f59e0b', color: '#fff', fontSize: '15px' }}>⏳ Save as Pending/Partial</button>
                  <button onClick={() => handleProcessImport(false)} disabled={isProcessing} className="saas-btn saas-btn-primary" style={{ flex: 1, padding: '14px', fontSize: '15px' }}>✅ Paid Full & Import</button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 🟢 FULL SCREEN TAKEOVER: MIX RICE */}
      {/* 🔥 FIX: Added typeof document !== 'undefined' for Next.js SSR safety */}
      {isPosMounted && activeFullScreen === 'mix' && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#f8fafc', zIndex: 999900, overflowY: 'auto', paddingBottom: '100px' }}>
          
          <div style={{ 
            /* 🔥 FIX: Changed 48px to 16px. Because the burger icon is covered by the portal, we can move the title perfectly to the top left! */
            paddingTop: isDeviceMobile ? 'max(16px, env(safe-area-inset-top, 16px))' : '32px',
            paddingRight: isDeviceMobile ? '16px' : '32px',
            paddingBottom: isDeviceMobile ? '100px' : '32px', 
            paddingLeft: isDeviceMobile ? '16px' : '32px',
            boxSizing: 'border-box',
            width: '100%', maxWidth: '1400px', margin: '0 auto', minHeight: '100dvh', display: 'flex', flexDirection: 'column' 
          }}>
            
            <div style={{ margin: '0 0 24px 0', padding: 0, display: 'flex', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                {/* 🔥 FIX: Restored Emojis and perfect alignment */}
                <h1 className="saas-page-title" style={{ margin: 0, fontSize: isDeviceMobile ? '20px' : '24px', color: '#4a3b1b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🥣 Mix Rice Calculator
                </h1>
              </div>
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
                {isDeviceMobile ? (
                  <button onClick={() => setActiveFullScreen('none')} style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '26px', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    ❌
                  </button>
                ) : (
                  <button onClick={() => setActiveFullScreen('none')} className="saas-btn saas-btn-danger" style={{ padding: '8px 16px', fontWeight: 'bold', color: '#ffffff' }}>
                    ❌ Discard & Return
                  </button>
                )}
              </div>
            </div>

            <div className="calculator-grid">
              {/* Rice 1 */}
              <div className="saas-card fade-in" style={{ flex: 1, minWidth: '220px' }}>
                <h2 className="saas-card-title">Base Rice A</h2>
                <div style={{ position: 'relative' }}>
                  <label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Rice Ingredient</label>
                  {activeDropdown === 'rice1' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
                  <div style={{ position: 'relative', zIndex: activeDropdown === 'rice1' ? 100 : 1 }}>
                    <input type="text" placeholder="🔍 Search rice..." value={activeDropdown === 'rice1' ? mixDropdownSearch : (rice1 ? rice1.name : '')} onClick={() => { if (activeDropdown !== 'rice1') { setActiveDropdown('rice1'); setMixDropdownSearch(''); } }} onChange={(e) => { setActiveDropdown('rice1'); setMixDropdownSearch(e.target.value); }} className="saas-input" style={{ paddingRight: '30px' }} />
                  </div>
                  {renderMixDropdownMenu('rice1')}
                </div>
                {rice1 && (
                  <div style={{ marginTop: '16px', padding: '12px', background: '#fefcf3', border: '1px solid #eadeca', borderRadius: '8px' }}>
                    <label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Batch (Optional)</label>
                    <select value={rice1BatchId || 'AUTO'} onChange={(e) => setRice1BatchId(e.target.value === 'AUTO' ? null : Number(e.target.value))} className="saas-input" style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }}>
                      <option value="AUTO">▼ Auto FIFO</option>
                      {activeBatches[rice1.id]?.map((b: any) => (<option key={b.id} value={b.id}>{formatRiel(b.cost_price)} ({b.remaining_qty} left)</option>))}
                    </select>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div><span style={{ display: 'block', fontSize: '11px', color: '#8a7650', fontWeight: 'bold' }}>Active COGS</span><span style={{ fontSize: '16px', color: '#b58a3d', fontWeight: 'bold' }}>{formatRiel(rice1BatchId ? activeBatches[rice1.id]?.find(b=>b.id===rice1BatchId)?.cost_price || rice1.cost_price : rice1.cost_price)}</span></div>
                      <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>Total Stock:<br/><b style={{ color: rice1.stock > 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{rice1.stock}</b></div>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '16px' }}><label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Portion / Quantity</label><CurrencyInput placeholder="0" value={rice1Qty} onChange={(v: any) => setRice1Qty(v)} className="saas-input" /></div>
              </div>

              <div className="math-symbol">+</div>

              {/* Rice 2 */}
              <div className="saas-card fade-in" style={{ flex: 1, minWidth: '220px' }}>
                <h2 className="saas-card-title">Base Rice B</h2>
                <div style={{ position: 'relative' }}>
                  <label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Rice Ingredient</label>
                  {activeDropdown === 'rice2' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
                  <div style={{ position: 'relative', zIndex: activeDropdown === 'rice2' ? 100 : 1 }}>
                    <input type="text" placeholder="🔍 Search rice..." value={activeDropdown === 'rice2' ? mixDropdownSearch : (rice2 ? rice2.name : '')} onClick={() => { if (activeDropdown !== 'rice2') { setActiveDropdown('rice2'); setMixDropdownSearch(''); } }} onChange={(e) => { setActiveDropdown('rice2'); setMixDropdownSearch(e.target.value); }} className="saas-input" style={{ paddingRight: '30px' }} />
                  </div>
                  {renderMixDropdownMenu('rice2')}
                </div>
                {rice2 && (
                  <div style={{ marginTop: '16px', padding: '12px', background: '#fefcf3', border: '1px solid #eadeca', borderRadius: '8px' }}>
                    <label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Batch (Optional)</label>
                    <select value={rice2BatchId || 'AUTO'} onChange={(e) => setRice2BatchId(e.target.value === 'AUTO' ? null : Number(e.target.value))} className="saas-input" style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }}>
                      <option value="AUTO">▼ Auto FIFO</option>
                      {activeBatches[rice2.id]?.map((b: any) => (<option key={b.id} value={b.id}>{formatRiel(b.cost_price)} ({b.remaining_qty} left)</option>))}
                    </select>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div><span style={{ display: 'block', fontSize: '11px', color: '#8a7650', fontWeight: 'bold' }}>Active COGS</span><span style={{ fontSize: '16px', color: '#b58a3d', fontWeight: 'bold' }}>{formatRiel(rice2BatchId ? activeBatches[rice2.id]?.find(b=>b.id===rice2BatchId)?.cost_price || rice2.cost_price : rice2.cost_price)}</span></div>
                      <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>Total Stock:<br/><b style={{ color: rice2.stock > 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{rice2.stock}</b></div>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '16px' }}><label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Portion / Quantity</label><CurrencyInput placeholder="0" value={rice2Qty} onChange={(v: any) => setRice2Qty(v)} className="saas-input" /></div>
              </div>

              {/* Rice 3 */}
              {showThirdRice && (
                <>
                  <div className="math-symbol">+</div>
                  <div className="saas-card fade-in" style={{ flex: 1, minWidth: '220px' }}>
                    <h2 className="saas-card-title">Base Rice C</h2>
                    <div style={{ position: 'relative' }}>
                      <label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Rice Ingredient</label>
                      {activeDropdown === 'rice3' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
                      <div style={{ position: 'relative', zIndex: activeDropdown === 'rice3' ? 100 : 1 }}>
                        <input type="text" placeholder="🔍 Search rice..." value={activeDropdown === 'rice3' ? mixDropdownSearch : (rice3 ? rice3.name : '')} onClick={() => { if (activeDropdown !== 'rice3') { setActiveDropdown('rice3'); setMixDropdownSearch(''); } }} onChange={(e) => { setActiveDropdown('rice3'); setMixDropdownSearch(e.target.value); }} className="saas-input" style={{ paddingRight: '30px' }} />
                      </div>
                      {renderMixDropdownMenu('rice3')}
                    </div>
                    {rice3 && (
                      <div style={{ marginTop: '16px', padding: '12px', background: '#fefcf3', border: '1px solid #eadeca', borderRadius: '8px' }}>
                        <label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Batch (Optional)</label>
                        <select value={rice3BatchId || 'AUTO'} onChange={(e) => setRice3BatchId(e.target.value === 'AUTO' ? null : Number(e.target.value))} className="saas-input" style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }}>
                          <option value="AUTO">▼ Auto FIFO</option>
                          {activeBatches[rice3.id]?.map((b: any) => (<option key={b.id} value={b.id}>{formatRiel(b.cost_price)} ({b.remaining_qty} left)</option>))}
                        </select>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div><span style={{ display: 'block', fontSize: '11px', color: '#8a7650', fontWeight: 'bold' }}>Active COGS</span><span style={{ fontSize: '16px', color: '#b58a3d', fontWeight: 'bold' }}>{formatRiel(rice3BatchId ? activeBatches[rice3.id]?.find(b=>b.id===rice3BatchId)?.cost_price || rice3.cost_price : rice3.cost_price)}</span></div>
                          <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>Total Stock:<br/><b style={{ color: rice3.stock > 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{rice3.stock}</b></div>
                        </div>
                      </div>
                    )}
                    <div style={{ marginTop: '16px' }}><label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Portion / Quantity</label><CurrencyInput placeholder="0" value={rice3Qty} onChange={(v: any) => setRice3Qty(v)} className="saas-input" /></div>
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
              {!showThirdRice ? (
                <button onClick={() => setShowThirdRice(true)} className="saas-btn saas-btn-secondary" style={{ border: '1px dashed #cbd5e1' }}>➕ Add 3rd Rice to Mix</button>
              ) : (
                <button onClick={() => { setShowThirdRice(false); setRice3Id(''); setRice3Qty(''); setRice3BatchId(null); }} className="saas-btn saas-btn-danger" style={{ background: '#fef2f2', color: '#ef4444', border: '1px dashed #fca5a5' }}>➖ Remove 3rd Rice</button>
              )}
            </div>

            {calcResult && (
              <div className="saas-card fade-in" style={{ marginTop: '30px', border: '2px solid #bbf7d0', background: '#f0fdf4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                  <h2 className="saas-card-title" style={{ margin: 0, color: '#047857', fontSize: '16px' }}>Auto-Calculated Yield</h2>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => setSyncMode('existing')} className={`saas-btn ${syncMode === 'existing' ? 'saas-btn-primary' : 'saas-btn-secondary'}`} style={syncMode === 'existing' ? { background: '#3b82f6' } : {}}>📦 Add to Existing</button>
                    <button onClick={() => setSyncMode('new')} className={`saas-btn ${syncMode === 'new' ? 'saas-btn-primary' : 'saas-btn-secondary'}`}>✨ Create New</button>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: syncMode !== 'none' ? '24px' : '0' }}>
                  <div style={{ flex: 1.5, padding: '16px 24px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span className="saas-card-title" style={{ display: 'block', marginBottom: '8px' }}>Total Raw Mix Weight</span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>{calcResult.totalYieldKg.toLocaleString('en-US', { maximumFractionDigits: 2 })} <span style={{ fontSize: '16px', fontWeight: 'normal' }}>Kg</span></span>
                  </div>
                  
                  <div style={{ flex: 2, padding: '16px 24px', background: '#fefcf3', borderRadius: '8px', border: '1px solid #fde047' }}>
                    <span className="saas-card-title" style={{ display: 'block', color: '#8a7650', marginBottom: '8px' }}>Will Generate Output of:</span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#b58a3d', display: 'flex', alignItems: 'baseline', gap: '8px' }}>{finalYield.toLocaleString('en-US', { maximumFractionDigits: 2 })} <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{outputUnit}</span></span>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', fontWeight: 'bold' }}>At new COGS: <span style={{ color: '#0f172a' }}>{formatRiel(finalCogs)} per {outputUnit.replace(/s$/, '')}</span></div>
                  </div>
                </div>

                {syncMode !== 'none' && (
                  <div className="saas-card fade-in" style={{ background: '#ffffff', padding: '20px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e293b', marginBottom: '16px' }}>{syncMode === 'new' ? 'Create & Sync New Product' : 'Select Target to Sync & Overwrite'}</div>

                    {syncMode === 'new' ? (
                      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '200px' }}><label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>New Product Name</label><input type="text" value={newMixName} onChange={e => setNewMixName(e.target.value)} className="saas-input" /></div>
                        <div style={{ flex: 1, minWidth: '150px' }}><label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Size Type</label><select value={newMixType} onChange={(e: any) => setNewMixType(e.target.value)} className="saas-input" style={{ cursor: 'pointer' }}><option value="wholesale">Wholesale (50kg Bag)</option><option value="half">Half Size (25kg Bag)</option><option value="retail">Retail (1kg)</option></select></div>
                        <div style={{ flex: 1, minWidth: '150px' }}><label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Selling Price (៛)</label><CurrencyInput value={newMixPrice} onChange={(v: any) => setNewMixPrice(v)} className="saas-input" /></div>
                      </div>
                    ) : (
                      <div style={{ marginBottom: '20px', position: 'relative' }}>
                        {activeDropdown === 'target' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
                        <div style={{ position: 'relative', zIndex: activeDropdown === 'target' ? 100 : 1 }}>
                          <input type="text" placeholder="🔍 Search target product..." value={activeDropdown === 'target' ? mixDropdownSearch : (targetProd ? `${targetProd.name}` : '')} onClick={() => { if (activeDropdown !== 'target') { setActiveDropdown('target'); setMixDropdownSearch(''); setDropdownTab('wholesale'); } }} onChange={(e) => { setActiveDropdown('target'); setMixDropdownSearch(e.target.value); }} className="saas-input" style={{ paddingRight: '30px' }} />
                        </div>
                        {renderMixDropdownMenu('target')}
                      </div>
                    )}

                    <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '16px', marginBottom: '16px' }}>
                      <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px', color: '#b45309' }}>Packaging Bag Used (Cost will be absorbed into the new Mix COGS)</label>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ flex: 2, minWidth: '200px', position: 'relative' }}>
                          {activeDropdown === 'bag' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
                          <div style={{ position: 'relative', zIndex: activeDropdown === 'bag' ? 100 : 1 }}>
                            <input type="text" placeholder="🔍 Search empty bag..." value={activeDropdown === 'bag' ? mixDropdownSearch : (bagProd ? `${bagProd.name}` : '')} onClick={() => { if (activeDropdown !== 'bag') { setActiveDropdown('bag'); setMixDropdownSearch(''); } }} onChange={(e) => { setActiveDropdown('bag'); setMixDropdownSearch(e.target.value); }} className="saas-input" />
                          </div>
                          {renderMixDropdownMenu('bag')}
                        </div>
                        <div style={{ flex: 1, minWidth: '100px' }}>
                          <CurrencyInput placeholder="Qty" value={bagQty} onChange={(v: any) => setBagQty(v)} className="saas-input" disabled={!bagId} style={{ backgroundColor: !bagId ? '#f1f5f9' : '#fff' }} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                      <button onClick={handleExecuteInventorySync} disabled={isProcessing} className="saas-btn saas-btn-primary" style={{ padding: '14px 24px', fontSize: '15px' }}>{isProcessing ? 'Processing...' : `✅ Sync and Inject ${finalYield.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${outputUnit}`}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ⚙️ POS VISIBILITY SETTINGS MODAL */}
      <Modal isOpen={isVisibilitySettingsOpen} onClose={() => { setIsVisibilitySettingsOpen(false); setVisibilitySearch(''); }} title={`⚙️ Manage ${activeTab === 'retail' ? 'Retail' : 'Wholesale'} Visibility`} maxWidth="400px">
        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px', marginTop: 0 }}>Click the eye to hide/unhide products. Hidden items will drop to the bottom.</p>
        
        {/* 🔥 NEW: Search Bar inside the Settings Modal */}
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '14px' }}>🔍</span>
          <input
            type="text"
            placeholder="Search products..."
            value={visibilitySearch}
            onChange={(e) => setVisibilitySearch(e.target.value)}
            className="saas-input"
            style={{ width: '100%', paddingLeft: '34px', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>

        <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '55vh', overflowY: 'auto', paddingRight: '4px', paddingBottom: '10px' }}>
          {products
            .filter(p => {
              // Ensure we only show the current tab's products
              const weightVal = parseFloat(String(p.weight) || '0');
              if (activeTab === 'wholesale' && weightVal <= 1) return false; 
              if (activeTab === 'retail' && weightVal > 1) return false;
              
              // 🔥 NEW: Search filter
              if (visibilitySearch && !p.name.toLowerCase().includes(visibilitySearch.toLowerCase())) return false;
              
              return true;
            })
            .sort((a, b) => {
              // 🔥 NEW: 1. Hidden items always drop to the absolute bottom!
              const isHiddenA = hiddenRetailIds.includes(a.id);
              const isHiddenB = hiddenRetailIds.includes(b.id);
              if (isHiddenA && !isHiddenB) return 1;
              if (!isHiddenA && isHiddenB) return -1;

              // 2. Sort by Rice Type Category (Keyword Algorithm)
              const idxA = getKeywordIndex(a.name);
              const idxB = getKeywordIndex(b.name);
              if (idxA !== idxB) return idxA - idxB;

              // 3. Sort by Price (HIGH TO LOW)
              const priceA = activeTab === 'retail' ? Number(a.price || 0) : Number(a.cost_price || 0);
              const priceB = activeTab === 'retail' ? Number(b.price || 0) : Number(b.cost_price || 0);
              return priceB - priceA; 
            })
            .map(p => {
              const isHidden = hiddenRetailIds.includes(p.id);
              return (
                <div 
                  key={p.id} 
                  onClick={() => toggleProductVisibility(p.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: isHidden ? '#fef2f2' : '#ffffff', border: `1px solid ${isHidden ? '#fecaca' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', transition: 'all 0.1s' }}
                >
                  {/* Eye Icon IN FRONT of Rice Name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <span style={{ color: isHidden ? '#ef4444' : '#64748b', display: 'flex', flexShrink: 0 }}>
                      {isHidden ? <EyeOffIcon /> : <EyeIcon />}
                    </span>
                    <span style={{ fontWeight: isHidden ? 'normal' : 'bold', color: isHidden ? '#94a3b8' : '#1e293b', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name}
                    </span>
                  </div>
                  
                  {/* Price */}
                  <span style={{ fontSize: '13px', color: isHidden ? '#fca5a5' : '#b58a3d', fontWeight: 'bold', flexShrink: 0, paddingLeft: '8px' }}>
                    {formatRiel(activeTab === 'retail' ? p.price : p.cost_price)} ៛
                  </span>
                </div>
              );
            })
          }
        </div>

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setIsVisibilitySettingsOpen(false)} className="saas-btn saas-btn-primary">Done</button>
        </div>
      </Modal>

      {/* ⚙️ CATEGORY REORDER MODAL */}
      <Modal isOpen={isCategorySettingsOpen} onClose={() => setIsCategorySettingsOpen(false)} title="Manage Categories" icon="⚙️" maxWidth="400px">
        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px', marginTop: 0 }}>Drag the ☰ icon up and down to reorder your menu. Preferences save automatically.</p>
        
        <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto', paddingRight: '4px', paddingBottom: '10px' }}>
          {/* 🔥 DND-KIT ENGINE */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={riceCategories} strategy={verticalListSortingStrategy}>
              {riceCategories.map(cat => (
                <SortableCategoryItem key={cat} id={cat} cat={cat} lang={lang} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setIsCategorySettingsOpen(false)} className="saas-btn saas-btn-primary">Done</button>
        </div>
      </Modal>

      {/* 🟢 PORTAL: ADD SUPPLIER MODAL (FORCED TOP Z-INDEX) */}
      {isAddSupplierOpen && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#ffffff', borderRadius: '12px', width: '100%', maxWidth: '400px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', animation: 'posPopupSlideDown 0.2s ease-out' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>🏢 Add New Supplier</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div><label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Supplier Name</label><input autoFocus value={newSupplier.name} onChange={e => setNewSupplier({...newSupplier, name: e.target.value})} className="saas-input" style={{width:'100%'}}/></div>
              <div><label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Phone Number (Optional)</label><input value={newSupplier.phone} onChange={e => setNewSupplier({...newSupplier, phone: e.target.value})} className="saas-input" style={{width:'100%'}}/></div>
              <div><label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Location / Address (Optional)</label><input value={newSupplier.location} onChange={e => setNewSupplier({...newSupplier, location: e.target.value})} className="saas-input" style={{width:'100%'}}/></div>
            </div>
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setIsAddSupplierOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
              <button onClick={handleAddSupplier} disabled={isProcessing} className="saas-btn saas-btn-primary">Save Supplier</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 🟢 PORTAL: CREATE NEW PRODUCT MODAL (FORCED TOP Z-INDEX) */}
      {isAddModalOpen && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#ffffff', borderRadius: '12px', width: '100%', maxWidth: '500px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', animation: 'posPopupSlideDown 0.2s ease-out' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>📦 Add New Product</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Product Name</label>
                {/* 🔥 Connected the Smart Typist onChange handler here */}
                <input autoFocus placeholder="e.g. Malis 25kg" value={newItem.name} onChange={handleProductNameChange} className="saas-input" style={{width:'100%'}}/>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Selling Price (៛)</label>
                  <CurrencyInput value={newItem.price} onChange={(v:any) => setNewItem({...newItem, price: v})} className="saas-input" style={{width:'100%'}}/>
                </div>
                <div>
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Cost Price (៛)</label>
                  <CurrencyInput value={newItem.cost_price} onChange={(v:any) => setNewItem({...newItem, cost_price: v})} className="saas-input" style={{width:'100%'}}/>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '8px' }}>
                <div>
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Weight (kg)</label>
                  <input type="number" className="saas-input no-spinners" value={newItem.weight} onChange={e => setNewItem({...newItem, weight: e.target.value})} style={{width:'100%'}}/>
                </div>
                <div>
                  <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>Initial Stock</label>
                  <input type="number" className="saas-input no-spinners" value={newItem.stock} onChange={e => setNewItem({...newItem, stock: e.target.value})} style={{width:'100%'}}/>
                </div>
              </div>
              
              {/* 🔥 UPGRADED: Link Wholesale Bag Search Portal (Only visible on Retail Tab) */}
              {activeTab === 'retail' && activeFullScreen === 'none' && (() => {
                const linkedProd = newItem.linked_wholesale_id ? products.find(p => String(p.id) === String(newItem.linked_wholesale_id)) : null;
                const availableBags = products
                  .filter(p => Number(p.weight) > 1 && (!linkBagSearch || p.name.toLowerCase().includes(linkBagSearch.toLowerCase())))
                  .sort((a, b) => riceCategoryComparator(a, b, 'cost_price')); // 🚦 MASTER SORT APPLIED

                return (
                  <div style={{ marginBottom: '8px', position: 'relative' }}>
                    <label className="saas-card-title" style={{ display: 'block', fontSize: '11px', margin: '0 0 6px 0' }}>🔗 Link Wholesale Bag (Optional)</label>
                    
                    {/* Trigger Button */}
                    <div 
                      className="interactive-select-trigger" 
                      onClick={() => { setIsLinkBagModalOpen(true); setLinkBagSearch(''); }} 
                      style={{ width: '100%', background: '#fff', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '42px', boxSizing: 'border-box' }}
                    >
                      <span style={{ color: linkedProd ? '#0f172a' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {linkedProd ? `🌾 ${linkedProd.name}` : '🔍 Search & Link Wholesale Bag...'}
                      </span>
                      <span style={{ fontSize: '12px', color: '#64748b', flexShrink: 0, marginLeft: '8px' }}>▼</span>
                    </div>

                    {/* 🔥 FULL-SCREEN PORTAL FOR BAG SEARCH */}
                    {isLinkBagModalOpen && typeof document !== 'undefined' && createPortal(
                      <div 
                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)', zIndex: 2147483647, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'max(16px, env(safe-area-inset-top, 16px)) 16px 16px 16px', backdropFilter: 'blur(2px)' }} 
                        onMouseDown={() => { setIsLinkBagModalOpen(false); setLinkBagSearch(''); }}
                      >
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
                                value={linkBagSearch}
                                onChange={e => setLinkBagSearch(e.target.value)}
                                style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: '14px', border: '1px solid #3b82f6', borderRadius: '6px', outline: 'none', color: '#0f172a', boxSizing: 'border-box' }}
                              />
                            </div>
                            <button onClick={(e) => { e.preventDefault(); setIsLinkBagModalOpen(false); setLinkBagSearch(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              ✕
                            </button>
                          </div>
                          
                          {/* Results List */}
                          <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: '#f8fafc' }}>
                            <button 
                              onClick={(e) => { e.preventDefault(); setNewItem({...newItem, linked_wholesale_id: '' as any}); setIsLinkBagModalOpen(false); }} 
                              className="saas-btn" 
                              style={{ width: '100%', padding: '12px', backgroundColor: '#fee2e2', color: '#dc2626', border: '1px dashed #fca5a5', borderRadius: '8px', cursor: 'pointer', fontWeight: 500, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}
                            >
                              ❌ Clear Linked Bag
                            </button>

                            {availableBags.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '14px' }}>No bags found</div>
                            ) : (
                              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                                {availableBags.map((wp, index, arr) => (
                                  <div 
                                    key={wp.id} 
                                    onClick={(e) => { e.preventDefault(); setNewItem({...newItem, linked_wholesale_id: wp.id}); setIsLinkBagModalOpen(false); }} 
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
                );
              })()}
              
              <div style={{ background: '#fef2f2', padding: '16px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <label style={{ display: 'block', fontSize: '11px', color: '#991b1b', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase' }}>🚨 Min Stock Alert Level</label>
                <input type="number" className="saas-input no-spinners" value={newItem.min_stock_level} onChange={e => setNewItem({...newItem, min_stock_level: e.target.value})} style={{ borderColor: '#fca5a5', width: '100%' }} />
                <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px', marginBottom: 0 }}>Triggers a Restock Alert if current stock falls below this amount.</p>
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setIsAddModalOpen(false)} className="saas-btn saas-btn-secondary">Cancel</button>
              <button onClick={addProduct} disabled={isProcessing} className="saas-btn saas-btn-primary">Save Product</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style jsx global>{`
        input, select, button, textarea {
          font-family: inherit;
          font-variant-numeric: tabular-nums lining-nums;
        }
        
        html, body {
          font-variant-numeric: tabular-nums lining-nums;
          background-color: #ffffff;
          
          /* 💣 THE FINAL BOSS FIX: iOS Safari Nuclear Option */
          /* 1. Physically pin the foundation layer to the device screen */
          position: fixed !important;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100vw;
          height: 100dvh;
          overflow: hidden !important;
          overscroll-behavior: none !important;
        }

        /* 🛡️ SCROLL CHAINING SHIELD */
        /* 2. Forbid the inner product lists from transferring their bounce up to the body */
        * {
          overscroll-behavior-y: none !important;
        }

        @keyframes posPopupSlideDown {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* 🔥 NEW: Smooth Full-Screen Slide Up Animation */
        @keyframes posPopupSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        /* 🟢 100% SURGICAL MODAL BACKDROP CENTERING */
        /* Only targets overlays that contain an h2, h3, or modal close button, completely ignoring Logo/Splash screens! */
        [role="dialog"],
        [role="alert"],
        div[class*="modal" i],
        div[class*="Modal" i],
        div[class*="Dialog" i],
        div[class*="dialog" i],
        div[class*="fixed"][class*="inset-0"]:has(h2),
        div[class*="fixed"][class*="inset-0"]:has(h3),
        div[class*="fixed"][class*="z-"]:has(h2),
        div[class*="fixed"][class*="z-"]:has(h3),
        div[style*="z-index"][style*="fixed"]:not([style*="flex-end"]):not([style*="2147483647"]):has(h2),
        div[style*="z-index"][style*="fixed"]:not([style*="flex-end"]):not([style*="2147483647"]):has(h3) {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 16px !important;
          height: 100dvh !important;
          max-height: 100dvh !important;
          box-sizing: border-box !important;
        }

        /* 🟢 SURGICAL INNER MODAL CARD CENTERING */
        [role="dialog"] > div,
        [role="alert"] > div,
        div[class*="modal" i] > div,
        div[class*="Modal" i] > div,
        div[class*="Dialog" i] > div,
        div[class*="dialog" i] > div,
        div[class*="fixed"][class*="inset-0"]:has(h2) > div,
        div[class*="fixed"][class*="inset-0"]:has(h3) > div,
        div[class*="fixed"][class*="z-"]:has(h2) > div,
        div[class*="fixed"][class*="z-"]:has(h3) > div,
        div[style*="z-index"][style*="fixed"]:not([style*="flex-end"]):not([style*="2147483647"]):has(h2) > div,
        div[style*="z-index"][style*="fixed"]:not([style*="flex-end"]):not([style*="2147483647"]):has(h3) > div {
          margin: auto !important;
          align-self: center !important;
          top: auto !important;
          bottom: auto !important;
          transform: none !important;
          max-height: 88dvh !important;
          overflow-y: auto !important;
        }

        /* 🟢 STICKY HEADER CSS FOR FREEZING TITLE AND MAIN TABS */
        .pos-sticky-header {
          position: sticky;
          top: 0;
          z-index: 40;
          background-color: #f8fafc;
          padding-top: max(20px, env(safe-area-inset-top, 20px));
          padding-bottom: 16px;
          margin-bottom: 0px;
          box-shadow: 0 4px 10px -2px rgba(248, 250, 252, 1);
        }

        /* 🔥 BULLETPROOF GLOBAL OVERRIDE FOR MOBILE TABS 🔥 */
        /* 🟢 CALCULATOR GRID FOR MIX RICE RESPONSIVENESS */
        .calculator-grid {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          flex-wrap: wrap;
          width: 100%;
        }
        .math-symbol {
          font-size: 32px;
          font-weight: bold;
          color: #cbd5e1;
          margin-top: 40px;
          flex-shrink: 0;
        }

        @media (max-width: 1023px) {
          .calculator-grid {
            flex-direction: column;
            align-items: stretch;
            gap: 16px;
            flex-wrap: nowrap;
          }
          .math-symbol {
            display: none;
          }
        }
        .saas-tab-container {
          flex-wrap: nowrap !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
          scrollbar-width: none !important;
        }
        .saas-tab-container::-webkit-scrollbar {
          display: none !important;
        }
        .saas-tab {
          flex-shrink: 0 !important;
          white-space: nowrap !important;
        }

        .main-wrapper { 
          padding: 0 24px 24px 24px; 
          font-family: Arial, sans-serif; 
          box-sizing: border-box; 
          width: 100%;
          min-height: 100%;
        }

        .header-container { 
          display: flex;
          justify-content: flex-start;
          align-items: center; 
          margin-bottom: 24px; 
          margin-top: 0;
          margin-left: 60px; 
          gap: 12px;
          min-height: 48px; 
          width: calc(100% - 60px); /* 🔥 THIS MATH FIXES THE OVERFLOW UNDER THE CART! */
          box-sizing: border-box;
        }
        
        .header-left {
          display: flex;
          align-items: center; 
          gap: 12px;
        }

        @media print {
          body * { visibility: hidden; }
          #invoice-capture-area, #invoice-capture-area * { visibility: visible; }
          #invoice-capture-area {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important; 
            max-width: none !important;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @page { size: A5 landscape; margin: 5mm; }
        }

        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        .mobile-fab { display: none; }

        @media (max-width: 1023px) { 
          .desktop-cart-panel { display: none !important; }
          
          .main-wrapper { 
            padding: 0 16px 140px 16px !important; 
          }
          
          .header-container { 
            margin-left: 54px !important; 
            margin-right: 0 !important;
            margin-bottom: 24px !important; 
            margin-top: 0 !important;
            display: flex !important;
            flex-direction: row !important;
            justify-content: flex-start !important;
            align-items: center !important; 
            min-height: 44px !important;
            width: calc(100% - 54px) !important;
          }

          .header-left {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 12px !important;
          }

          .mobile-fab {
            display: flex !important; 
            justify-content: space-between; 
            align-items: center; 
            position: fixed; 
            bottom: max(40px, env(safe-area-inset-bottom, 40px)); 
            left: 20px; 
            right: 20px; 
            background: #10b981; 
            color: white; 
            padding: 16px 20px; 
            border-radius: 12px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); 
            z-index: 998; 
            cursor: pointer;
          }
        }
      `}</style>
    </div>
  )
}
