'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Product, InventoryBatch } from '@/types'
import { formatRiel } from '@/utils/formatters'
import { CurrencyInput } from '@/components/Inputs'
import { useToast } from '@/components/ToastProvider'
import EmptyState from '@/components/EmptyState'
import { useBranch } from '@/components/BranchContext'

// --- LOCAL TYPES ---
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
// 🔥 NEW FIELDS FOR EDIT & VOID
targetProductId?: number;
targetBatchId?: number;
yieldKg?: number;
ingredients?: { id: number; qty: number; batchId?: number | null }[];
bagId?: number;
}

export default function RiceMixCalculator() {
const { showToast } = useToast();
const { activeBranchId } = useBranch();

const [products, setProducts] = useState<Product[]>([])
const [activeBatches, setActiveBatches] = useState<Record<number, InventoryBatch[]>>({})
// 🔥 NEW STATES FOR HISTORY EDITING
const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
const [historyEdits, setHistoryEdits] = useState<Record<string, { yieldKg: number | string, mixedCogs: number | string }>>({});
// Selection States
const [rice1Id, setRice1Id] = useState<string>('')
const [rice1Qty, setRice1Qty] = useState<number | string>('')
const [rice1BatchId, setRice1BatchId] = useState<number | null>(null)
const [rice2Id, setRice2Id] = useState<string>('')
const [rice2Qty, setRice2Qty] = useState<number | string>('')
const [rice2BatchId, setRice2BatchId] = useState<number | null>(null)

const [showThirdRice, setShowThirdRice] = useState(false)
const [rice3Id, setRice3Id] = useState<string>('')
const [rice3Qty, setRice3Qty] = useState<number | string>('')
const [rice3BatchId, setRice3BatchId] = useState<number | null>(null)

// 🟢 INLINE DROPDOWN STATES
const [activeDropdown, setActiveDropdown] = useState<'rice1' | 'rice2' | 'rice3' | 'target' | 'bag' | null>(null)
const [dropdownSearch, setDropdownSearch] = useState('')
const [dropdownTab, setDropdownTab] = useState<'wholesale' | 'retail'>('wholesale')

// Auto-Calc Results & History
const [calcResult, setCalcResult] = useState<{ blendedCogsPerKg: number, totalYieldKg: number, totalCost: number } | null>(null)
const [globalHistory, setGlobalHistory] = useState<MixHistory[]>([])
const [history, setHistory] = useState<MixHistory[]>([])
const [isProcessing, setIsProcessing] = useState(false)
// Inline Sync Action States
const [syncMode, setSyncMode] = useState<'none' | 'existing' | 'new'>('none')
const [targetProductId, setTargetProductId] = useState<string>('')
// 🔥 BAG DEDUCTION STATES
const [bagId, setBagId] = useState<string>('')
const [bagQty, setBagQty] = useState<number | string>('')

const [newMixName, setNewMixName] = useState('')
const [newMixPrice, setNewMixPrice] = useState<number | string>(0)
const [newMixType, setNewMixType] = useState<'wholesale' | 'half' | 'retail'>('wholesale')

useEffect(() => {
    // 💣 SECURITY WIPE: Destroy ghost form data and active edits when switching 
    // branches to prevent injecting Branch A's product IDs into Branch B's database!
    handleReset();
    setEditingHistoryId(null);
    setHistoryEdits({});
    
    fetchProducts();
    fetchBatches();
    fetchHistory();
  }, [activeBranchId])

const rice1 = products.find(p => p.id.toString() === rice1Id)
const rice2 = products.find(p => p.id.toString() === rice2Id)
const rice3 = products.find(p => p.id.toString() === rice3Id)
const targetProd = products.find(p => p.id.toString() === targetProductId)
const bagProd = products.find(p => p.id.toString() === bagId)

const getCogs = (prod: Product, batchId: number | null) => {
if (batchId) {
const batch = activeBatches[prod.id]?.find(b => b.id === batchId);
if (batch) return batch.cost_price;
}
return prod.cost_price;
}

// 🧠 SMART MATH ENGINE
useEffect(() => {
// 🔥 RELIABILITY FIX: Strip commas from CurrencyInput strings to prevent live math NaN crashes
const q1 = Number(String(rice1Qty).replace(/,/g, '')) || 0;
const q2 = Number(String(rice2Qty).replace(/,/g, '')) || 0;
const q3 = showThirdRice ? (Number(String(rice3Qty).replace(/,/g, '')) || 0) : 0;
const qBag = Number(String(bagQty).replace(/,/g, '')) || 0;

const hasValidThird = showThirdRice ? rice3 : true;

if (rice1 && rice2 && hasValidThird && (q1 + q2 + q3) > 0) {
const w1 = Number(rice1.weight) >= 50 ? 50 : 1;
const w2 = Number(rice2.weight) >= 50 ? 50 : 1;
const w3 = rice3 ? (Number(rice3.weight) >= 50 ? 50 : 1) : 1;

const kg1 = q1 * w1;
const kg2 = q2 * w2;
const kg3 = q3 * w3;
const totalYieldKg = kg1 + kg2 + kg3;

const cost1 = q1 * getCogs(rice1, rice1BatchId);
const cost2 = q2 * getCogs(rice2, rice2BatchId);
const cost3 = rice3 ? (q3 * getCogs(rice3, rice3BatchId)) : 0;
const costBag = bagProd ? (qBag * bagProd.cost_price) : 0;
const totalCost = cost1 + cost2 + cost3 + costBag;

const blendedCogsPerKg = totalYieldKg > 0 ? (totalCost / totalYieldKg) : 0;
setCalcResult({ blendedCogsPerKg, totalYieldKg, totalCost });
} else {
setCalcResult(null);
setSyncMode('none');
}
}, [rice1Id, rice2Id, rice3Id, rice1Qty, rice2Qty, rice3Qty, rice1BatchId, rice2BatchId, rice3BatchId, showThirdRice, bagQty, products, rice1, rice2, rice3, bagProd, activeBatches])

async function fetchProducts() {
const { data } = await supabase.from('products').select('*').eq('is_archived', false).eq('branch_id', activeBranchId).order('name', { ascending: true })
if (data) setProducts(data)
}

async function fetchBatches() {
const { data } = await supabase.from('inventory_batches')
.select('*')
.eq('branch_id', activeBranchId)
.gt('remaining_qty', 0)
.order('id', { ascending: true });
if (data) {
const bMap: Record<number, InventoryBatch[]> = {}
data.forEach(b => {
if (!bMap[b.product_id]) bMap[b.product_id] = []
bMap[b.product_id].push(b)
})
setActiveBatches(bMap)
}
}

async function fetchHistory() {
    const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
    const { data } = await supabase.from('app_settings').select('setting_value').eq('setting_key', branchKey).maybeSingle()
    if (data && data.setting_value) {
      setGlobalHistory(data.setting_value);
      setHistory(data.setting_value); // No need to filter locally, it is already isolated!
    } else {
      setGlobalHistory([]);
      setHistory([]);
    }
  }

const handleReset = () => {
setRice1Id(''); setRice1Qty(''); setRice1BatchId(null);
setRice2Id(''); setRice2Qty(''); setRice2BatchId(null);
setRice3Id(''); setRice3Qty(''); setRice3BatchId(null);
setShowThirdRice(false);
setCalcResult(null);
setSyncMode('none');
setNewMixName(''); setNewMixPrice(0); setTargetProductId('');
setBagId(''); setBagQty('');
setActiveDropdown(null);
}

const clearHistory = async () => {
    if (!confirm('Are you sure you want to clear all calculator history for this branch?')) return
    setGlobalHistory([]);
    setHistory([]);
    const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
    await supabase.from('app_settings').upsert({
      setting_key: branchKey,
      setting_value: []
    }, { onConflict: 'setting_key' })
  }

// 🔥 PERFORMANCE FIX: Memoize complex array filtering to prevent UI freezing on input keystrokes
const dropdownFilteredProducts = useMemo(() => {
return products.filter(p => {
if (dropdownSearch && !p.name.toLowerCase().includes(dropdownSearch.toLowerCase())) return false;
if (activeDropdown === 'bag') {
return p.name.includes('បាវ');
}
if (activeDropdown === 'rice1' || activeDropdown === 'rice2' || activeDropdown === 'rice3') {
if (p.stock <= 0) return false;
if (p.weight < 50) return false;
return true;
}

if (activeDropdown === 'target') {
const isWholesale = Number(p.weight) >= 50;
if (dropdownTab === 'wholesale' && !isWholesale) return false;
if (dropdownTab === 'retail' && isWholesale) return false;
return true;
}
return true;
});
}, [products, dropdownSearch, activeDropdown, dropdownTab]);

const handleSelectProduct = (p: Product, target: string) => {
if (target === 'rice1') { setRice1Id(p.id.toString()); setRice1BatchId(null); }
if (target === 'rice2') { setRice2Id(p.id.toString()); setRice2BatchId(null); }
if (target === 'rice3') { setRice3Id(p.id.toString()); setRice3BatchId(null); }
if (target === 'target') setTargetProductId(p.id.toString());
if (target === 'bag') setBagId(p.id.toString());
setActiveDropdown(null);
}

let outputUnit = 'Kg';
let outputMultiplier = 1;
let finalYield = 0;
let finalCogs = 0;

if (calcResult) {
if (syncMode === 'new') {
outputMultiplier = newMixType === 'wholesale' ? 50 : newMixType === 'half' ? 25 : 1;
outputUnit = newMixType === 'wholesale' ? 'Bags' : newMixType === 'half' ? '25kg Bags' : 'Kg';
} else if (syncMode === 'existing' && targetProd) {
outputMultiplier = Number(targetProd.weight) >= 50 ? 50 : 1;
outputUnit = Number(targetProd.weight) >= 50 ? 'Bags' : 'Kg';
} else {
outputMultiplier = 50;
outputUnit = 'Bags';
}
finalYield = calcResult.totalYieldKg / outputMultiplier;
finalCogs = calcResult.blendedCogsPerKg * outputMultiplier;
}

useEffect(() => {
if (bagId && finalYield > 0 && bagQty === '') {
setBagQty(Math.ceil(finalYield));
}
}, [finalYield, bagId]);

const handleExecuteInventorySync = async () => {
  if (!calcResult || !rice1 || !rice2) return;
  if (showThirdRice && !rice3) {
    showToast('error', 'Missing Information', 'Please select the 3rd rice or remove it.');
    return;
  }

  // 🔥 RELIABILITY FIX: Strip commas to prevent NaN crashes
  const qtyToDeduct1 = Number(String(rice1Qty).replace(/,/g, '')) || 0;
  const qtyToDeduct2 = Number(String(rice2Qty).replace(/,/g, '')) || 0;
  const qtyToDeduct3 = showThirdRice ? (Number(String(rice3Qty).replace(/,/g, '')) || 0) : 0;
  const qtyToDeductBag = Number(String(bagQty).replace(/,/g, '')) || 0;

  if (syncMode === 'new' && (!newMixName || newMixPrice === '')) {
    showToast('error', 'Missing Information', 'Please enter a name for the new mix.');
    return;
  }
  if (syncMode === 'existing' && !targetProductId) {
    showToast('error', 'Missing Information', 'Please select an existing product to update.');
    return;
  }

  if (!bagId || qtyToDeductBag <= 0) {
    showToast('error', 'Missing Bag', 'Please select a packaging bag and enter the quantity.');
    return;
  }

  // 🔥 STRICT STOCK VALIDATION (Prevents Negative Inventory)
  const requiredStock: Record<number, { name: string, needed: number, available: number }> = {};
  if (rice1 && qtyToDeduct1 > 0) requiredStock[rice1.id] = { name: rice1.name, needed: (requiredStock[rice1.id]?.needed || 0) + qtyToDeduct1, available: Number(rice1.stock) };
  if (rice2 && qtyToDeduct2 > 0) requiredStock[rice2.id] = { name: rice2.name, needed: (requiredStock[rice2.id]?.needed || 0) + qtyToDeduct2, available: Number(rice2.stock) };
  if (showThirdRice && rice3 && qtyToDeduct3 > 0) requiredStock[rice3.id] = { name: rice3.name, needed: (requiredStock[rice3.id]?.needed || 0) + qtyToDeduct3, available: Number(rice3.stock) };
  if (bagProd && qtyToDeductBag > 0) requiredStock[bagProd.id] = { name: bagProd.name, needed: (requiredStock[bagProd.id]?.needed || 0) + qtyToDeductBag, available: Number(bagProd.stock) };

  for (const prodId in requiredStock) {
    const req = requiredStock[prodId];
    if (req.needed > req.available) {
        showToast('error', 'Insufficient Stock', `Not enough ${req.name}. You need ${req.needed} but only have ${req.available} in stock.`);
        return;
    }
  }

  setIsProcessing(true);

  try {
    if (syncMode === 'new') {
      const { data: existingProd } = await supabase.from('products').select('id').ilike('name', newMixName.trim()).eq('branch_id', activeBranchId).eq('is_archived', false).maybeSingle();
      if (existingProd) {
        showToast('error', 'Duplicate Name', 'A product with this name already exists. Please use a different name or select "Add to Existing".');
        setIsProcessing(false);
        return;
      }
    }

    // 📦 PREPARE THE ATOMIC PAYLOAD
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

    // 🚀 ONE SECURE TRIP TO POSTGRES
    const { data: rpcData, error: rpcError } = await supabase.rpc('execute_rice_mix', { p_payload: mixPayload });
    if (rpcError) throw rpcError;

    // Build & Save History Record
    const yieldStr = `${finalYield.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${outputUnit}`;
    const newRecord: MixHistory = {
      id: Date.now().toString(),
      time: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      rice1Name: rice1.name, rice1Ratio: qtyToDeduct1, rice2Name: rice2.name, rice2Ratio: qtyToDeduct2,
      rice3Name: showThirdRice && rice3 ? rice3.name : undefined, rice3Ratio: showThirdRice ? qtyToDeduct3 : undefined,
      mixedCogs: finalCogs, yieldStr: yieldStr, bagUsed: bagProd ? bagProd.name : undefined, bagQty: bagProd ? qtyToDeductBag : undefined,
      branch_id: activeBranchId, targetProductId: rpcData.targetProductId, targetBatchId: rpcData.targetBatchId,
      yieldKg: finalYield, ingredients: rpcData.usedIngredients, bagId: bagProd ? bagProd.id : undefined,
    }
    
    const updatedGlobalHistory = [newRecord, ...globalHistory].slice(0, 100); 
    setGlobalHistory(updatedGlobalHistory);
    setHistory(updatedGlobalHistory);
    
    const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
    await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: updatedGlobalHistory }, { onConflict: 'setting_key' })

    showToast('success', 'Sync Successful', 'Inventory synced and Recipe stored in batch!');
    handleReset();
    fetchProducts();
    fetchBatches();

  } catch (err: any) {
    showToast('error', 'Sync Failed', err.message);
  } finally {
    setIsProcessing(false);
  }
}

// 🔥 NEW: VOID MIX HISTORY (ATOMIC VERSION)
const handleVoidMix = async (historyId: string) => {
  const record = globalHistory.find(h => h.id === historyId);
  if (!record) return;
  if (!record.targetProductId || !record.targetBatchId) {
    showToast('error', 'Legacy Record', 'Cannot automatically void this older record.');
    return;
  }
  if (!confirm('🚨 Are you sure you want to VOID this mix?\n\nThis will instantly:\n1. Delete the generated batch\n2. Deduct the output stock\n3. Restore all original ingredients back to inventory.')) return;
  
  setIsProcessing(true);
  try {
    const payload = {
      branch_id: activeBranchId,
      targetProductId: record.targetProductId,
      targetBatchId: record.targetBatchId,
      yieldKg: record.yieldKg,
      ingredients: record.ingredients,
      bagId: record.bagId,
      bagQty: record.bagQty
    };

    // 🚀 ONE SECURE TRIP TO REVERSE EVERYTHING
    const { error } = await supabase.rpc('void_rice_mix', { p_payload: payload });
    if (error) throw error;

    // Clean up history JSON
    const updatedHistory = globalHistory.filter(h => h.id !== historyId);
    setGlobalHistory(updatedHistory);
    setHistory(updatedHistory);
    
    const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
    await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: updatedHistory }, { onConflict: 'setting_key' });

    showToast('success', 'Mix Voided', 'Inventory has been fully restored.');
    fetchProducts();
    fetchBatches();
  } catch(err:any) {
     showToast('error', 'Void Failed', err.message);
  } finally {
     setIsProcessing(false);
  }
};

// 🔥 NEW: SAVE HISTORY EDIT (Updates Batch + History JSON)
const handleSaveHistoryEdit = async (historyId: string) => {
const edits = historyEdits[historyId];
const record = globalHistory.find(h => h.id === historyId);
if (!edits || !record || !record.targetProductId || !record.targetBatchId) {
setEditingHistoryId(null);
return;
}
setIsProcessing(true);
try {
// 🔥 RELIABILITY FIX: Strip commas from CurrencyInput values to safely execute math operations and prevent NaN crashes
const cleanYieldKg = Number(String(edits.yieldKg).replace(/,/g, '')) || 0;
const cleanMixedCogs = Number(String(edits.mixedCogs).replace(/,/g, '')) || 0;
const yieldDiff = cleanYieldKg - (Number(record.yieldKg) || 0);

// Update Target Product Stock Master
if (yieldDiff !== 0) {
await supabase.rpc('adjust_product_stock', { p_product_id: record.targetProductId, p_quantity: yieldDiff });

// 🔥 RELIABILITY FIX: Use atomic RPC to prevent read-modify-write race conditions on batch inventory
await supabase.rpc('adjust_batch_stock', { p_batch_id: record.targetBatchId, p_quantity: yieldDiff });
}

// Update Batch Record Cost Price Only
const batchPayload = { cost_price: cleanMixedCogs };

// 🔥 SECURITY FIX: Enforce branch isolation on batch updates
await supabase.from('inventory_batches').update(batchPayload).eq('id', record.targetBatchId).eq('branch_id', activeBranchId);

// Update local history JSON
      const updatedHistory = globalHistory.map(h => {
        if (h.id === historyId) {
          const newUnit = h.yieldStr.replace(/[0-9.,]+/, '').trim();
          return { ...h, mixedCogs: cleanMixedCogs, yieldKg: cleanYieldKg, yieldStr: `${cleanYieldKg.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${newUnit}` };
        }
        return h;
      });

      setGlobalHistory(updatedHistory);
      setHistory(updatedHistory);
      
      const branchKey = activeBranchId === 0 ? 'calculator_history' : `calculator_history_${activeBranchId}`;
      await supabase.from('app_settings').upsert({ setting_key: branchKey, setting_value: updatedHistory }, { onConflict: 'setting_key' });

      showToast('success', 'History Updated', 'The mix record and database have been updated.');
setEditingHistoryId(null);
fetchProducts();
fetchBatches();
} catch(err:any) {
showToast('error', 'Update Failed', err.message);
} finally {
setIsProcessing(false);
}
};

// 🟢 REUSABLE DROPDOWN COMPONENT
const renderDropdownMenu = (target: string) => {
if (activeDropdown !== target) return null;
return (
<div className="dropdown-menu-container">
{target === 'target' && (
<div className="saas-tab-container" style={{ margin: '8px', marginBottom: 0, padding: '4px', border: 'none', boxShadow: 'none', background: '#f1f5f9' }}>
<button
onClick={(e) => { e.stopPropagation(); setDropdownTab('wholesale'); }}
className={`saas-tab ${dropdownTab === 'wholesale' ? 'active' : ''}`}
style={{ flex: 1, textAlign: 'center', padding: '8px' }}
>
🌾 Wholesale
</button>
<button
onClick={(e) => { e.stopPropagation(); setDropdownTab('retail'); }}
className={`saas-tab ${dropdownTab === 'retail' ? 'active' : ''}`}
style={{ flex: 1, textAlign: 'center', padding: '8px' }}
>
🛍️ Retail
</button>
</div>
)}
<div className="dropdown-results-container hide-scrollbar">
{dropdownFilteredProducts.length === 0 ? (
<div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No products found</div>
) : (
dropdownFilteredProducts.map(p => (
<div
key={p.id}
onClick={(e) => { e.stopPropagation(); handleSelectProduct(p, target); }}
className="dropdown-result-item"
>
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

return (
<div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
<div className="header-container" style={{ flexShrink: 0 }}>
<div className="header-left">
<h1 className="saas-page-title" style={{ margin: 0 }}>🧮 Rice Mix Calculator</h1>
</div>
<button className="saas-btn saas-btn-secondary" onClick={handleReset}>↺ Reset</button>
</div>

<div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '80px' }}>
<div className="calculator-grid">
{/* Base Rice A */}
<div className="saas-card fade-in" style={{ flex: 1, minWidth: '250px' }}>
<h2 className="saas-card-title">Base Rice A</h2>
<div className="input-group" style={{ position: 'relative' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Rice Ingredient</label>
{activeDropdown === 'rice1' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
<div style={{ position: 'relative', zIndex: activeDropdown === 'rice1' ? 100 : 1 }}>
<input
type="text" placeholder="🔍 Search rice..." value={activeDropdown === 'rice1' ? dropdownSearch : (rice1 ? rice1.name : '')}
onClick={() => { if (activeDropdown !== 'rice1') { setActiveDropdown('rice1'); setDropdownSearch(''); setDropdownTab('wholesale'); } }}
onChange={(e) => { setActiveDropdown('rice1'); setDropdownSearch(e.target.value); }} className="saas-input"
style={{ paddingRight: '30px', borderColor: activeDropdown === 'rice1' ? '#b58a3d' : undefined, boxShadow: activeDropdown === 'rice1' ? '0 0 0 2px rgba(181, 138, 61, 0.2)' : undefined }}
/>
<span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', fontSize: '12px' }}>▼</span>
</div>
{renderDropdownMenu('rice1')}
</div>
{rice1 && (
<div className="price-display fade-in" style={{ padding: '12px' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Batch (Optional)</label>
<select
value={rice1BatchId || 'AUTO'}
onChange={(e) => setRice1BatchId(e.target.value === 'AUTO' ? null : Number(e.target.value))}
className="saas-input"
style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }}
>
<option value="AUTO">▼ Auto FIFO (Oldest First)</option>
{activeBatches[rice1.id]?.map((b: any) => (
<option key={b.id} value={b.id}>
{formatRiel(b.cost_price)} ({b.remaining_qty} left) {b.notes ? `| ${b.notes}` : ''}
</option>
))}
</select>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
<div>
<span className="label" style={{ marginBottom: 0 }}>Active COGS</span>
<span className="value" style={{ fontSize: '16px' }}>{formatRiel(rice1BatchId ? activeBatches[rice1.id]?.find(b=>b.id===rice1BatchId)?.cost_price || rice1.cost_price : rice1.cost_price)}</span>
</div>
<div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>
Total Stock:<br/>
<b style={{ color: rice1.stock > 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{rice1.stock}</b>
</div>
</div>
</div>
)}
<div className="input-group" style={{ marginTop: '16px' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Portion / Quantity</label>
<CurrencyInput placeholder="0" value={rice1Qty} onChange={(v: any) => setRice1Qty(v)} className="saas-input" />
</div>
</div>

<div className="math-symbol">+</div>

{/* Base Rice B */}
<div className="saas-card fade-in" style={{ flex: 1, minWidth: '250px' }}>
<h2 className="saas-card-title">Base Rice B</h2>
<div className="input-group" style={{ position: 'relative' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Rice Ingredient</label>
{activeDropdown === 'rice2' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
<div style={{ position: 'relative', zIndex: activeDropdown === 'rice2' ? 100 : 1 }}>
<input
type="text" placeholder="🔍 Search rice..." value={activeDropdown === 'rice2' ? dropdownSearch : (rice2 ? rice2.name : '')}
onClick={() => { if (activeDropdown !== 'rice2') { setActiveDropdown('rice2'); setDropdownSearch(''); setDropdownTab('wholesale'); } }}
onChange={(e) => { setActiveDropdown('rice2'); setDropdownSearch(e.target.value); }} className="saas-input"
style={{ paddingRight: '30px', borderColor: activeDropdown === 'rice2' ? '#b58a3d' : undefined, boxShadow: activeDropdown === 'rice2' ? '0 0 0 2px rgba(181, 138, 61, 0.2)' : undefined }}
/>
<span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', fontSize: '12px' }}>▼</span>
</div>
{renderDropdownMenu('rice2')}
</div>
{rice2 && (
<div className="price-display fade-in" style={{ padding: '12px' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Batch (Optional)</label>
<select
value={rice2BatchId || 'AUTO'}
onChange={(e) => setRice2BatchId(e.target.value === 'AUTO' ? null : Number(e.target.value))}
className="saas-input"
style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }}
>
<option value="AUTO">▼ Auto FIFO (Oldest First)</option>
{activeBatches[rice2.id]?.map((b: any) => (
<option key={b.id} value={b.id}>
{formatRiel(b.cost_price)} ({b.remaining_qty} left) {b.notes ? `| ${b.notes}` : ''}
</option>
))}
</select>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
<div>
<span className="label" style={{ marginBottom: 0 }}>Active COGS</span>
<span className="value" style={{ fontSize: '16px' }}>{formatRiel(rice2BatchId ? activeBatches[rice2.id]?.find(b=>b.id===rice2BatchId)?.cost_price || rice2.cost_price : rice2.cost_price)}</span>
</div>
<div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>
Total Stock:<br/>
<b style={{ color: rice2.stock > 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{rice2.stock}</b>
</div>
</div>
</div>
)}
<div className="input-group" style={{ marginTop: '16px' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Portion / Quantity</label>
<CurrencyInput placeholder="0" value={rice2Qty} onChange={(v: any) => setRice2Qty(v)} className="saas-input" />
</div>
</div>
{showThirdRice && (
<>
<div className="math-symbol">+</div>
<div className="saas-card fade-in" style={{ flex: 1, minWidth: '250px' }}>
<h2 className="saas-card-title">Base Rice C</h2>
<div className="input-group" style={{ position: 'relative' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Rice Ingredient</label>
{activeDropdown === 'rice3' && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>}
<div style={{ position: 'relative', zIndex: activeDropdown === 'rice3' ? 100 : 1 }}>
<input
type="text" placeholder="🔍 Search rice..." value={activeDropdown === 'rice3' ? dropdownSearch : (rice3 ? rice3.name : '')}
onClick={() => { if (activeDropdown !== 'rice3') { setActiveDropdown('rice3'); setDropdownSearch(''); setDropdownTab('wholesale'); } }}
onChange={(e) => { setActiveDropdown('rice3'); setDropdownSearch(e.target.value); }} className="saas-input"
style={{ paddingRight: '30px', borderColor: activeDropdown === 'rice3' ? '#b58a3d' : undefined, boxShadow: activeDropdown === 'rice3' ? '0 0 0 2px rgba(181, 138, 61, 0.2)' : undefined }}
/>
<span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', fontSize: '12px' }}>▼</span>
</div>
{renderDropdownMenu('rice3')}
</div>
{rice3 && (
<div className="price-display fade-in" style={{ padding: '12px' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Select Batch (Optional)</label>
<select
value={rice3BatchId || 'AUTO'}
onChange={(e) => setRice3BatchId(e.target.value === 'AUTO' ? null : Number(e.target.value))}
className="saas-input"
style={{ width: '100%', padding: '6px', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }}
>
<option value="AUTO">▼ Auto FIFO (Oldest First)</option>
{activeBatches[rice3.id]?.map((b: any) => (
<option key={b.id} value={b.id}>
{formatRiel(b.cost_price)} ({b.remaining_qty} left) {b.notes ? `| ${b.notes}` : ''}
</option>
))}
</select>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
<div>
<span className="label" style={{ marginBottom: 0 }}>Active COGS</span>
<span className="value" style={{ fontSize: '16px' }}>{formatRiel(rice3BatchId ? activeBatches[rice3.id]?.find(b=>b.id===rice3BatchId)?.cost_price || rice3.cost_price : rice3.cost_price)}</span>
</div>
<div style={{ fontSize: '11px', color: '#64748b', textAlign: 'right' }}>
Total Stock:<br/>
<b style={{ color: rice3.stock > 0 ? '#10b981' : '#ef4444', fontSize: '14px' }}>{rice3.stock}</b>
</div>
</div>
</div>
)}
<div className="input-group" style={{ marginTop: '16px' }}>
<label className="saas-card-title" style={{ fontSize: '11px', marginBottom: '6px', display: 'block' }}>Portion / Quantity</label>
<CurrencyInput placeholder="0" value={rice3Qty} onChange={(v: any) => setRice3Qty(v)} className="saas-input" />
</div>
</div>
</>
)}
</div>

<div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
{!showThirdRice ? (
<button onClick={() => setShowThirdRice(true)} className="saas-btn saas-btn-secondary" style={{ border: '1px dashed #cbd5e1' }}>
➕ Add 3rd Rice to Mix
</button>
) : (
<button onClick={() => { setShowThirdRice(false); setRice3Id(''); setRice3Qty(''); setRice3BatchId(null); }} className="saas-btn saas-btn-danger" style={{ background: '#fef2f2', color: '#ef4444', border: '1px dashed #fca5a5' }}>
➖ Remove 3rd Rice
</button>
)}
</div>

{calcResult && (
<div className="saas-card mint fade-in" style={{ marginTop: '30px', border: '2px solid #bbf7d0' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
<h2 className="saas-card-title" style={{ margin: 0, color: '#047857', fontSize: '16px' }}>Auto-Calculated Yield</h2>
<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
<button
onClick={() => setSyncMode('existing')}
className={`saas-btn ${syncMode === 'existing' ? 'saas-btn-primary' : 'saas-btn-secondary'}`}
style={syncMode === 'existing' ? { background: '#3b82f6' } : {}}
>
📦 Add to Existing
</button>
<button
onClick={() => setSyncMode('new')}
className={`saas-btn ${syncMode === 'new' ? 'saas-btn-primary' : 'saas-btn-secondary'}`}
>
✨ Create New
</button>
</div>
</div>
<div className="result-stats" style={{ marginBottom: syncMode !== 'none' ? '24px' : '0' }}>
<div className="stat-box" style={{ flex: 1.5 }}>
<span className="saas-card-title">Total Raw Mix Weight</span>
<span className="saas-card-metric" style={{ color: '#3b82f6' }}>
{calcResult.totalYieldKg.toLocaleString('en-US', { maximumFractionDigits: 2 })} <span style={{ fontSize: '16px', fontWeight: 'normal' }}>Kg</span>
</span>
</div>
<div className="stat-box highlight" style={{ flex: 2 }}>
<span className="saas-card-title" style={{ color: '#8a7650' }}>Will Generate Output of:</span>
<span className="saas-card-metric" style={{ display: 'flex', alignItems: 'baseline', gap: '8px', color: '#b58a3d' }}>
{finalYield.toLocaleString('en-US', { maximumFractionDigits: 2 })} <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{outputUnit}</span>
</span>
<div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', fontWeight: 'bold' }}>
At new COGS: <span style={{ color: '#0f172a' }}>{formatRiel(finalCogs)} per {outputUnit.replace(/s$/, '')}</span>
</div>
</div>
</div>

{syncMode !== 'none' && (
<div className="saas-card fade-in" style={{ background: '#f8fafc', padding: '20px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
<div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e293b', marginBottom: '16px' }}>
{syncMode === 'new' ? 'Create & Sync New Product' : 'Select Target to Sync & Overwrite'}
</div>

{syncMode === 'new' ? (
<div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
<div style={{ flex: 1, minWidth: '200px' }}>
<label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>New Product Name</label>
<input type="text" placeholder="New product name..." value={newMixName} onChange={e => setNewMixName(e.target.value)} className="saas-input" />
</div>
<div style={{ flex: 1, minWidth: '150px' }}>
<label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Size Type</label>
<select value={newMixType} onChange={(e: any) => setNewMixType(e.target.value)} className="saas-input" style={{ cursor: 'pointer' }}>
<option value="wholesale">Wholesale (50kg Bag)</option>
<option value="half">Half Size (25kg Bag)</option>
<option value="retail">Retail (1kg)</option>
</select>
</div>
<div style={{ flex: 1, minWidth: '150px' }}>
<label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px' }}>Selling Price (៛)</label>
<CurrencyInput value={newMixPrice} onChange={(v: any) => setNewMixPrice(v)} className="saas-input" />
</div>
</div>
) : (
<div style={{ marginBottom: '20px', position: 'relative' }}>
{activeDropdown === 'target' && (
<div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>
)}
<div style={{ position: 'relative', zIndex: activeDropdown === 'target' ? 100 : 1 }}>
<input
type="text"
placeholder="🔍 Search target product..."
value={activeDropdown === 'target' ? dropdownSearch : (targetProd ? `${targetProd.name} (Cost: ${formatRiel(targetProd.cost_price)})` : '')}
onClick={() => {
if (activeDropdown !== 'target') {
setActiveDropdown('target');
setDropdownSearch('');
setDropdownTab('wholesale');
}
}}
onChange={(e) => {
setActiveDropdown('target');
setDropdownSearch(e.target.value);
}}
className="saas-input"
style={{ paddingRight: '30px' }}
/>
<span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', fontSize: '12px' }}>▼</span>
</div>
{renderDropdownMenu('target')}
</div>
)}

{/* 🔥 BAG DEDUCTION SELECTOR */}
<div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '16px', marginBottom: '16px', position: 'relative' }}>
<label className="saas-card-title" style={{ display: 'block', fontSize: '11px', marginBottom: '6px', color: '#b45309' }}>
Packaging Bag Used (Cost will be absorbed into the new Mix COGS)
</label>
<div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
<div style={{ flex: 2, minWidth: '200px', position: 'relative' }}>
{activeDropdown === 'bag' && (
<div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActiveDropdown(null)}></div>
)}
<div style={{ position: 'relative', zIndex: activeDropdown === 'bag' ? 100 : 1 }}>
<input
type="text"
placeholder="🔍 Search empty bag..."
value={activeDropdown === 'bag' ? dropdownSearch : (bagProd ? `${bagProd.name} (Cost: ${formatRiel(bagProd.cost_price)})` : '')}
onClick={() => {
if (activeDropdown !== 'bag') {
setActiveDropdown('bag');
setDropdownSearch('');
}
}}
onChange={(e) => {
setActiveDropdown('bag');
setDropdownSearch(e.target.value);
}}
className="saas-input"
style={{ paddingRight: '30px' }}
/>
<span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', fontSize: '12px' }}>▼</span>
</div>
{renderDropdownMenu('bag')}
</div>
<div style={{ flex: 1, minWidth: '100px' }}>
<CurrencyInput
placeholder="Qty"
value={bagQty}
onChange={(v: any) => setBagQty(v)}
className="saas-input"
disabled={!bagId}
style={{ backgroundColor: !bagId ? '#f1f5f9' : '#fff' }}
/>
</div>
</div>
</div>

<div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
<button onClick={handleExecuteInventorySync} disabled={isProcessing} className="saas-btn saas-btn-primary" style={{ padding: '14px 24px', fontSize: '15px' }}>
{isProcessing ? 'Processing...' : `✅ Sync and Inject ${finalYield.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${outputUnit}`}
</button>
</div>
</div>
)}
</div>
)}

{/* HISTORY LOG */}
<div style={{ marginTop: '40px' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
<h3 style={{ color: '#1e293b', margin: 0, fontSize: '16px' }}>Calculation History</h3>
{history.length > 0 && (
<button onClick={clearHistory} className="saas-btn saas-btn-danger" style={{ padding: '6px 12px', fontSize: '12px' }}>Clear History</button>
)}
</div>
<div className="saas-table-wrapper">
<div className="saas-table-responsive">
<table className="saas-table">
<thead>
<tr>
<th className="saas-th">Time</th>
<th className="saas-th">Recipe Formula</th>
<th className="saas-th">Final Yield</th>
<th className="saas-th">Bag Used</th>
<th className="saas-th">Mixed COGS</th>
<th className="saas-th" style={{ textAlign: 'center' }}>Actions</th>
</tr>
</thead>
<tbody>
{history.length === 0 ? (
<tr>
<td colSpan={6} style={{ padding: 0 }}>
<EmptyState
icon="🕒"
title="No history yet"
message="Calculations and inventory syncs will appear here."
/>
</td>
</tr>
) : (
history.map(h => {
const isEditing = editingHistoryId === h.id;
const editData = historyEdits[h.id] || { yieldKg: h.yieldKg || 0, mixedCogs: h.mixedCogs || 0 };
return (
<tr key={h.id} className="saas-tr" style={{ background: isEditing ? '#fefcf3' : 'transparent' }}>
<td className="saas-td" style={{ color: '#64748b', fontSize: '13px' }}>{h.time}</td>
<td className="saas-td" style={{ color: '#334155', fontSize: '14px' }}>
({h.rice1Ratio} × <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{h.rice1Name}</span>)
+ ({h.rice2Ratio} × <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{h.rice2Name}</span>)
{h.rice3Name && h.rice3Ratio ? (
<> + ({h.rice3Ratio} × <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{h.rice3Name}</span>)</>
) : null}
</td>
<td className="saas-td" style={{ color: '#10b981', fontWeight: 'bold', fontSize: '13px' }}>
{isEditing ? (
// 🔥 STATE FIX: Use functional updates to prevent dropped keystrokes and stale closures
<CurrencyInput value={editData.yieldKg} onChange={(v:any) => setHistoryEdits(prev => ({...prev, [h.id]: {...(prev[h.id] || editData), yieldKg: v}}))} className="saas-input no-spinners" style={{ width: '80px', padding: '4px 8px', fontSize: '13px' }} />
) : (
h.yieldStr || '-'
)}
</td>
<td className="saas-td" style={{ color: '#b45309', fontSize: '13px' }}>
{h.bagUsed ? `${h.bagQty}x ${h.bagUsed}` : '-'}
</td>
<td className="saas-td" style={{ color: '#b58a3d', fontWeight: 'bold', fontSize: '14px' }}>
{isEditing ? (
// 🔥 STATE FIX: Use functional updates to prevent dropped keystrokes and stale closures
<CurrencyInput value={editData.mixedCogs} onChange={(v:any) => setHistoryEdits(prev => ({...prev, [h.id]: {...(prev[h.id] || editData), mixedCogs: v}}))} className="saas-input no-spinners" style={{ width: '100px', padding: '4px 8px', fontSize: '13px' }} />
) : (
formatRiel(h.mixedCogs)
)}
</td>
<td className="saas-td" style={{ textAlign: 'center' }}>
{h.targetProductId && h.targetBatchId ? (
isEditing ? (
<div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
<button onClick={() => handleSaveHistoryEdit(h.id)} disabled={isProcessing} className="saas-btn saas-btn-primary" style={{ padding: '4px 8px', fontSize: '11px' }}>Save</button>
<button onClick={() => setEditingHistoryId(null)} className="saas-btn saas-btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }}>Cancel</button>
</div>
) : (
<div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
<button onClick={() => { setEditingHistoryId(h.id); setHistoryEdits({ [h.id]: { yieldKg: h.yieldKg || parseFloat(h.yieldStr), mixedCogs: h.mixedCogs }}); }} className="saas-btn" style={{ padding: '4px 8px', background: '#e0f2fe', color: '#0284c7', border: '1px solid #bae6fd', fontSize: '11px' }}>✏️ Edit</button>
<button onClick={() => handleVoidMix(h.id)} disabled={isProcessing} className="saas-btn saas-btn-danger" style={{ padding: '4px 8px', fontSize: '11px' }}>❌ Void</button>
</div>
)
) : (
<span style={{ fontSize: '11px', color: '#94a3b8' }}>Legacy Record</span>
)}
</td>
</tr>
);
})
)}
</tbody>
</table>
</div>
</div>
</div>
</div>

{/* --- PAGE-SPECIFIC CSS --- */}
<style jsx global>{`
.header-container {
display: flex; justify-content: space-between; align-items: center;
margin-bottom: 24px; margin-top: 0; margin-left: 60px; gap: 12px;
min-height: 48px; width: calc(100% - 60px); max-width: 1600px; padding-right: 24px;
}
.header-left { display: flex; align-items: center; height: 100%; gap: 12px; }
.dropdown-menu-container {
position: absolute; top: calc(100% + 4px); left: 0; right: 0; background-color: #fff;
border: 1px solid #cbd5e1; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15);
z-index: 101; overflow: hidden; display: flex; flex-direction: column;
}
.dropdown-results-container { max-height: 220px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.dropdown-result-item { padding: 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; border-radius: 8px; transition: background 0.2s; }
.dropdown-result-item:hover { background-color: #f8fafc; }
.fade-in { animation: fadeIn 0.3s ease-in-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
.calculator-grid { display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
.math-symbol { font-size: 32px; font-weight: bold; color: #cbd5e1; margin-top: 40px; }
.price-display { margin-top: 16px; background: #fefcf3; border: 1px solid #eadeca; border-radius: 8px; }
.price-display .label { display: block; font-size: 11px; color: #8a7650; text-transform: uppercase; font-weight: bold; margin-bottom: 4px; }
.price-display .value { font-size: 18px; color: #b58a3d; font-weight: bold; }
.result-stats { display: flex; gap: 20px; flex-wrap: wrap; }
.stat-box { flex: 1; min-width: 200px; padding: 16px 24px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
.stat-box.highlight { background: #fefcf3; border-color: #fde047; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
.hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
input[type="text"].no-spinners::-webkit-inner-spin-button, input[type="text"].no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
@media (max-width: 1023px) {
.header-container {
margin-left: 54px !important; margin-right: 0 !important; margin-bottom: 24px !important; margin-top: 0 !important;
display: flex !important; flex-direction: row !important; justify-content: space-between !important;
align-items: center !important; height: 44px !important; width: calc(100% - 54px) !important;
}
.calculator-grid { flex-direction: column; align-items: stretch; gap: 16px; }
.math-symbol { display: none; }
.result-stats { flex-direction: column; gap: 12px; }
}
`}</style>
</div>
)
}
