// Field type metadata, starter templates, formatting and CSV helpers shared by the Tables pages
// (and reused by the Interfaces table block).
import {
  Type, AlignLeft, Hash, Mail, Link2, Phone, SquareCheck, Calendar, List, ListChecks, DollarSign, Star, Braces, Sparkles,
} from 'lucide-react';

export const FIELD_TYPES = [
  { value: 'text', label: 'Text', icon: Type },
  { value: 'long_text', label: 'Long text', icon: AlignLeft },
  { value: 'number', label: 'Number', icon: Hash },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'url', label: 'URL', icon: Link2 },
  { value: 'phone', label: 'Phone', icon: Phone },
  { value: 'checkbox', label: 'Checkbox', icon: SquareCheck },
  { value: 'date', label: 'Date', icon: Calendar },
  { value: 'select', label: 'Single select', icon: List },
  { value: 'multi_select', label: 'Multi select', icon: ListChecks },
  { value: 'currency', label: 'Currency', icon: DollarSign },
  { value: 'rating', label: 'Rating', icon: Star },
  { value: 'json', label: 'JSON', icon: Braces },
  { value: 'ai', label: 'AI field', icon: Sparkles },
];
export const fieldTypeMeta = (type) => FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];

export const TABLE_TEMPLATES = [
  { key: 'blank', name: 'Blank', description: 'Start with a Name and Notes column.', fields: [{ name: 'Name', type: 'text' }, { name: 'Notes', type: 'long_text' }] },
  { key: 'crm', name: 'Leads CRM', description: 'Track leads, status and deal size.', fields: [
    { name: 'Name', type: 'text' }, { name: 'Email', type: 'email' }, { name: 'Company', type: 'text' }, { name: 'Phone', type: 'phone' },
    { name: 'Status', type: 'select', options: ['New', 'Contacted', 'Qualified', 'Won', 'Lost'] }, { name: 'Deal size', type: 'currency' }, { name: 'Notes', type: 'long_text' },
  ] },
  { key: 'tasks', name: 'Tasks', description: 'A simple task tracker with priority and due dates.', fields: [
    { name: 'Task', type: 'text' }, { name: 'Status', type: 'select', options: ['To do', 'In progress', 'Done'] },
    { name: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] }, { name: 'Due date', type: 'date' }, { name: 'Assignee', type: 'text' }, { name: 'Done', type: 'checkbox' },
  ] },
  { key: 'inventory', name: 'Inventory', description: 'Products, stock levels and pricing.', fields: [
    { name: 'Item', type: 'text' }, { name: 'SKU', type: 'text' }, { name: 'Category', type: 'select', options: ['Hardware', 'Software', 'Accessories', 'Other'] },
    { name: 'Quantity', type: 'number' }, { name: 'Price', type: 'currency' }, { name: 'In stock', type: 'checkbox' }, { name: 'Supplier rating', type: 'rating' },
  ] },
];

const currencyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export function fmtCurrency(v) {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '';
  return currencyFmt.format(Number(v));
}
export function fmtDateValue(v) {
  if (!v) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
/** Plain-text rendering of a cell value. */
export function formatValue(field, v) {
  if (v === null || v === undefined || v === '') return '';
  switch (field?.type) {
    case 'currency': return fmtCurrency(v);
    case 'checkbox': return v ? 'Yes' : 'No';
    case 'date': return fmtDateValue(v);
    case 'multi_select': return Array.isArray(v) ? v.join(', ') : String(v);
    case 'rating': return '★'.repeat(Math.max(0, Math.min(5, Number(v) || 0)));
    case 'json': return typeof v === 'string' ? v : JSON.stringify(v);
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}
/** Normalise date strings to yyyy-mm-dd for <input type="date">. */
export function toDateInput(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return String(v).slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
export function optionsOf(field) {
  const o = field?.options;
  if (Array.isArray(o)) return o.map((x) => (typeof x === 'string' ? x : x?.label ?? x?.value)).filter(Boolean);
  if (typeof o === 'string') return o.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

// ---------------------------------------------------------------- CSV
export function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
export function toCSV(rows) {
  const esc = (v) => { const x = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
export function downloadText(text, filename, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsText(file);
  });
}
