'use client'
import React, { useState, useEffect } from 'react'

export function CurrencyInput({ value, onChange, placeholder, style, autoFocus, className, onFocus, onEnter, onBlurCustom }: any) {
  const [inputValue, setInputValue] = useState('');

  // 🔥 CLOSURE FIX: Use functional state update to prevent stale reads
  useEffect(() => {
    if (value === '' || value === undefined || value === 0) {
      setInputValue('');
    } else {
      setInputValue(prev => {
        const parsed = parseFloat(prev.replace(/,/g, ''));
        if (parsed !== Number(value)) {
          return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
        }
        return prev;
      });
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');

    let formatted = parts[0] ? new Intl.NumberFormat('en-US').format(parseInt(parts[0], 10)) : '';
    if (parts.length > 1) formatted += '.' + parts[1].substring(0, 2);
    if (raw === '') formatted = '';

    setInputValue(formatted);
    const num = parseFloat(raw);
    onChange(isNaN(num) ? '' : num);
  };

  return (
    <input 
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={inputValue}
      onChange={handleChange}
      onFocus={onFocus}
      autoFocus={autoFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
          if (onEnter) onEnter();
        }
      }}
      onBlur={() => {
        if (onBlurCustom) onBlurCustom();
        // 🔥 UX FIX: Removed window.scrollTo(0, 0) to prevent the screen from violently jumping to the top!
      }}
      style={{ ...style, color: '#334155' }}
      className={className || "mobile-input-field no-spinners"}
    />
  )
}

export function CartInput({ value, onChange, isQty, fontSize = '14px', onFocus }: any) {
  const [inputValue, setInputValue] = useState('');

  // 🔥 CLOSURE FIX: Use functional state update to prevent stale reads
  useEffect(() => {
    if (value === '' || value === undefined) {
      setInputValue('');
    } else {
      setInputValue(prev => {
        const parsed = parseFloat(prev.replace(/,/g, ''));
        if (parsed !== Number(value)) {
          return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
        }
        return prev;
      });
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
    
    let formatted = parts[0] ? new Intl.NumberFormat('en-US').format(parseInt(parts[0], 10)) : '';
    if (parts.length > 1) formatted += '.' + parts[1].substring(0, 2);
    if (raw === '') formatted = '';

    setInputValue(formatted);
    const num = parseFloat(raw);
    onChange(isNaN(num) ? '' : num);
  };

  return (
    <input 
      type="text"
      inputMode="decimal"
      value={inputValue}
      onChange={handleChange}
      onFocus={onFocus}
      style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: fontSize, color: '#334155', backgroundColor: '#ffffff', outline: 'none', textAlign: 'center' }}
      className="mobile-input-field"
    />
  )
}