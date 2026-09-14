import React, { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  icon?: string;
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = '400px', icon }: ModalProps) {
  // 🔥 PWA FIX: Removed the document.body.style.overflow manipulation! 
  // Our globals.css already permanently locks the body to 'hidden' to prevent Safari bounce. 
  // Setting it to 'unset' here when a modal closes was breaking the app's fixed layout.

  if (!isOpen) return null;

  return (
    <div 
      style={{ 
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', 
        backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', 
        justifyContent: 'center', alignItems: 'flex-start', 
        paddingTop: '10vh', paddingLeft: '20px', paddingRight: '20px', boxSizing: 'border-box' 
      }} 
      onMouseDown={onClose}
    >
      <div 
        style={{ 
          backgroundColor: '#ffffff', width: '100%', maxWidth: maxWidth, 
          borderRadius: '16px', padding: '24px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          maxHeight: '85vh', overflowY: 'auto'
        }} 
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
          <h3 style={{ margin: 0, color: '#1e293b', fontSize: '18px', fontWeight: 'bold' }}>
            {icon && <span style={{ marginRight: '8px' }}>{icon}</span>}
            {title}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold' }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}