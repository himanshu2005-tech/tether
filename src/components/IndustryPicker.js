import React from 'react';
import { Check } from 'lucide-react';
import { INDUSTRIES } from '../constants/products';

// Multi-select of industries. `value` is an array of industry ids.
export default function IndustryPicker({ value = [], onChange }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);

  return (
    <div className="industry-grid" role="group" aria-label="Industries">
      {INDUSTRIES.map(ind => {
        const on = value.includes(ind.id);
        return (
          <button key={ind.id} type="button" className={`industry-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(ind.id)}>
            <span className="industry-check">{on && <Check size={12} strokeWidth={3} />}</span>
            <span className="industry-text">
              <span className="industry-name">{ind.name}</span>
              <span className="industry-examples">{ind.products.slice(0, 3).join(', ')}…</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
