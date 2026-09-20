'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useUserRole } from '@/lib/useUserRole'
import { useBranch } from '@/components/BranchContext' 
// 🔥 NEW DND-KIT IMPORTS
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface MenuItem {
  label: string;
  href: string;
  adminOnly: boolean;
}

const defaultMenuItems: MenuItem[] = [
  { label: '📊 Dashboard', href: '/dashboard', adminOnly: false },
  { label: '🛒 POS System', href: '/pos', adminOnly: false },
  { label: '🚚 Delivery & Credit', href: '/delivery', adminOnly: false },
  { label: '💸 Expense & Payroll', href: '/expense', adminOnly: false },
  { label: '🌾 Inventory & Suppliers', href: '/rice', adminOnly: false },
  { label: '🧮 Mix Calculator', href: '/calculator', adminOnly: false },
  { label: '🖼️ Invoice Gallery', href: '/invoices', adminOnly: false },
  { label: '🧾 COGS Accounting', href: '/cogs-report', adminOnly: false },
  { label: '🧑‍🌾 Customer Database', href: '/customerdatabase', adminOnly: false },
  { label: '🔐 Master Biz Database', href: '/bizdatabase', adminOnly: false },
  { label: '📲 Report', href: '/report', adminOnly: false },
  { label: '🛠️ Dev Test', href: '/dev-test', adminOnly: true },
  { label: '⚙️ Settings', href: '/settings', adminOnly: true },
  { label: '📋 Signup', href: '/signup', adminOnly: false }
]

// 🔥 NEW: PROFESSIONAL SORTABLE ITEM COMPONENT (Whole Item Draggable)
function SortableSidebarItem({ item, isActive, setIsOpen }: { item: MenuItem, isActive: boolean, setIsOpen: (val: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.label });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.8 : 1,
    boxShadow: isDragging ? '0 10px 25px rgba(0,0,0,0.3)' : 'none',
    borderRadius: '6px',
    touchAction: 'none' // 🔥 Crucial for smooth mobile dragging
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Link 
        href={item.href}
        onClick={(e) => {
          // 🔥 PREVENTS CLICK NAVIGATION IF USER IS DRAGGING
          if (isDragging) {
            e.preventDefault();
            return;
          }
          setIsOpen(false);
        }} 
        draggable={false} // Disable native ghost image
        style={{
          color: 'white',
          textDecoration: 'none',
          fontSize: '14px',
          padding: '10px 12px',
          borderRadius: '6px',
          display: 'block',
          whiteSpace: 'nowrap',
          background: isActive ? '#1f2937' : 'transparent',
          borderLeft: isActive ? '4px solid #38bdf8' : '4px solid transparent',
          fontWeight: isActive ? 'bold' : 'normal',
          transition: 'background 0.2s',
          cursor: isDragging ? 'grabbing' : 'pointer', // 🔥 SHOW GRABBING HAND WHEN DRAGGING, NORMAL POINTER OTHERWISE
          pointerEvents: isDragging ? 'none' : 'auto' // 🔥 DISABLES INNER CLICKS WHILE DRAGGING
        }}
      >
        {item.label}
      </Link>
    </div>
  );
}

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false)
  const [menuItems, setMenuItems] = useState<MenuItem[]>(defaultMenuItems)
  const pathname = usePathname()
  const router = useRouter()
  
  const { role, loadingRole } = useUserRole();
  const { branches, activeBranchId, setActiveBranchId } = useBranch();

  const [isMounted, setIsMounted] = useState(false); // 🔥 FIX: State to prevent SSR mismatch

  const sidebarRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 🔥 FIX: Set mounted to true once the browser takes over
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 🔥 NEW: THE SMART GATEKEEPER
  // If the user leaves the Dashboard while in HQ Mode, force them back to Branch 1
  useEffect(() => {
    if (activeBranchId === 0 && pathname !== '/dashboard') {
      const defaultBranch = branches.length > 0 ? branches[0].id : 1;
      setActiveBranchId(defaultBranch);
    }
  }, [pathname, activeBranchId, branches, setActiveBranchId]);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar_menu_order')
    if (saved) {
      try {
        const savedOrder = JSON.parse(saved)
        const sorted = [...defaultMenuItems].sort((a, b) => {
          const idxA = savedOrder.indexOf(a.label)
          const idxB = savedOrder.indexOf(b.label)
          if (idxA === -1 && idxB === -1) return 0
          if (idxA === -1) return 1
          if (idxB === -1) return -1
          return idxA - idxB
        })
        setMenuItems(sorted)
      } catch (e) {}
    }
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/')
      }
    })
    return () => subscription.unsubscribe()
  }, [router])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isOpen && 
        sidebarRef.current && 
        !sidebarRef.current.contains(event.target as Node) &&
        buttonRef.current && 
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // 🔥 SECURITY & CLOSURE FIX: Wipe branch memory on logout so the next user starts fresh
  const handleLogout = React.useCallback(async () => {
    localStorage.removeItem('pos_active_branch_id');
    await supabase.auth.signOut();
    router.push('/');
  }, [router]);

  // 🔥 NEW DND-KIT SENSORS AND HANDLERS
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), 
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // 🔥 CLOSURE FIX: Wrap in useCallback to prevent continuous memory reallocation
  const handleDragEnd = React.useCallback((event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setMenuItems((items) => {
        const oldIndex = items.findIndex(i => i.label === active.id);
        const newIndex = items.findIndex(i => i.label === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        localStorage.setItem('sidebar_menu_order', JSON.stringify(newOrder.map(i => i.label)));
        return newOrder;
      });
    }
  }, []);

  if (pathname === '/') return null;

  return (
    <>
      <div 
        className={`sidebar-backdrop ${isOpen ? 'open' : ''}`} 
        onClick={() => setIsOpen(false)} 
      />

      <button
        ref={buttonRef} 
        className="burger-btn"
        onClick={() => setIsOpen(!isOpen)}
        style={{ boxShadow: isOpen ? 'none' : '0 2px 8px rgba(0,0,0,0.2)' }}
        aria-label="Toggle Navigation Sidebar"
      >
        ☰
      </button>

      <div 
        ref={sidebarRef} 
        className={`sidebar-wrapper ${isOpen ? 'open' : 'closed'}`}
      >
        <div>
          {/* 🔥 THE BRANCH SWITCHER */}
          <div className="sidebar-header" style={{ paddingRight: '24px' }}>
            <select
              value={activeBranchId}
              onChange={(e) => setActiveBranchId(Number(e.target.value))}
              disabled={role !== 'admin'} 
              style={{
                width: '100%',
                padding: '10px 12px', 
                borderRadius: '6px',
                background: role === 'admin' ? '#1f2937' : 'transparent',
                color: 'white',
                border: role === 'admin' ? '1px solid #374151' : 'none',
                fontSize: '14px', 
                fontWeight: 'bold', 
                cursor: role === 'admin' ? 'pointer' : 'default',
                outline: 'none',
                appearance: role === 'admin' ? 'auto' : 'none' 
              }}
              title={role !== 'admin' ? "You are locked to this branch" : "Switch Workspace"}
            >
              {/* 🔥 ONLY SHOW GLOBAL HQ WHEN ON DASHBOARD */}
              {pathname === '/dashboard' && (
                 <option value={0} style={{ fontWeight: 'bold' }}>🌍 Global HQ (All)</option>
              )}
              <optgroup label="Your Stores">
                {branches.map(b => (
                  <option key={b.id} value={b.id}>🏬 {b.name}</option> 
                ))}
              </optgroup>
            </select>
          </div>
          
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 🔥 FIX: Only render DND engine after client hydration to prevent ID mismatch */}
            {isMounted ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={menuItems.map(i => i.label)} strategy={verticalListSortingStrategy}>
                  {menuItems.map((item) => {
                    const isAllowed = !item.adminOnly || (!loadingRole && role === 'admin');
                    if (!isAllowed) return null;
                    const isActive = pathname === item.href;
                    return (
                      <SortableSidebarItem 
                        key={item.label} 
                        item={item} 
                        isActive={isActive} 
                        setIsOpen={setIsOpen} 
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            ) : (
              /* 🔥 SSR FALLBACK: Renders static links to prevent flashing before hydration */
              menuItems.map((item) => {
                const isAllowed = !item.adminOnly || (!loadingRole && role === 'admin');
                if (!isAllowed) return null;
                const isActive = pathname === item.href;
                return (
                  <div key={item.label}>
                    <Link 
                      href={item.href}
                      style={{
                        color: 'white', textDecoration: 'none', fontSize: '14px', padding: '10px 12px',
                        borderRadius: '6px', display: 'block', whiteSpace: 'nowrap',
                        background: isActive ? '#1f2937' : 'transparent',
                        borderLeft: isActive ? '4px solid #38bdf8' : '4px solid transparent',
                        fontWeight: isActive ? 'bold' : 'normal'
                      }}
                    >
                      {item.label}
                    </Link>
                  </div>
                )
              })
            )}
          </nav>
        </div>

        <button 
          onClick={handleLogout} 
          style={{
            background: '#b91c1c',
            color: 'white',
            border: 'none',
            padding: '12px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            width: '100%',
            transition: 'background 0.2s',
            marginTop: '20px'
          }}
        >
          🚪 Log Out
        </button>
      </div>

      <style jsx>{`
        .burger-btn {
          position: fixed;
          top: max(20px, env(safe-area-inset-top, 20px));
          left: max(24px, env(safe-area-inset-left, 24px));
          z-index: 1001;
          background: #111827;
          color: white;
          border: none;
          border-radius: 6px;
          width: 42px;
          height: 42px;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0; 
          box-sizing: border-box;
          outline: none;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          height: 42px; 
          margin-bottom: 24px;
          margin-left: 54px; 
        }

        .sidebar-backdrop {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 999;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.3s ease;
          touch-action: none;
        }

        .sidebar-wrapper {
          background: #111827;
          color: white;
          height: 100%; 
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
          transition: all 0.3s ease-in-out;
          overflow-x: hidden;
          overflow-y: auto;
          z-index: 1000;
        }

        .sidebar-wrapper.closed {
          width: 0px;
          min-width: 0px;
          opacity: 0;
          pointer-events: none;
          padding: 0px;
        }

        .sidebar-wrapper.open {
          width: 250px;
          min-width: 250px;
          opacity: 1;
          pointer-events: auto;
          padding: max(20px, env(safe-area-inset-top, 20px)) 24px 24px 24px;
          box-shadow: 4px 0 10px rgba(0, 0, 0, 0.1);
        }

        @media (min-width: 1024px) {
          .sidebar-wrapper {
            position: sticky;
            top: 0;
            left: 0;
            height: 100dvh; /* 🔥 PWA FIX: Changed to dvh to perfectly match the pinned app body! */
          }
          .sidebar-backdrop {
            display: none;
          }
        }

        @media (max-width: 1023px) {
          .burger-btn {
            left: max(16px, env(safe-area-inset-left, 16px));
            width: 44px;
            height: 44px;
          }
          .sidebar-header {
            height: 44px; 
            margin-left: 56px; 
          }
          .sidebar-wrapper {
            position: fixed;
            top: 0;
            left: 0;
          }
          .sidebar-wrapper.open {
             padding: max(20px, env(safe-area-inset-top, 20px)) 16px 16px 16px;
          }
          .sidebar-backdrop.open {
            opacity: 1;
            pointer-events: auto;
          }
        }
      `}</style>
    </>
  )
}