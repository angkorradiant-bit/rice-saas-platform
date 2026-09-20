import React from 'react';

interface EmptyStateProps {
  title: string;
  message: string;
  icon?: string;
}

export default function EmptyState({ title, message, icon = '📭' }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px', textAlign: 'center', backgroundColor: '#f8fafc',
      borderRadius: '12px', border: '2px dashed #cbd5e1', margin: '20px 0',
      width: '100%', boxSizing: 'border-box' // Added these two properties
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.9 }}>{icon}</div>
      <h3 style={{ margin: '0 0 8px 0', color: '#334155', fontSize: '18px', fontWeight: 'bold' }}>
        {title}
      </h3>
      <p style={{ margin: 0, color: '#64748b', fontSize: '14px', maxWidth: '400px', lineHeight: '1.5' }}>
        {message}
      </p>
    </div>
  );
}