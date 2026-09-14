'use client'
import React, { createContext, useContext, useState, ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info';
interface ToastContextType {
  showToast: (type: ToastType, title: string, msg: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ show: boolean; type: ToastType; title: string; msg: string } | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null); // 🔥 NEW: Track active timer

  // 🔥 CLOSURE FIX: Stabilize function memory and prevent premature toast dismissal
  const showToast = React.useCallback((type: ToastType, title: string, msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    
    setToast({ show: true, type, title, msg });
    
    timerRef.current = setTimeout(() => setToast(null), 4000); 
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div style={{
          position: 'fixed', 
          top: 'max(20px, env(safe-area-inset-top, 20px))', /* 🔥 PWA FIX: Safely avoids the iOS Notch/Dynamic Island */
          left: '50%', transform: 'translateX(-50%)', zIndex: 999999,
          background: '#fff', borderLeft: `6px solid ${toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6'}`,
          padding: '16px 24px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '300px',
          animation: 'slideDown 0.3s ease-out'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#0f172a' }}>
            {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'} {toast.title}
          </div>
          <div style={{ color: '#64748b', fontSize: '13px' }}>{toast.msg}</div>
        </div>
      )}
      <style jsx global>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
};