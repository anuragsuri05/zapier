import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';

export function SectionHead({ title, description, actions }) {
  return (
    <div className="section-head row between wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
      <div style={{ minWidth: 0 }}><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function SettingsRow({ label, description, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label"><h4>{label}</h4>{description && <p>{description}</p>}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}


export function ReadOnlyNote({ children = 'Only workspace admins and owners can change these settings.' }) {
  return <p className="small subtle">{children}</p>;
}

/** Common IANA time zones. */
export const TIMEZONES = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Halifax',
  'America/Mexico_City', 'America/Bogota', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul',
  'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Manila', 'Asia/Seoul', 'Asia/Tokyo',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu',
];

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
