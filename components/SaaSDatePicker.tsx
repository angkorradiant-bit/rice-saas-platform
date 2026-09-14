'use client' // 🔥 NEXT.JS FIX: Required for third-party interactive components

import React from 'react';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";

interface Props {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  showTimeSelect?: boolean;
}

export default function SaaSDatePicker({ selected, onChange, showTimeSelect = false }: Props) {
  return (
    <DatePicker
      selected={selected}
      onChange={onChange}
      showTimeSelect={showTimeSelect}
      dateFormat={showTimeSelect ? "dd/MM/yyyy h:mm aa" : "dd/MM/yyyy"}
      className="saas-input"
      wrapperClassName="w-full"
      placeholderText="Select date..."
      // 🔥 PWA FIX: Prevents the native iOS keyboard from popping up and breaking the fixed screen layout!
      onFocus={(e) => e.target.blur()}
    />
  );
}