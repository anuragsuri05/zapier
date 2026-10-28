// Controlled editor for a single table field value (used in the record modal and the public interface "Add" form).
import { Star } from 'lucide-react';
import { Input, Textarea, Select, Checkbox } from '../../components/ui.jsx';
import { optionsOf, toDateInput } from './fieldTypes.js';
import './tables.css';

export function StarRating({ value, onChange, size = 16, readOnly }) {
  const n = Number(value) || 0;
  return (
    <span className="tv-stars" role={readOnly ? 'img' : 'radiogroup'} aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" disabled={readOnly} className={i <= n ? 'on' : ''} aria-label={`${i} star${i > 1 ? 's' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange?.(i === n ? null : i); }}>
          <Star size={size} />
        </button>
      ))}
    </span>
  );
}

export function MultiSelectChips({ options, value, onChange }) {
  const v = Array.isArray(value) ? value : [];
  if (!options.length) return <Input value={v.join(', ')} placeholder="Comma-separated values" onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />;
  return (
    <div className="row wrap gap-4">
      {options.map((o) => {
        const on = v.includes(o);
        return (
          <button key={o} type="button" className={`tv-chip tv-chip-toggle ${on ? 'on' : ''}`} aria-pressed={on}
            onClick={() => onChange(on ? v.filter((x) => x !== o) : [...v, o])}>{o}</button>
        );
      })}
    </div>
  );
}

export default function FieldInput({ field, value, onChange, autoFocus, invalid }) {
  const common = { autoFocus, invalid };
  switch (field.type) {
    case 'long_text': return <Textarea rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'number': return <Input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...common} />;
    case 'currency': return (
      <div className="tv-currency"><span>$</span><Input type="number" step="0.01" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...common} /></div>
    );
    case 'email': return <Input type="email" value={value ?? ''} placeholder="name@example.com" onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'url': return <Input type="url" value={value ?? ''} placeholder="https://" onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'phone': return <Input type="tel" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'checkbox': return <Checkbox checked={Boolean(value)} onChange={onChange} label={value ? 'Yes' : 'No'} />;
    case 'date': return <Input type="date" value={toDateInput(value)} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'select': return <Select value={value ?? ''} placeholder="—" options={optionsOf(field)} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'multi_select': return <MultiSelectChips options={optionsOf(field)} value={value} onChange={onChange} />;
    case 'rating': return <StarRating value={value} onChange={onChange} size={20} />;
    case 'json': return (
      <Textarea rows={4} className="mono" value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)}
        onChange={(e) => onChange(e.target.value)} {...common} />
    );
    default: return <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
  }
}
