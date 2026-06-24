import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createRequirement, updateRequirement, getCustomers, getEquipmentTypes } from '../../api/requirements';
import { createCustomer } from '../../api/customers';
import { getEquipmentUnitsWithProcurement } from '../../api/equipment';
import { useDraft } from '../../hooks/useDraft';
import {
  ArrowLeft, Loader2, Plus, Trash2, Package,
  Search, X, ChevronDown, ChevronLeft, ChevronRight, CheckCircle,
  Link, LayoutList, AlertTriangle, RefreshCw, Lock, Truck, Wrench, Ban, Calendar,
  Building2,
} from 'lucide-react';
import StatusBadge from '../common/StatusBadge';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const PRIORITIES = [
  { key: 'Low',    color: 'bg-gray-400' },
  { key: 'Normal', color: 'bg-blue-500' },
  { key: 'High',   color: 'bg-orange-500' },
  { key: 'Urgent', color: 'bg-red-500' },
];
const INDUSTRIES  = ['Oil & Gas','Engineering','Construction','Logistics','Manufacturing','Government','Other'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS    = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// item_mode is UI-only and stripped before DB insert.
// Default is now 'fleet' — Fleet Unit is the most common path and should be
// active by default when a new item row is added.
const EMPTY_ITEM = {
  item_mode:         'fleet',  // 'fleet' | 'type'
  equipment_id:      '',
  equipment_type_id: '',
  description:       '',
  quantity:          1,
  capacity:          '',
  notes:             '',
};

const ITEM_MODES = [
  { key: 'fleet', icon: Link,       label: 'Fleet Unit',     hint: 'Select a specific unit already in your fleet' },
  { key: 'type',  icon: LayoutList, label: 'Equipment Type', hint: 'Specify the type & capacity needed — system flags it automatically if unavailable' },
];

// ─── Date helpers (defensive — never throw on bad input) ────────────────────

function parseISO(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function toISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function formatDisplay(iso) {
  const dt = parseISO(iso);
  if (!dt) return '';
  try { return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
function startOfDay(dt) { const d = new Date(dt); d.setHours(0, 0, 0, 0); return d; }
function isSameDay(a, b) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─── THE CORE AVAILABILITY RULE ENGINE ───────────────────────────────────────
// Single source of truth used everywhere: fleet selector rows, type-level
// stats, the detail card, and final submit-time re-validation.
//
//   Maintenance → ALWAYS blocked. No date ever overrides this — maintenance
//                 delays (parts unavailable, etc.) make any "expected" date
//                 unreliable, so we never trust one here.
//   Retired     → ALWAYS blocked. Permanently removed from service.
//   Locked      → blocked UNLESS the requirement's End Date is BEFORE the
//                 unit's expected_available_date (the date the new lock's
//                 rental period begins). Until that date the unit is simply
//                 sitting idle in the fleet and can serve a shorter request.
//   Dispatched  → blocked UNLESS the requirement's Start Date is AFTER the
//                 unit's expected_available_date (the expected return date).
//   Available /
//   Reserved    → allowed.
//
// Returns { allowed, severity: 'block'|'warn'|null, reason }

function checkUnitAvailability(unit, reqStartISO, reqEndISO) {
  if (!unit) return { allowed: false, severity: 'block', reason: 'Unit not found.' };

  const isRetired = unit.status === 'Retired' || unit.is_retired === true;
  if (isRetired) {
    return { allowed: false, severity: 'block', reason: 'Retired — permanently removed from the fleet.' };
  }

  if (unit.status === 'Maintenance') {
    return { allowed: false, severity: 'block', reason: 'Under maintenance — not selectable. Maintenance delays mean no date can be trusted here.' };
  }

  if (unit.status === 'Locked') {
    const lockFrom = parseISO(unit.expected_available_date);
    if (!lockFrom) {
      return { allowed: false, severity: 'block', reason: 'Locked by an approved quotation, but no lock-start date is recorded. Contact Operations.' };
    }
    const reqEnd = parseISO(reqEndISO);
    if (!reqEnd) {
      return { allowed: false, severity: 'warn', reason: `Locked from ${formatDisplay(unit.expected_available_date)} — set this requirement's End Date to check if it's usable before then.` };
    }
    if (reqEnd < lockFrom) {
      return { allowed: true, severity: null, reason: `Free until ${formatDisplay(unit.expected_available_date)}, then locked by another approved quotation.` };
    }
    return { allowed: false, severity: 'block', reason: `Locked from ${formatDisplay(unit.expected_available_date)} by an approved quotation — your dates overlap.` };
  }

  if (unit.status === 'Dispatched') {
    const returnDate = parseISO(unit.expected_available_date);
    if (!returnDate) {
      return { allowed: false, severity: 'block', reason: 'Currently dispatched, but no expected return date is recorded. Contact Operations.' };
    }
    const reqStart = parseISO(reqStartISO);
    if (!reqStart) {
      return { allowed: false, severity: 'warn', reason: `Dispatched, expected back ${formatDisplay(unit.expected_available_date)} — set this requirement's Start Date to check availability.` };
    }
    if (reqStart > returnDate) {
      return { allowed: true, severity: null, reason: `Currently dispatched — free again after ${formatDisplay(unit.expected_available_date)}.` };
    }
    return { allowed: false, severity: 'block', reason: `Dispatched, expected back ${formatDisplay(unit.expected_available_date)} — your requirement starts too soon.` };
  }

  if (unit.status === 'Reserved') {
    return { allowed: true, severity: null, reason: 'Reserved — confirm coordination with Operations before relying on it.' };
  }

  return { allowed: true, severity: null, reason: null }; // Available
}

function statusIcon(status) {
  if (status === 'Maintenance') return Wrench;
  if (status === 'Retired')     return Ban;
  if (status === 'Locked')      return Lock;
  if (status === 'Dispatched')  return Truck;
  return CheckCircle;
}

// ─── Capacity + date-aware type-level availability ───────────────────────────

function getTypeAvailability(typeId, capacityText, quantityNeeded, equipment, reqStart, reqEnd) {
  if (!typeId) return null;
  const norm    = (s) => (s ?? '').toString().trim().toLowerCase();
  const wantCap = norm(capacityText);

  const matches = (equipment ?? []).filter(e => {
    const eType = e.type_id ?? e.equipment_types?.type_id;
    if (eType !== typeId) return false;
    if (!wantCap) return true;
    return norm(e.capacity) === wantCap;
  });

  const total     = matches.length;
  const available = matches.filter(e => checkUnitAvailability(e, reqStart, reqEnd).allowed).length;
  const qty       = Math.max(1, Number(quantityNeeded) || 1);

  let status;
  if (total === 0)          status = 'unavailable';
  else if (available === 0) status = 'unavailable';
  else if (available < qty) status = 'partial';
  else                       status = 'available';

  return { total, available, qty, status, capacitySpecified: !!wantCap };
}

// ─── Sliding segmented control ───────────────────────────────────────────────

function ModeSwitcher({ mode, onChange }) {
  const activeIdx = ITEM_MODES.findIndex(m => m.key === mode);
  return (
    <div className="relative flex rounded-lg border border-gray-200 bg-white overflow-hidden text-xs h-9 select-none">
      <div
        className="absolute top-0 bottom-0 bg-gradient-to-r from-primary-500 to-primary-600 rounded-md transition-all duration-300 ease-out shadow-sm"
        style={{ width: `${100 / ITEM_MODES.length}%`, left: `${activeIdx * (100 / ITEM_MODES.length)}%` }}
      />
      {ITEM_MODES.map(({ key, icon: Icon, label }) => (
        <button
          key={key} type="button" onClick={() => onChange(key)}
          className={clsx(
            'relative z-10 flex-1 flex items-center justify-center gap-1.5 transition-colors duration-300',
            mode === key ? 'text-white font-medium' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          <Icon size={12} className="transition-transform duration-300" style={{ transform: mode === key ? 'scale(1.1)' : 'scale(1)' }}/>
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{label.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Custom themed Date Picker — div-based trigger (no nested buttons) ─────

function DatePicker({ value, onChange, min, placeholder = 'Select date' }) {
  const [open, setOpen] = useState(false);
  const ref              = useRef(null);
  const selectedDate     = parseISO(value);
  const minDate          = parseISO(min);
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());

  useEffect(() => { if (open) setViewDate(selectedDate || new Date()); }, [open]); // eslint-disable-line

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const changeMonth = (delta) => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  let year = viewDate.getFullYear();
  let month = viewDate.getMonth();
  if (Number.isNaN(year) || Number.isNaN(month)) { year = new Date().getFullYear(); month = new Date().getMonth(); }

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const today        = startOfDay(new Date());

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const handlePick = (day) => {
    try {
      const dt = new Date(year, month, day);
      if (minDate && startOfDay(dt) < startOfDay(minDate)) return;
      onChange(toISO(dt));
      setOpen(false);
    } catch { /* ignore malformed click */ }
  };

  return (
    <div className="relative" ref={ref}>
      {/* NOTE: div (not <button>) — avoids nested-button HTML violation
          since this trigger contains its own clear <button> inside. */}
      <div
        role="button" tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
        className={clsx(
          'input w-full flex items-center gap-2 text-left text-sm cursor-pointer select-none transition-all duration-200',
          open && 'ring-2 ring-primary-300 border-primary-300'
        )}
      >
        <Calendar size={14} className="text-primary-400 shrink-0"/>
        <span className={value ? 'text-gray-800' : 'text-gray-400'}>{value ? formatDisplay(value) : placeholder}</span>
        {value && (
          <button type="button" onClick={e => { e.stopPropagation(); onChange(''); }}
            className="ml-auto text-gray-300 hover:text-gray-500 transition-all hover:scale-110 active:scale-95 shrink-0">
            <X size={12}/>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-2xl shadow-2xl p-3 w-72 max-w-[90vw]" style={{ animation: 'slideDown 0.18s ease' }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <button type="button" onClick={() => changeMonth(-1)} className="p-1.5 rounded-lg hover:bg-primary-50 text-gray-500 transition-all hover:scale-110 active:scale-95"><ChevronLeft size={15}/></button>
            <p key={`${year}-${month}`} className="text-sm font-semibold text-gray-700" style={{ animation: 'fadeSlideIn 0.2s ease' }}>{MONTH_NAMES[month]} {year}</p>
            <button type="button" onClick={() => changeMonth(1)} className="p-1.5 rounded-lg hover:bg-primary-50 text-gray-500 transition-all hover:scale-110 active:scale-95"><ChevronRight size={15}/></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map(w => <div key={w} className="text-center text-xs text-gray-400 font-medium py-1">{w}</div>)}
          </div>
          <div key={`grid-${year}-${month}`} className="grid grid-cols-7 gap-1" style={{ animation: 'fadeSlideIn 0.18s ease' }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i}/>;
              const dt         = new Date(year, month, day);
              const disabled   = minDate ? startOfDay(dt) < startOfDay(minDate) : false;
              const isToday    = isSameDay(dt, today);
              const isSelected = selectedDate && isSameDay(dt, selectedDate);
              return (
                <button key={i} type="button" disabled={disabled} onClick={() => handlePick(day)}
                  style={isSelected ? { animation: 'popIn 0.2s ease' } : undefined}
                  className={clsx(
                    'h-8 w-8 mx-auto rounded-full text-xs flex items-center justify-center transition-all duration-150',
                    disabled && 'text-gray-300 cursor-not-allowed',
                    !disabled && !isSelected && 'hover:bg-primary-50 hover:scale-110 text-gray-700',
                    isToday && !isSelected && 'ring-1 ring-primary-300 font-semibold text-primary-600',
                    isSelected && 'bg-gradient-to-br from-primary-500 to-primary-600 text-white font-semibold shadow-md scale-105'
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => { onChange(toISO(today)); setOpen(false); }} className="text-xs text-primary-500 hover:underline transition-colors">Today</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Themed Customer Picker — search + inline "create new" ─────────────────

function CustomerPicker({ value, customers, onChange, onRequestCreate }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref                 = useRef(null);

  const selected = customers.find(c => c.customer_id === value);
  const filtered = customers.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.company_name?.toLowerCase().includes(s) ||
      c.contact_person?.toLowerCase().includes(s) ||
      c.customer_id?.toLowerCase().includes(s)
    );
  });

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div
        role="button" tabIndex={0}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); setSearch(''); } }}
        className={clsx(
          'input w-full flex items-center justify-between text-left text-sm cursor-pointer select-none transition-all duration-200',
          open && 'ring-2 ring-primary-300 border-primary-300'
        )}
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Building2 size={14} className="text-primary-500 shrink-0"/>
            <span className="text-gray-800 font-medium truncate">{selected.company_name}</span>
            {selected.contact_person && <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">— {selected.contact_person}</span>}
          </div>
        ) : (
          <span className="text-gray-400 flex items-center gap-2"><Search size={13}/> Search customer…</span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <button type="button" onClick={e => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500 transition-all hover:scale-110 active:scale-95"><X size={13}/></button>
          )}
          <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200', open && 'rotate-180')}/>
        </div>
      </div>

      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" style={{ animation: 'slideDown 0.15s ease' }}>
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoFocus className="input pl-7 text-xs" placeholder="Search customers…"
                value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()}/>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No customers found</p>
            ) : filtered.map((c, i) => (
              <button key={c.customer_id} type="button"
                onClick={() => { onChange(c.customer_id); setOpen(false); setSearch(''); }}
                style={{ animation: `fadeSlideIn 0.15s ease ${Math.min(i, 8) * 20}ms both` }}
                className={clsx(
                  'w-full flex items-start gap-3 px-4 py-2.5 text-left border-l-2 border-transparent hover:border-l-primary-400 hover:bg-gray-50 transition-all',
                  value === c.customer_id && 'bg-primary-50 border-l-primary-500'
                )}
              >
                <Building2 size={15} className="text-gray-400 mt-0.5 shrink-0"/>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.company_name}</p>
                  <p className="text-xs text-gray-400 truncate">{c.contact_person}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-gray-100">
            <button type="button"
              onClick={() => { setOpen(false); onRequestCreate(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
              <Plus size={14}/> Create new customer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Themed Priority Select ───────────────────────────────────────────────────

function PrioritySelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = PRIORITIES.find(p => p.key === value) ?? PRIORITIES[1];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div
        role="button" tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
        className={clsx('input w-full flex items-center justify-between text-left text-sm cursor-pointer select-none transition-all duration-200', open && 'ring-2 ring-primary-300 border-primary-300')}
      >
        <span className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full shrink-0', selected.color)}/>
          {selected.key}
        </span>
        <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200', open && 'rotate-180')}/>
      </div>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" style={{ animation: 'slideDown 0.15s ease' }}>
          {PRIORITIES.map((p, i) => (
            <button key={p.key} type="button" onClick={() => { onChange(p.key); setOpen(false); }}
              style={{ animation: `fadeSlideIn 0.12s ease ${i * 25}ms both` }}
              className={clsx(
                'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left border-l-2 border-transparent hover:border-l-primary-400 hover:bg-gray-50 transition-all',
                value === p.key && 'bg-primary-50 border-l-primary-500 font-medium'
              )}>
              <span className={clsx('w-2 h-2 rounded-full shrink-0', p.color)}/>
              {p.key}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Equipment Fleet Selector — with availability gating ────────────────────

function EquipmentSelector({ value, equipment, usedEquipmentIds = [], reqStart, reqEnd, onChange }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [shakeId, setShakeId] = useState(null);
  const ref                 = useRef(null);

  const filtered = equipment.filter(e => {
    if (e.equipment_id !== value && usedEquipmentIds.includes(e.equipment_id)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.equipment_types?.name?.toLowerCase().includes(s) ||
      e.equipment_id?.toLowerCase().includes(s) ||
      e.serial_number?.toLowerCase().includes(s) ||
      e.capacity?.toLowerCase().includes(s) ||
      e.location?.toLowerCase().includes(s) ||
      e.status?.toLowerCase().includes(s)
    );
  });

  const selected = equipment.find(e => e.equipment_id === value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleRowClick = (eq) => {
    const avail = checkUnitAvailability(eq, reqStart, reqEnd);
    if (!avail.allowed) {
      toast.error(avail.reason || 'This unit is not available.');
      setShakeId(eq.equipment_id);
      setTimeout(() => setShakeId(null), 420);
      return;
    }
    onChange(eq.equipment_id);
    setOpen(false); setSearch('');
  };

  return (
    <div ref={ref} className="relative">
      <div
        role="button" tabIndex={0}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); setSearch(''); } }}
        className={clsx(
          'input w-full text-left flex items-center justify-between text-sm cursor-pointer select-none transition-all',
          open && 'ring-2 ring-primary-300'
        )}
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-medium text-gray-800 truncate">
              {selected.equipment_types?.name} {selected.capacity}
            </span>
            <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">— {selected.equipment_id}</span>
            <StatusBadge status={selected.status}/>
          </div>
        ) : (
          <span className="text-gray-400 flex items-center gap-2"><Search size={13}/> Search equipment fleet…</span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500 transition-colors hover:scale-110 active:scale-95"><X size={13}/></button>
          )}
          <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200', open && 'rotate-180')}/>
        </div>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-40 bg-white border border-gray-200 rounded-2xl shadow-2xl mt-1 overflow-hidden" style={{ animation: 'slideDown 0.15s ease' }}>
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoFocus className="input pl-7 text-xs" placeholder="Search by type, ID, serial, capacity, location…"
                value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()}/>
              {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"><X size={12}/></button>}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50 transition-colors">
              None / clear selection
            </button>
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No fleet equipment found</p>
            ) : filtered.map((eq, i) => {
              const avail = checkUnitAvailability(eq, reqStart, reqEnd);
              const Icon  = statusIcon(eq.status);
              return (
                <button
                  key={eq.equipment_id} type="button"
                  onClick={() => handleRowClick(eq)}
                  style={{
                    animation: shakeId === eq.equipment_id ? 'shakeX 0.42s ease' : `fadeSlideIn 0.15s ease ${Math.min(i, 8) * 20}ms both`,
                  }}
                  className={clsx(
                    'w-full flex items-start justify-between px-4 py-3 text-left border-l-2 border-b border-b-gray-50 last:border-b-0 transition-all',
                    value === eq.equipment_id ? 'bg-primary-50 border-l-primary-500' : 'border-l-transparent',
                    !avail.allowed && avail.severity === 'block' && 'bg-red-50/40 hover:bg-red-50 hover:border-l-red-400',
                    !avail.allowed && avail.severity === 'warn' && 'bg-amber-50/40 hover:bg-amber-50 hover:border-l-amber-400',
                    avail.allowed && value !== eq.equipment_id && 'hover:bg-gray-50 hover:border-l-primary-300'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className={clsx('text-sm font-medium flex items-center gap-1.5', avail.allowed ? 'text-gray-800' : 'text-gray-500')}>
                      <Icon size={12} className={clsx('shrink-0',
                        avail.allowed ? 'text-green-500' : avail.severity === 'warn' ? 'text-amber-500' : 'text-red-400')}/>
                      {eq.equipment_types?.name} {eq.capacity ?? ''}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {eq.equipment_id}
                      {eq.serial_number && ` · S/N: ${eq.serial_number}`}
                      {eq.location && ` · ${eq.location}`}
                    </p>
                    {avail.reason && (
                      <p className={clsx('text-xs mt-1', avail.allowed ? 'text-green-600' : avail.severity === 'warn' ? 'text-amber-600' : 'text-red-500')}>
                        {avail.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                    <StatusBadge status={eq.status}/>
                    {eq.daily_rate_kwd && <span className="text-xs text-gray-400">KWD {Number(eq.daily_rate_kwd).toLocaleString()}/day</span>}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="p-2 border-t border-gray-100 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Equipment Type Selector ─────────────────────────────────────────────────

function EquipmentTypeSelector({ value, equipmentTypes, equipment, reqStart, reqEnd, onChange }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref                 = useRef(null);

  const fleetStats = useMemo(() => {
    const map = {};
    (equipment ?? []).forEach(e => {
      const tId = e.type_id ?? e.equipment_types?.type_id;
      if (!tId) return;
      if (!map[tId]) map[tId] = { total: 0, available: 0 };
      map[tId].total++;
      if (checkUnitAvailability(e, reqStart, reqEnd).allowed) map[tId].available++;
    });
    return map;
  }, [equipment, reqStart, reqEnd]);

  const filtered = (equipmentTypes ?? []).filter(t => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      t.name?.toLowerCase().includes(s) ||
      t.category?.toLowerCase().includes(s) ||
      t.default_capacity?.toLowerCase().includes(s) ||
      t.description?.toLowerCase().includes(s)
    );
  });

  const selected = (equipmentTypes ?? []).find(t => t.type_id === value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const renderAvailBadge = (typeId) => {
    const stats = fleetStats[typeId];
    if (!stats) return <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 shrink-0">Not in fleet</span>;
    return (
      <span className={clsx('text-xs px-1.5 py-0.5 rounded-full shrink-0 transition-colors',
        stats.available > 0 ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600')}>
        {stats.available}/{stats.total} avail
      </span>
    );
  };

  return (
    <div ref={ref} className="relative">
      <div
        role="button" tabIndex={0}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); setSearch(''); } }}
        className={clsx('input w-full text-left flex items-center justify-between text-sm cursor-pointer select-none transition-all', open && 'ring-2 ring-primary-300')}
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-medium text-gray-800 truncate">{selected.name}</span>
            {selected.default_capacity && <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">— {selected.default_capacity}</span>}
            {renderAvailBadge(selected.type_id)}
          </div>
        ) : (
          <span className="text-gray-400 flex items-center gap-2"><Search size={13}/> Search equipment types…</span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500 transition-colors hover:scale-110 active:scale-95"><X size={13}/></button>
          )}
          <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200', open && 'rotate-180')}/>
        </div>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-40 bg-white border border-gray-200 rounded-2xl shadow-2xl mt-1 overflow-hidden" style={{ animation: 'slideDown 0.15s ease' }}>
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoFocus className="input pl-7 text-xs" placeholder="Search by name, category, capacity…"
                value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()}/>
              {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"><X size={12}/></button>}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50 transition-colors">
              None / clear selection
            </button>
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No equipment types found</p>
            ) : filtered.map((t, i) => (
              <button key={t.type_id} type="button"
                onClick={() => { onChange(t.type_id); setOpen(false); setSearch(''); }}
                style={{ animation: `fadeSlideIn 0.15s ease ${Math.min(i, 8) * 20}ms both` }}
                className={clsx('w-full flex items-start justify-between px-4 py-3 text-left border-l-2 border-transparent border-b border-b-gray-50 last:border-b-0 hover:bg-gray-50 hover:border-l-primary-300 transition-all', value === t.type_id && 'bg-primary-50 border-l-primary-500')}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">
                    {t.name}{t.default_capacity && <span className="text-gray-500 ml-1">— {t.default_capacity}</span>}
                  </p>
                  {t.category && <p className="text-xs text-gray-400 mt-0.5">{t.category}</p>}
                  {t.description && <p className="text-xs text-gray-300 mt-0.5 truncate">{t.description}</p>}
                </div>
                <div className="ml-3 shrink-0">{renderAvailBadge(t.type_id)}</div>
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-gray-100 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Live capacity + date-aware availability banner ──────────────────────────

function AvailabilityBanner({ typeId, capacity, quantity, equipment, reqStart, reqEnd }) {
  const info = getTypeAvailability(typeId, capacity, quantity, equipment, reqStart, reqEnd);
  if (!info) return null;

  if (info.status === 'available') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-green-50 text-green-700" style={{ animation: 'popIn 0.25s ease' }}>
        <CheckCircle size={13} className="shrink-0"/>
        <span>
          Available — {info.available} of {info.total} unit{info.total !== 1 ? 's' : ''} free for your dates
          {info.capacitySpecified ? '' : ' (across all capacities — specify capacity above for an exact count)'}
        </span>
      </div>
    );
  }
  if (info.status === 'partial') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-orange-50 text-orange-700" style={{ animation: 'popIn 0.25s ease' }}>
        <AlertTriangle size={13} className="shrink-0"/>
        <span>
          Limited — only {info.available} of {info.qty} required unit{info.qty !== 1 ? 's' : ''} free for your dates.
          The shortfall ({info.qty - info.available}) will be flagged for procurement.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-amber-100 text-amber-800 border border-amber-200" style={{ animation: 'pulseGlow 2.2s ease-in-out infinite' }}>
      <AlertTriangle size={13} className="shrink-0"/>
      <span>
        <span className="font-semibold">Marked Unavailable</span> — {info.total === 0 ? 'not currently in your fleet' : 'no units free for these dates'} for this {info.capacitySpecified ? 'type & capacity' : 'type'}.
        Operations will oversee sourcing or procurement.
      </span>
    </div>
  );
}

// ─── Fleet detail card ───────────────────────────────────────────────────────

function EquipmentDetailCard({ equipment, equipmentId, reqStart, reqEnd }) {
  const eq = (equipment ?? []).find(e => e.equipment_id === equipmentId);
  if (!eq) return null;
  const avail = checkUnitAvailability(eq, reqStart, reqEnd);
  const Icon  = statusIcon(eq.status);

  return (
    <div
      className={clsx(
        'rounded-xl border p-3 text-xs space-y-2 transition-all duration-300',
        avail.allowed ? 'bg-green-50 border-green-100' :
        avail.severity === 'warn' ? 'bg-amber-50 border-amber-150' :
        'bg-red-50 border-red-150'
      )}
      style={{ animation: 'popIn 0.25s ease' }}
    >
      <div className="flex items-center gap-2">
        <Icon size={12} className={clsx('shrink-0', avail.allowed ? 'text-green-500' : avail.severity === 'warn' ? 'text-amber-500' : 'text-red-500')}/>
        <span className="font-semibold text-gray-700">{avail.allowed ? 'Fleet unit confirmed' : 'Fleet unit — conflict detected'}</span>
        <StatusBadge status={eq.status}/>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
        <div><span className="text-gray-400">Type:</span> {eq.equipment_types?.name ?? '—'}</div>
        <div><span className="text-gray-400">Capacity:</span> {eq.capacity ?? '—'}</div>
        <div><span className="text-gray-400">ID:</span> <span className="font-mono">{eq.equipment_id}</span></div>
        <div><span className="text-gray-400">Serial:</span> {eq.serial_number ?? '—'}</div>
        <div><span className="text-gray-400">Location:</span> {eq.location ?? '—'}</div>
        <div><span className="text-gray-400">Rate:</span> KWD {Number(eq.daily_rate_kwd ?? 0).toLocaleString()}/day</div>
      </div>
      {avail.reason && (
        <div className={clsx('flex items-center gap-1.5 rounded-lg px-2 py-1.5',
          avail.allowed ? 'text-green-700 bg-green-100' : avail.severity === 'warn' ? 'text-amber-700 bg-amber-100' : 'text-red-700 bg-red-100')}
          style={!avail.allowed ? { animation: 'pulseGlow 2.2s ease-in-out infinite' } : undefined}>
          {avail.allowed ? <CheckCircle size={11} className="shrink-0"/> : <AlertTriangle size={11} className="shrink-0"/>}
          <span>{avail.reason}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Form ───────────────────────────────────────────────────────────────

export default function RequirementForm({ existing, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers,      setCustomers]      = useState([]);
  const [equipment,      setEquipment]      = useState([]);   // fleet units (all statuses)
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [dataLoading,    setDataLoading]    = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [mounted,        setMounted]        = useState(false);

  // New-customer inline create panel
  const [showNewCustomer,    setShowNewCustomer]    = useState(false);
  const [newCustomerLoading, setNewCustomerLoading] = useState(false);
  const [newCustomerForm,    setNewCustomerForm]    = useState({
    company_name: '', contact_person: '', phone: '', email: '', industry: '', address: '', notes: '',
  });

  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);

  const draftKey = isEdit ? `req-edit-${existing?.requirement_id}` : 'req-new';

  const INIT_FORM = {
    customer_id:         existing?.customer_id         ?? '',
    requested_by:        existing?.requested_by        ?? '',
    requirement_summary: existing?.requirement_summary ?? '',
    location:            existing?.location            ?? '',
    start_date:          existing?.start_date          ?? '',
    end_date:            existing?.end_date            ?? '',
    priority:            existing?.priority            ?? 'Normal',
    notes:               existing?.notes               ?? '',
  };

  const INIT_ITEMS = existing?.requirement_items?.length > 0
    ? existing.requirement_items.map(i => ({
        item_mode:         i.equipment_id ? 'fleet' : 'type',
        equipment_id:      i.equipment_id      ?? '',
        equipment_type_id: i.equipment_type_id ?? '',
        description:       i.description       ?? '',
        quantity:          i.quantity           ?? 1,
        capacity:          i.capacity           ?? '',
        notes:             i.notes              ?? '',
      }))
    : [];

  const [form,  setForm,  clearDraft,      hasDraft]      = useDraft(draftKey, INIT_FORM);
  const [items, setItems, clearItemsDraft]                = useDraft(`${draftKey}-items`, INIT_ITEMS);

  const fetchFleetData = useCallback(async () => {
    const [e, t] = await Promise.all([getEquipmentUnitsWithProcurement(), getEquipmentTypes()]);
    setEquipment(e ?? []);
    setEquipmentTypes(t ?? []);
  }, []);

  const reloadCustomers = useCallback(async () => {
    const c = await getCustomers();
    setCustomers(c ?? []);
    return c ?? [];
  }, []);

  useEffect(() => {
    setDataLoading(true);
    Promise.all([reloadCustomers(), fetchFleetData()])
      .catch(() => toast.error('Failed to load form data'))
      .finally(() => setDataLoading(false));
  }, [fetchFleetData, reloadCustomers]);

  const handleRefreshFleet = async () => {
    setRefreshing(true);
    try {
      await fetchFleetData();
      toast.success('Fleet status refreshed');
    } catch { toast.error('Failed to refresh fleet status'); }
    finally { setRefreshing(false); }
  };

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const addItem    = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(i => i.filter((_, j) => j !== idx));

  const setItem = (idx, field, val) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;

      if (field === 'item_mode') {
        return { ...EMPTY_ITEM, item_mode: val, quantity: item.quantity, notes: item.notes, description: '' };
      }

      const updated = { ...item, [field]: val };

      if (field === 'equipment_id') {
        if (val) {
          const eq = (equipment ?? []).find(e => e.equipment_id === val);
          if (eq) {
            updated.equipment_type_id = eq.type_id ?? '';
            updated.description       = `${eq.equipment_types?.name ?? ''} ${eq.capacity ?? ''}`.trim();
            updated.capacity          = eq.capacity ?? '';
          }
        } else {
          updated.equipment_type_id = '';
          updated.capacity          = '';
        }
      }

      if (field === 'equipment_type_id') {
        if (val) {
          const t = (equipmentTypes ?? []).find(t => t.type_id === val);
          if (t) { updated.description = t.name ?? ''; updated.capacity = t.default_capacity ?? ''; }
        } else {
          updated.description = ''; updated.capacity = '';
        }
      }

      return updated;
    }));
  };

  // Live re-check: if requirement dates change such that a previously-fine
  // fleet selection becomes unsafe, surface it immediately rather than only
  // at submit time.
  const liveConflicts = useMemo(() => {
    return items
      .map((item, idx) => {
        if (item.item_mode !== 'fleet' || !item.equipment_id) return null;
        const eq = equipment.find(e => e.equipment_id === item.equipment_id);
        if (!eq) return null;
        const avail = checkUnitAvailability(eq, form.start_date, form.end_date);
        return avail.allowed ? null : { idx, reason: avail.reason, severity: avail.severity };
      })
      .filter(Boolean);
  }, [items, equipment, form.start_date, form.end_date]);

  // ── Inline new-customer creation ────────────────────────────────────────────
  const handleCreateCustomer = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!newCustomerForm.company_name.trim())   return toast.error('Enter company name');
    if (!newCustomerForm.contact_person.trim())  return toast.error('Enter contact person');
    setNewCustomerLoading(true);
    try {
      const newCust = await createCustomer(newCustomerForm);
      await reloadCustomers();
      set('customer_id', newCust.customer_id);
      setShowNewCustomer(false);
      setNewCustomerForm({ company_name: '', contact_person: '', phone: '', email: '', industry: '', address: '', notes: '' });
      toast.success('Customer created and selected');
    } catch (err) {
      toast.error(err.message || 'Failed to create customer');
    } finally {
      setNewCustomerLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id)                return toast.error('Please select a customer');
    if (!form.requested_by.trim())        return toast.error('Please enter the contact name');
    if (!form.requirement_summary.trim()) return toast.error('Please describe the requirement');
    if (form.start_date && form.end_date && form.end_date < form.start_date)
      return toast.error('End date cannot be before start date');

    const badItem = items.findIndex(i => !i.description?.trim());
    if (badItem !== -1) return toast.error(`Item ${badItem + 1} is missing a description`);

    setLoading(true);
    try {
      // Re-fetch fresh fleet data right before the final safety check —
      // status may have changed since the page loaded (e.g. another sales
      // rep just dispatched the unit a minute ago).
      await fetchFleetData();

      const conflicts = [];
      items.forEach((item, idx) => {
        if (item.item_mode !== 'fleet' || !item.equipment_id) return;
        const eq = equipment.find(e => e.equipment_id === item.equipment_id) ?? null;
        const avail = checkUnitAvailability(eq, form.start_date, form.end_date);
        if (!avail.allowed) conflicts.push(`Item ${idx + 1}: ${avail.reason}`);
      });

      if (conflicts.length > 0) {
        toast.error(`Cannot save — ${conflicts.length} item${conflicts.length !== 1 ? 's' : ''} conflict with current fleet status. Fix and try again.`);
        conflicts.forEach(c => toast.error(c, { duration: 5000 }));
        setLoading(false);
        return;
      }

      const payload = { ...form, created_by: profile.user_id };
      const cleanItems = items
        .filter(i => i.description?.trim())
        .map(({ item_mode, ...i }) => ({       // eslint-disable-line no-unused-vars
          equipment_id:      i.equipment_id      || null,
          equipment_type_id: i.equipment_type_id || null,
          description:       i.description.trim(),
          quantity:          Math.max(1, Number(i.quantity) || 1),
          capacity:          i.capacity          || null,
          notes:             i.notes             || null,
        }));

      if (isEdit) {
        await updateRequirement(existing.requirement_id, form, cleanItems);
        toast.success('Requirement updated');
      } else {
        await createRequirement(payload, cleanItems);
        toast.success('Requirement created successfully');
      }
      clearDraft(); clearItemsDraft();
      onSuccess();
    } catch (err) {
      toast.error(err.message || 'Failed to save requirement');
    } finally {
      setLoading(false);
    }
  };

  if (dataLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-10 h-10 rounded-full border-4 border-primary-100 border-t-primary-500 animate-spin"/>
      <p className="text-sm text-gray-400">Loading form data…</p>
    </div>
  );

  const datesIncomplete = !form.start_date || !form.end_date;
  const hasFleetItems   = items.some(i => i.item_mode === 'fleet');

  return (
    <div className="max-w-3xl mx-auto space-y-4" style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(8px)', transition: 'opacity 0.3s ease, transform 0.3s ease' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2 transition-transform hover:scale-105 active:scale-95"><ArrowLeft size={16}/></button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Requirement' : 'New Requirement'}</h2>
          <p className="text-sm text-gray-400">{isEdit ? `Editing ${existing.requirement_id}` : 'Create a new requirement ticket'}</p>
        </div>
      </div>

      {/* Draft banner */}
      {!isEdit && hasDraft() && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-yellow-700">📝 Draft restored from your last session</p>
          <button type="button" onClick={() => { clearDraft(); clearItemsDraft(); window.location.reload(); }}
            className="text-xs text-yellow-600 hover:underline ml-4">Clear draft</button>
        </div>
      )}

      {/* Status note */}
      {!isEdit && (
        <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100">
          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/>
          <p className="text-xs text-blue-700">New requirements start with <span className="font-semibold">Pending Review</span> status and progress automatically</p>
        </div>
      )}

      {/* Live conflict banner */}
      {liveConflicts.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 space-y-1.5" style={{ animation: 'pulseGlow 2s ease-in-out infinite' }}>
          <p className="text-sm text-red-700 font-medium flex items-center gap-2"><AlertTriangle size={14}/> {liveConflicts.length} item{liveConflicts.length !== 1 ? 's' : ''} conflict with current dates</p>
          {liveConflicts.map(c => (
            <p key={c.idx} className="text-xs text-red-600 pl-6">Item {c.idx + 1}: {c.reason}</p>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Basic info */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">Requirement Details</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer <span className="text-red-500">*</span></label>
            <div className="flex gap-2">
              <div className="flex-1">
                <CustomerPicker
                  value={form.customer_id}
                  customers={customers}
                  onChange={val => set('customer_id', val)}
                  onRequestCreate={() => setShowNewCustomer(true)}
                />
              </div>
              <button type="button" onClick={() => setShowNewCustomer(true)}
                className="btn-secondary px-3 text-xs whitespace-nowrap flex items-center gap-1 shrink-0 transition-transform hover:scale-105 active:scale-95" title="Add new customer">
                <Plus size={12}/> New
              </button>
            </div>
          </div>

          {/* Inline new customer form */}
          {showNewCustomer && (
            <div className="border-2 border-primary-100 rounded-xl p-4 bg-primary-50/30 space-y-3" style={{ animation: 'slideDown 0.2s ease' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-primary-700 flex items-center gap-2"><Building2 size={14}/> New Customer</p>
                <button type="button" onClick={() => setShowNewCustomer(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={16}/></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'Company Name *',   key: 'company_name',   type: 'text' },
                  { label: 'Contact Person *', key: 'contact_person', type: 'text' },
                  { label: 'Phone',            key: 'phone',           type: 'text', placeholder: '+965 XXXXXXXX' },
                  { label: 'Email',            key: 'email',           type: 'email' },
                  { label: 'Address',          key: 'address',         type: 'text' },
                ].map(({ label, key, type, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input type={type} className="input text-sm" placeholder={placeholder ?? ''} value={newCustomerForm[key]}
                      onChange={e => setNewCustomerForm(f => ({ ...f, [key]: e.target.value }))}/>
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
                  <select className="input text-sm" value={newCustomerForm.industry}
                    onChange={e => setNewCustomerForm(f => ({ ...f, industry: e.target.value }))}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewCustomer(false)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
                <button type="button" onClick={handleCreateCustomer} disabled={newCustomerLoading}
                  className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 transition-transform hover:scale-105 active:scale-95">
                  {newCustomerLoading && <Loader2 size={12} className="animate-spin"/>}
                  {newCustomerLoading ? 'Creating…' : 'Create & Select'}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Requested By (Contact Name) <span className="text-red-500">*</span></label>
            <input className="input" placeholder="e.g. Hassan Shaikh" value={form.requested_by} onChange={e => set('requested_by', e.target.value)} required/>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Requirement Summary <span className="text-red-500">*</span></label>
            <textarea className="input min-h-[80px] resize-y" placeholder="Describe what the customer needs…"
              value={form.requirement_summary} onChange={e => set('requirement_summary', e.target.value)} required/>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input className="input" placeholder="e.g. Ahmadi Refinery" value={form.location} onChange={e => set('location', e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <PrioritySelect value={form.priority} onChange={v => set('priority', v)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date {hasFleetItems && <span className="text-primary-500">(needed for availability checks)</span>}
              </label>
              <DatePicker value={form.start_date} onChange={v => set('start_date', v)} placeholder="Select start date"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date {hasFleetItems && <span className="text-primary-500">(needed for availability checks)</span>}
              </label>
              <DatePicker value={form.end_date} onChange={v => set('end_date', v)} min={form.start_date} placeholder="Select end date"/>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input resize-y" rows={2} placeholder="Any additional notes…" value={form.notes} onChange={e => set('notes', e.target.value)}/>
          </div>
        </div>

        {/* Equipment items */}
        <div className="card p-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Package size={15} className="text-primary-500"/> Equipment Required
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Pick a fleet unit, or specify a type & capacity — unavailable items are flagged automatically</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleRefreshFleet} title="Refresh fleet status"
                className="btn-secondary p-2 transition-transform hover:scale-105 active:scale-95">
                <RefreshCw size={13} className={clsx(refreshing && 'animate-spin')}/>
              </button>
              <button type="button" onClick={addItem}
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 transition-transform hover:scale-105 active:scale-95">
                <Plus size={13}/> Add Item
              </button>
            </div>
          </div>

          {hasFleetItems && datesIncomplete && (
            <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-blue-50 text-blue-700 text-xs">
              <Calendar size={13} className="shrink-0"/>
              Set the requirement's Start &amp; End dates above for accurate Locked/Dispatched availability checks.
            </div>
          )}

          {items.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <Package size={28} className="opacity-30 mb-2"/>
              <p className="text-sm">No equipment items added yet</p>
              <button type="button" onClick={addItem} className="mt-2 text-xs text-primary-500 hover:underline">Add first item</button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, idx) => {
                const mode = item.item_mode ?? 'fleet';
                return (
                  <div
                    key={idx}
                    className="border border-gray-100 rounded-xl p-4 bg-gray-50/40 space-y-3 transition-all duration-200 hover:border-primary-200 hover:shadow-md"
                    style={{ animation: `fadeSlideIn 0.25s ease ${Math.min(idx, 6) * 40}ms both` }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500">Item {idx + 1}</p>
                      <button type="button" onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500 transition-all hover:scale-110 active:scale-95">
                        <Trash2 size={14}/>
                      </button>
                    </div>

                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Item type</p>
                      <ModeSwitcher mode={mode} onChange={(key) => setItem(idx, 'item_mode', key)}/>
                      <p className="text-xs text-gray-400 mt-1">{ITEM_MODES.find(m => m.key === mode)?.hint}</p>
                    </div>

                    {mode === 'fleet' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Fleet Unit <span className="text-gray-400 ml-1">(select a specific unit from your fleet)</span>
                        </label>
                        <EquipmentSelector
                          value={item.equipment_id}
                          equipment={equipment}
                          usedEquipmentIds={items.filter((_, j) => j !== idx).map(i => i.equipment_id).filter(Boolean)}
                          reqStart={form.start_date}
                          reqEnd={form.end_date}
                          onChange={val => setItem(idx, 'equipment_id', val)}
                        />
                        {item.equipment_id ? (
                          <div className="mt-2">
                            <EquipmentDetailCard equipment={equipment} equipmentId={item.equipment_id} reqStart={form.start_date} reqEnd={form.end_date}/>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-600 mt-1.5">⚠️ No fleet unit selected — switch to <strong>Equipment Type</strong> if the exact unit is unavailable.</p>
                        )}
                      </div>
                    )}

                    {mode === 'type' && (
                      <div className="space-y-2">
                        <label className="block text-xs text-gray-500 mb-1">
                          Equipment Type <span className="text-gray-400 ml-1">(Operations will assign a unit or procure)</span>
                        </label>
                        <EquipmentTypeSelector
                          value={item.equipment_type_id}
                          equipmentTypes={equipmentTypes}
                          equipment={equipment}
                          reqStart={form.start_date}
                          reqEnd={form.end_date}
                          onChange={val => setItem(idx, 'equipment_type_id', val)}
                        />
                        {item.equipment_type_id && (
                          <AvailabilityBanner
                            typeId={item.equipment_type_id}
                            capacity={item.capacity}
                            quantity={item.quantity}
                            equipment={equipment}
                            reqStart={form.start_date}
                            reqEnd={form.end_date}
                          />
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-12 sm:col-span-6">
                        <label className="block text-xs text-gray-500 mb-1">
                          Description <span className="text-red-500">*</span>
                          {(item.equipment_id || item.equipment_type_id) && <span className="text-green-600 ml-1">(auto-filled — editable)</span>}
                        </label>
                        <input className="input text-sm transition-all" placeholder={mode === 'fleet' ? 'Auto-filled when unit selected' : 'Auto-filled when type selected'}
                          value={item.description} onChange={e => setItem(idx, 'description', e.target.value)} required/>
                      </div>
                      <div className="col-span-6 sm:col-span-3">
                        <label className="block text-xs text-gray-500 mb-1">
                          Capacity / Spec {mode === 'type' && <span className="text-primary-500 ml-1">(affects availability)</span>}
                        </label>
                        <input className="input text-sm transition-all focus:ring-2 focus:ring-primary-200" placeholder="e.g. 10 Ton"
                          value={item.capacity} onChange={e => setItem(idx, 'capacity', e.target.value)}/>
                      </div>
                      <div className="col-span-6 sm:col-span-3">
                        <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                        <input type="number" min="1" className="input text-sm text-center transition-all qty-no-spin"
                          value={item.quantity} onWheel={e => e.target.blur()}
                          onChange={e => setItem(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))}/>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
                      <input className="input text-sm" placeholder="Any specific requirements, conditions, or procurement notes…"
                        value={item.notes} onChange={e => setItem(idx, 'notes', e.target.value)}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-4">
          <button type="button" onClick={onCancel} className="btn-secondary transition-transform hover:scale-105 active:scale-95">Cancel</button>
          <button type="submit" disabled={loading}
            className={clsx('btn-primary flex items-center gap-2 transition-all', loading ? 'opacity-70 cursor-not-allowed' : 'hover:scale-105 active:scale-95')}>
            {loading && <Loader2 size={15} className="animate-spin"/>}
            {loading ? 'Validating & saving…' : isEdit ? 'Update Requirement' : 'Create Requirement'}
          </button>
        </div>
      </form>

      {/* Keyframe animations + scoped number-input fix */}
      <style>{`
        .qty-no-spin::-webkit-outer-spin-button,
        .qty-no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .qty-no-spin { -moz-appearance: textfield; }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          0%   { opacity: 0; transform: scale(0.92); }
          60%  { transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.25); }
          50%      { box-shadow: 0 0 0 5px rgba(217, 119, 6, 0); }
        }
        @keyframes shakeX {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-5px); }
          40%      { transform: translateX(5px); }
          60%      { transform: translateX(-4px); }
          80%      { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
