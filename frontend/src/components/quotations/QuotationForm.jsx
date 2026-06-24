import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  createQuotation, updateQuotation, updateQuotationItems,
  getAvailableEquipment,
} from '../../api/quotations';
import { getRequirements, getRequirement } from '../../api/requirements';
import { getCustomers, createCustomer } from '../../api/customers';
import { useDraft } from '../../hooks/useDraft';
import RequirementSidePanel from '../requirements/RequirementSidePanel';
import {
  ArrowLeft, Plus, Trash2, Loader2, AlertTriangle,
  CheckCircle, Package, Search, X, ChevronDown, ChevronLeft, ChevronRight,
  Building2, ShoppingCart, Wrench, Calendar, Clock,
  TrendingUp, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// ─── Constants ───────────────────────────────────────────────────────────────

const EMPTY_ITEM = {
  description:       '',
  unit_rate_kwd:     '',
  equipment_id:      null,
  item_type:         'equipment',
  rental_start_date: '',
  rental_end_date:   '',
  discount_amount:   0,
  quantity:          1,
  unit:              'Days',
};

const INDUSTRIES = ['Oil & Gas','Engineering','Construction','Logistics','Manufacturing','Government','Other'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS    = ['Su','Mo','Tu','We','Th','Fr','Sa'];

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
  try {
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}
function startOfDay(dt) { const d = new Date(dt); d.setHours(0, 0, 0, 0); return d; }
function isSameDay(a, b) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Returns the inclusive number of days between two ISO date strings, or null. */
function calcDays(start, end) {
  const d1 = parseISO(start);
  const d2 = parseISO(end);
  if (!d1 || !d2 || d2 < d1) return null;
  return Math.ceil((d2 - d1) / 86_400_000) + 1; // inclusive
}

function effectiveQty(item) {
  const days = calcDays(item.rental_start_date, item.rental_end_date);
  return days ?? Math.max(1, Number(item.quantity) || 1);
}
function lineGross(item) { return effectiveQty(item) * Number(item.unit_rate_kwd || 0); }
function lineNet(item)   { return Math.max(0, lineGross(item) - Number(item.discount_amount || 0)); }
function fmt(n) { return (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }

/** Prevents mouse-wheel scroll from changing a focused number input's value. */
const blurOnWheel = (e) => e.target.blur();

// ─── Count-up animation hook — smooth number transitions on totals ──────────

function useCountUp(value, duration = 450) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [display, setDisplay] = useState(numeric);
  const fromRef = useRef(numeric);
  const rafRef  = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to   = numeric;
    if (from === to) return;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(from + (to - from) * eased);
      if (t < 1) { rafRef.current = requestAnimationFrame(step); }
      else { fromRef.current = to; setDisplay(to); }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [numeric, duration]);

  return display;
}

// ─── Custom themed Date Picker — replaces native <input type="date"> ───────

function DatePicker({ value, onChange, min, placeholder = 'Select date' }) {
  const [open, setOpen]   = useState(false);
  const ref                = useRef(null);
  const selectedDate       = parseISO(value);
  const minDate            = parseISO(min);
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

  const firstWeekday  = new Date(year, month, 1).getDay();
  const daysInMonth   = new Date(year, month + 1, 0).getDate();
  const today         = startOfDay(new Date());

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
        <span className={value ? 'text-gray-800' : 'text-gray-400'}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        {value && (
          <button type="button" onClick={e => { e.stopPropagation(); onChange(''); }}
            className="ml-auto text-gray-300 hover:text-gray-500 transition-all hover:scale-110 active:scale-95 shrink-0">
            <X size={12}/>
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-[200] mt-1 bg-white border border-gray-200 rounded-2xl shadow-2xl p-3 w-72 max-w-[90vw]"
          style={{ animation: 'slideDown 0.18s ease' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2 px-1">
            <button type="button" onClick={() => changeMonth(-1)}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-gray-500 transition-all hover:scale-110 active:scale-95">
              <ChevronLeft size={15}/>
            </button>
            <p key={`${year}-${month}`} className="text-sm font-semibold text-gray-700" style={{ animation: 'fadeSlideIn 0.2s ease' }}>
              {MONTH_NAMES[month]} {year}
            </p>
            <button type="button" onClick={() => changeMonth(1)}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-gray-500 transition-all hover:scale-110 active:scale-95">
              <ChevronRight size={15}/>
            </button>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-center text-xs text-gray-400 font-medium py-1">{w}</div>
            ))}
          </div>

          {/* Days grid */}
          <div key={`grid-${year}-${month}`} className="grid grid-cols-7 gap-1" style={{ animation: 'fadeSlideIn 0.18s ease' }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i}/>;
              const dt        = new Date(year, month, day);
              const disabled  = minDate ? startOfDay(dt) < startOfDay(minDate) : false;
              const isToday   = isSameDay(dt, today);
              const isSelected = selectedDate && isSameDay(dt, selectedDate);
              return (
                <button
                  key={i} type="button" disabled={disabled}
                  onClick={() => handlePick(day)}
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

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => { onChange(toISO(today)); setOpen(false); }}
              className="text-xs text-primary-500 hover:underline transition-colors">Today</button>
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Themed searchable dropdown for Linked Requirement ──────────────────────

function RequirementPicker({ value, requirements, onChange }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref                 = useRef(null);

  const selected = requirements.find(r => r.requirement_id === value);
  const filtered = requirements.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.requirement_id?.toLowerCase().includes(s) ||
      r.customers?.company_name?.toLowerCase().includes(s) ||
      r.requirement_summary?.toLowerCase().includes(s)
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
        <span className={clsx('truncate', !selected && 'text-gray-400')}>
          {selected ? `${selected.requirement_id} — ${selected.customers?.company_name ?? 'Unknown customer'}` : 'None'}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <button type="button" onClick={e => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500 transition-all hover:scale-110 active:scale-95"><X size={12}/></button>
          )}
          <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200', open && 'rotate-180')}/>
        </div>
      </div>

      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden"
          style={{ animation: 'slideDown 0.15s ease' }}>
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoFocus className="input pl-7 text-xs" placeholder="Search requirements…"
                value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()}/>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50 transition-colors">
              None
            </button>
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No requirements found</p>
            ) : filtered.map((r, i) => (
              <button key={r.requirement_id} type="button"
                onClick={() => { onChange(r.requirement_id); setOpen(false); setSearch(''); }}
                style={{ animation: `fadeSlideIn 0.15s ease ${Math.min(i, 8) * 20}ms both` }}
                className={clsx(
                  'w-full text-left px-4 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                  value === r.requirement_id && 'bg-primary-50'
                )}
              >
                <p className="text-sm font-medium text-gray-800 truncate">{r.requirement_id} — {r.customers?.company_name}</p>
                <p className="text-xs text-gray-400 truncate">{r.requirement_summary?.slice(0, 60)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sliding pill control for Equipment / Procurement / Service ─────────────

function ItemTypeSwitcher({ value, onChange }) {
  const options = [
    { key: 'equipment',   icon: Package,      label: 'Equipment' },
    { key: 'procurement', icon: ShoppingCart,  label: 'Procurement' },
    { key: 'service',     icon: Wrench,        label: 'Service' },
  ];
  const idx = Math.max(0, options.findIndex(o => o.key === value));
  return (
    <div className="relative flex rounded-lg border border-gray-200 bg-white overflow-hidden text-xs h-8 flex-1 min-w-[210px]">
      <div
        className="absolute top-0 bottom-0 bg-gradient-to-r from-primary-500 to-primary-600 rounded-md transition-all duration-300 ease-out shadow-sm"
        style={{ width: `${100 / options.length}%`, left: `${idx * (100 / options.length)}%` }}
      />
      {options.map(({ key, icon: Icon, label }) => (
        <button
          key={key} type="button" onClick={() => onChange(key)}
          className={clsx(
            'relative z-10 flex-1 flex items-center justify-center gap-1 transition-colors duration-300',
            value === key ? 'text-white font-medium' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          <Icon size={11} className="transition-transform duration-300" style={{ transform: value === key ? 'scale(1.15)' : 'scale(1)' }}/>
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuotationForm({ existing, prefilledRequirement, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit      = !!existing;
  const submitRef   = useRef(false);

  // ── Data state ─────────────────────────────────────────────────────────────
  const [customers,    setCustomers]    = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [equipment,    setEquipment]    = useState([]);   // available fleet units
  const [dataLoading,  setDataLoading]  = useState(true);
  const [saving,       setSaving]       = useState(false);

  // ── Linked requirement preview ─────────────────────────────────────────────
  const [linkedReq,  setLinkedReq]  = useState(null);
  const [reqLoading, setReqLoading] = useState(false);

  // ── Customer search ────────────────────────────────────────────────────────
  const [customerSearch,     setCustomerSearch]     = useState('');
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showNewCustomer,    setShowNewCustomer]    = useState(false);
  const [newCustomerLoading, setNewCustomerLoading] = useState(false);
  const [newCustomerForm,    setNewCustomerForm]    = useState({
    company_name:'', contact_person:'', phone:'', email:'', industry:'', address:'', notes:'',
  });

  // ── Equipment search ───────────────────────────────────────────────────────
  const [eqSearch,     setEqSearch]     = useState('');
  const [showEqSearch, setShowEqSearch] = useState(null); // idx or null

  // ── Mount animation ────────────────────────────────────────────────────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);

  const customerSearchRef = useRef(null);
  const draftKey = isEdit ? `quot-edit-${existing?.quotation_id}` : 'quot-new';

  // ── Form state ─────────────────────────────────────────────────────────────
  const INIT_FORM = {
    customer_id:      existing?.customer_id      ?? prefilledRequirement?.customer_id ?? '',
    requirement_id:   existing?.requirement_id   ?? prefilledRequirement?.requirement_id ?? '',
    quotation_date:   existing?.quotation_date    ?? new Date().toISOString().split('T')[0],
    valid_until:      existing?.valid_until       ?? '',
    vat_percent:      existing?.vat_percent       ?? 0,
    discount_amount:  existing?.discount_amount   ?? 0,
    terms_conditions: existing?.terms_conditions  ?? 'Payment within 30 days. Equipment subject to availability.',
    notes:            existing?.notes             ?? '',
  };

  const [form, setForm, clearDraft, hasDraft] = useDraft(draftKey, INIT_FORM);

  const INIT_ITEMS = isEdit && existing?.quotation_items?.length > 0
    ? existing.quotation_items.map(i => ({
        description:       i.description,
        quantity:          i.quantity,
        unit:              i.unit ?? 'Days',
        unit_rate_kwd:     i.unit_rate_kwd,
        equipment_id:      i.equipment_id ?? null,
        item_type:         i.equipment_id ? 'equipment' : 'service',
        rental_start_date: i.rental_start_date ?? '',
        rental_end_date:   i.rental_end_date   ?? '',
        discount_amount:   i.discount_amount   ?? 0,
      }))
    : [{ ...EMPTY_ITEM }];

  const [items, setItems, clearItemsDraft] = useDraft(`${draftKey}-items`, INIT_ITEMS);

  // ── Load form data ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [c, e, reqs] = await Promise.all([
        getCustomers(),
        getAvailableEquipment(),
        getRequirements(),
      ]);
      setCustomers(c ?? []);
      setEquipment(e ?? []);
      setRequirements(reqs ?? []);
    } catch { toast.error('Failed to load form data'); }
    finally { setDataLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Requirement link: load details ─────────────────────────────────────────
  useEffect(() => {
    if (!form.requirement_id) { setLinkedReq(null); return; }
    setReqLoading(true);
    getRequirement(form.requirement_id)
      .then(req => {
        setLinkedReq(req);
        if (!form.customer_id && req.customer_id) {
          setForm(f => ({ ...f, customer_id: req.customer_id }));
        }
      })
      .catch(() => toast.error('Failed to load requirement details'))
      .finally(() => setReqLoading(false));
  }, [form.requirement_id]); // eslint-disable-line

  // ── Requirement link: auto-populate items (AFTER equipment data loads) ─────
  useEffect(() => {
    if (dataLoading || !linkedReq || isEdit) return;
    if (!linkedReq.requirement_items?.length || !equipment.length) return;

    setItems(current => {
      const isDefault = current.length === 1 && !current[0].description?.trim() && !current[0].unit_rate_kwd;
      if (!isDefault) return current;

      return linkedReq.requirement_items.map(ri => {
        // Priority 1 — direct fleet unit reference
        let matched = ri.equipment_id
          ? (equipment.find(e => e.equipment_id === ri.equipment_id) ?? null)
          : null;

        // Priority 2 — first available unit of the requested type AND matching
        // capacity if one was specified on the requirement item. Without this,
        // a generic type match could grab the wrong-capacity unit (e.g. a 5 Ton
        // forklift when the requirement specifically asked for 10 Ton).
        if (!matched && ri.equipment_type_id) {
          const wantCap = (ri.capacity ?? '').toString().trim().toLowerCase();
          matched = equipment.find(e => {
            const eType = e.type_id ?? e.equipment_types?.type_id;
            if (eType !== ri.equipment_type_id) return false;
            if (!wantCap) return true; // no capacity specified — accept any unit of this type
            return (e.capacity ?? '').toString().trim().toLowerCase() === wantCap;
          }) ?? null;
        }

        if (matched) {
          const typeName = matched.equipment_types?.name ?? '';
          const cap      = matched.capacity ? ` ${matched.capacity}` : '';
          const sn       = matched.serial_number ? ` · S/N: ${matched.serial_number}` : '';
          return {
            description:       `${typeName}${cap}${sn} — Rental`.trim(),
            quantity:          ri.quantity ?? 1,
            unit:              'Days',
            unit_rate_kwd:     matched.daily_rate_kwd ?? '',
            equipment_id:      matched.equipment_id,
            item_type:         'equipment',
            rental_start_date: linkedReq.start_date ?? '',
            rental_end_date:   linkedReq.end_date   ?? '',
            discount_amount:   0,
          };
        }

        // Fallback — type/capacity not in fleet → flag as procurement
        const needsProcurement = !!ri.equipment_type_id;
        return {
          description:       ri.description ?? '',
          quantity:          ri.quantity ?? 1,
          unit:              'Days',
          unit_rate_kwd:     '',
          equipment_id:      null,
          item_type:         needsProcurement ? 'procurement' : 'service',
          rental_start_date: linkedReq.start_date ?? '',
          rental_end_date:   linkedReq.end_date   ?? '',
          discount_amount:   0,
        };
      });
    });
  }, [dataLoading, linkedReq, equipment, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Outside-click: close customer dropdown ─────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (customerSearchRef.current && !customerSearchRef.current.contains(e.target))
        setShowCustomerSearch(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Form helpers ───────────────────────────────────────────────────────────
  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const setItem = (idx, field, val) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: val };

      if (field === 'equipment_id' && val) {
        const eq = equipment.find(e => e.equipment_id === val);
        if (eq) {
          updated.unit_rate_kwd = eq.daily_rate_kwd ?? '';
          updated.description   = `${eq.equipment_types?.name ?? ''} ${eq.capacity ?? ''} — Rental`.trim();
          updated.item_type     = 'equipment';
        }
        setShowEqSearch(null); setEqSearch('');
      }

      if (field === 'item_type') {
        updated.equipment_id  = null;
        updated.description   = '';
        updated.unit_rate_kwd = '';
        if (val !== 'equipment') {
          updated.rental_start_date = '';
          updated.rental_end_date   = '';
        }
      }

      return updated;
    }));
  };

  const addItem    = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => {
    if (items.length === 1) return toast.error('At least one item is required');
    setItems(i => i.filter((_, j) => j !== idx));
    if (showEqSearch === idx) setShowEqSearch(null);
  };

  // ── Stock info — capacity-aware ────────────────────────────────────────────
  const getStockInfo = useCallback((item) => {
    if (item.item_type !== 'equipment' || !item.equipment_id) return null;
    const eq = equipment.find(e => e.equipment_id === item.equipment_id);
    if (!eq) return null;

    const typeId   = eq.type_id ?? eq.equipment_types?.type_id;
    const capacity = eq.capacity ?? null;

    const peers     = equipment.filter(e => {
      const eType = e.type_id ?? e.equipment_types?.type_id;
      return eType === typeId && (e.capacity ?? null) === capacity;
    });
    const available = peers.filter(e => e.status === 'Available').length;

    const usedInForm = items.filter(i => {
      if (!i.equipment_id) return false;
      const e2     = equipment.find(e => e.equipment_id === i.equipment_id);
      const e2Type = e2?.type_id ?? e2?.equipment_types?.type_id;
      return e2Type === typeId && (e2?.capacity ?? null) === capacity;
    }).length;

    const label = `${eq.equipment_types?.name ?? ''}${capacity ? ` ${capacity}` : ''}`.trim();
    return { available, usedInForm, ok: usedInForm <= available, label };
  }, [equipment, items]);

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredEquipment = useMemo(() => equipment.filter(e => {
    if (!eqSearch) return true;
    const s = eqSearch.toLowerCase();
    return (
      e.equipment_types?.name?.toLowerCase().includes(s) ||
      e.equipment_id?.toLowerCase().includes(s) ||
      e.serial_number?.toLowerCase().includes(s) ||
      e.capacity?.toLowerCase().includes(s) ||
      e.location?.toLowerCase().includes(s)
    );
  }), [equipment, eqSearch]);

  const filteredCustomers = useMemo(() => customers.filter(c => {
    if (!customerSearch) return true;
    const s = customerSearch.toLowerCase();
    return (
      c.company_name?.toLowerCase().includes(s) ||
      c.contact_person?.toLowerCase().includes(s) ||
      c.industry?.toLowerCase().includes(s) ||
      c.customer_id?.toLowerCase().includes(s)
    );
  }), [customers, customerSearch]);

  const selectedCustomer = customers.find(c => c.customer_id === form.customer_id);

  // ── Totals — date-computed quantity ────────────────────────────────────────
  const itemsSubtotal  = items.reduce((s, i) => s + lineNet(i), 0);
  const headerDiscount = Number(form.discount_amount || 0);
  const afterDiscount  = Math.max(0, itemsSubtotal - headerDiscount);
  const vatAmt         = afterDiscount * (Number(form.vat_percent) / 100);
  const total          = afterDiscount + vatAmt;
  const stockViolations = items.filter(item => { const info = getStockInfo(item); return info && !info.ok; });

  // Smooth count-up displays for the totals panel
  const subtotalDisplay = useCountUp(itemsSubtotal);
  const afterDiscDisplay = useCountUp(afterDiscount);
  const vatDisplay       = useCountUp(vatAmt);
  const totalDisplay     = useCountUp(total);

  // ── Create customer inline ─────────────────────────────────────────────────
  const handleCreateCustomer = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!newCustomerForm.company_name.trim()) return toast.error('Enter company name');
    if (!newCustomerForm.contact_person.trim()) return toast.error('Enter contact person');
    setNewCustomerLoading(true);
    try {
      const newCust = await createCustomer(newCustomerForm);
      const updated = await getCustomers();
      setCustomers(updated);
      set('customer_id', newCust.customer_id);
      setShowNewCustomer(false);
      setNewCustomerForm({ company_name:'', contact_person:'', phone:'', email:'', industry:'', address:'', notes:'' });
      toast.success('Customer created and selected');
    } catch (err) { toast.error(err.message || 'Failed to create customer');
    } finally { setNewCustomerLoading(false); }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitRef.current) return;
    if (!form.customer_id)                         return toast.error('Please select a customer');
    if (!form.quotation_date)                      return toast.error('Please select a quotation date');
    if (items.some(i => !i.description?.trim()))   return toast.error('Fill in all item descriptions');
    if (items.some(i => !i.unit_rate_kwd && i.item_type !== 'procurement'))
                                                    return toast.error('Fill in all rates');
    if (stockViolations.length > 0)                return toast.error('Some items exceed available stock');

    submitRef.current = true;
    setSaving(true);
    try {
      const payload = {
        ...form,
        prepared_by:      profile.user_id,
        subtotal_kwd:     itemsSubtotal,
        discount_amount:  headerDiscount,
        discount_percent: itemsSubtotal > 0 ? (headerDiscount / itemsSubtotal) * 100 : 0,
        vat_amount_kwd:   vatAmt,
        total_amount_kwd: total,
        vat_percent:      Number(form.vat_percent),
        requirement_id:   form.requirement_id || null,
      };

      // cleanItems: explicit DB-only columns — used for the UPDATE path via
      // updateQuotationItems, which writes directly to quotation_items.
      const cleanItems = items.map(item => {
        const days = calcDays(item.rental_start_date, item.rental_end_date);
        const qty  = days ?? Math.max(1, Number(item.quantity) || 1);
        return {
          description:       (item.description ?? '').trim(),
          quantity:          qty,
          unit:              days != null ? 'Days' : (item.unit ?? 'Days'),
          unit_rate_kwd:     Number(item.unit_rate_kwd ?? 0),
          equipment_id:      item.equipment_id || null,
          rental_start_date: item.rental_start_date || null,
          rental_end_date:   item.rental_end_date   || null,
          discount_amount:   Number(item.discount_amount ?? 0),
          // item_type, procurement_id → NOT DB columns; excluded
          // total_kwd → DB DEFAULT; excluded
        };
      });

      // itemsForCreate: same date-computed quantity as cleanItems, but keeps
      // item_type intact — createQuotation() needs it to detect which items
      // require an auto-generated procurement request (item_type === 'procurement'),
      // and strips it itself before the actual DB insert.
      const itemsForCreate = items.map(item => {
        const days = calcDays(item.rental_start_date, item.rental_end_date);
        return {
          ...item,
          quantity: days ?? Math.max(1, Number(item.quantity) || 1),
          unit:     days != null ? 'Days' : (item.unit ?? 'Days'),
        };
      });

      const procurementCount = items.filter(i => i.item_type === 'procurement').length;

      if (isEdit) {
        await updateQuotation(existing.quotation_id, payload);
        await updateQuotationItems(existing.quotation_id, cleanItems);
        toast.success('Quotation updated');
      } else {
        const created = await createQuotation(payload, itemsForCreate);
        if (procurementCount > 0) {
          if (created?._procurementCreated) {
            toast.success(
              `Quotation created — procurement request raised for ${procurementCount} item${procurementCount !== 1 ? 's' : ''}`,
              { duration: 5000 }
            );
          } else {
            toast.success('Quotation created');
            toast.error(
              `Procurement request could not be auto-created for ${procurementCount} item${procurementCount !== 1 ? 's' : ''} — please raise it manually with the Procurement team.`,
              { duration: 7000 }
            );
          }
        } else {
          toast.success('Quotation created');
        }
      }
      clearDraft(); clearItemsDraft();
      onSuccess();
    } catch (err) {
      toast.error(err.message || 'Failed to save quotation');
    } finally {
      setSaving(false);
      submitRef.current = false;
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (dataLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-10 h-10 rounded-full border-4 border-primary-100 border-t-primary-500 animate-spin"/>
      <p className="text-sm text-gray-400">Loading form data…</p>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="max-w-7xl mx-auto qf-scope"
      style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(8px)', transition: 'opacity 0.3s ease, transform 0.3s ease' }}
    >
      {/* Submission overlay */}
      {saving && (
        <div className="fixed inset-0 z-[60] bg-white/70 backdrop-blur-sm flex items-center justify-center" style={{ animation: 'fadeSlideIn 0.2s ease' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-4 border-primary-100"/>
              <div className="absolute inset-0 rounded-full border-4 border-t-primary-500 border-r-primary-400 animate-spin"/>
            </div>
            <p className="text-sm font-medium text-gray-600">{isEdit ? 'Updating quotation…' : 'Creating quotation…'}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onCancel} className="btn-secondary p-2 transition-transform hover:scale-105 active:scale-95">
          <ArrowLeft size={16}/>
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Quotation' : 'New Quotation'}</h2>
          <p className="text-sm text-gray-400">{isEdit ? existing.quotation_id : 'Create a new quotation'}</p>
        </div>
      </div>

      {/* Draft banner */}
      {!isEdit && hasDraft() && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center justify-between mb-4">
          <p className="text-sm text-yellow-700">📝 Draft restored from your last session</p>
          <button type="button" onClick={() => { clearDraft(); clearItemsDraft(); window.location.reload(); }}
            className="text-xs text-yellow-600 hover:underline ml-4">Clear draft</button>
        </div>
      )}

      {/* Stock violation banner */}
      {stockViolations.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3 mb-4" style={{ animation: 'pulseGlowRed 2s ease-in-out infinite' }}>
          <AlertTriangle size={16} className="text-red-500 shrink-0"/>
          <p className="text-sm text-red-700">
            {stockViolations.length} item{stockViolations.length !== 1 ? 's' : ''} exceed available stock — adjust before saving.
          </p>
        </div>
      )}

      {/* Mobile requirement panel */}
      {form.requirement_id && (
        <div className="lg:hidden mb-4">
          <RequirementSidePanel requirementId={form.requirement_id} compact={true}/>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-6">
          {/* ── Main column ── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Quotation Details */}
            <div className="card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 flex items-center gap-2">
                <TrendingUp size={14} className="text-primary-500"/> Quotation Details
              </h3>

              {/* Customer */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1" ref={customerSearchRef}>
                    <div
                      className={clsx(
                        'input flex items-center gap-2 cursor-pointer transition-all duration-200',
                        !form.customer_id && 'text-gray-400',
                        showCustomerSearch && 'ring-2 ring-primary-300 border-primary-300'
                      )}
                      onClick={() => { setShowCustomerSearch(true); setCustomerSearch(''); }}
                    >
                      {selectedCustomer ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Building2 size={14} className="text-primary-500 shrink-0"/>
                          <span className="text-gray-800 font-medium truncate">{selectedCustomer.company_name}</span>
                          {selectedCustomer.industry && <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">— {selectedCustomer.industry}</span>}
                          {selectedCustomer.contact_person && <span className="text-xs text-gray-400 shrink-0 hidden md:inline">— {selectedCustomer.contact_person}</span>}
                        </div>
                      ) : (
                        <span className="flex items-center gap-2"><Search size={14}/> Search customer…</span>
                      )}
                      {form.customer_id && (
                        <button type="button" onClick={e => { e.stopPropagation(); set('customer_id', ''); }}
                          className="text-gray-300 hover:text-gray-500 ml-auto shrink-0 transition-all hover:scale-110 active:scale-95"><X size={14}/></button>
                      )}
                    </div>

                    {showCustomerSearch && (
                      <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden"
                        style={{ animation: 'slideDown 0.15s ease' }}>
                        <div className="p-2 border-b border-gray-100">
                          <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                            <input autoFocus className="input pl-7 text-sm" placeholder="Type to search…"
                              value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                              onClick={e => e.stopPropagation()}/>
                          </div>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {filteredCustomers.length === 0 ? (
                            <p className="text-sm text-gray-400 text-center py-4">No customers found</p>
                          ) : filteredCustomers.map((c, i) => (
                            <button key={c.customer_id} type="button"
                              onClick={() => { set('customer_id', c.customer_id); setShowCustomerSearch(false); setCustomerSearch(''); }}
                              style={{ animation: `fadeSlideIn 0.15s ease ${Math.min(i, 8) * 20}ms both` }}
                              className={clsx('w-full flex items-start gap-3 px-4 py-3 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                                form.customer_id === c.customer_id && 'bg-primary-50')}>
                              <Building2 size={16} className="text-gray-400 mt-0.5 shrink-0"/>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800">{c.company_name}</p>
                                <p className="text-xs text-gray-400">{[c.industry, c.contact_person, c.phone].filter(Boolean).join(' — ')}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="p-2 border-t border-gray-100">
                          <button type="button"
                            onClick={() => { setShowCustomerSearch(false); setShowNewCustomer(true); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                            <Plus size={14}/> Create new customer
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <button type="button" onClick={() => setShowNewCustomer(true)}
                    className="btn-secondary px-3 text-xs whitespace-nowrap flex items-center gap-1 shrink-0 transition-transform hover:scale-105 active:scale-95" title="Add new customer">
                    <Plus size={12}/> New
                  </button>
                </div>
              </div>

              {/* Inline new customer form */}
              {showNewCustomer && (
                <div className="border-2 border-primary-100 rounded-xl p-4 bg-primary-50/30 space-y-3"
                  style={{ animation: 'slideDown 0.2s ease' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-primary-700 flex items-center gap-2">
                      <Building2 size={14}/> New Customer
                    </p>
                    <button type="button" onClick={() => setShowNewCustomer(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={16}/></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: 'Company Name *', key: 'company_name', type: 'text' },
                      { label: 'Contact Person *', key: 'contact_person', type: 'text' },
                      { label: 'Phone', key: 'phone', type: 'text', placeholder: '+965 XXXXXXXX' },
                      { label: 'Email', key: 'email', type: 'email' },
                      { label: 'Address', key: 'address', type: 'text' },
                    ].map(({ label, key, type, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                        <input type={type} className="input text-sm" placeholder={placeholder ?? ''} value={newCustomerForm[key]}
                          onChange={e => setNewCustomerForm(f => ({...f, [key]: e.target.value}))}/>
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
                      <select className="input text-sm" value={newCustomerForm.industry}
                        onChange={e => setNewCustomerForm(f => ({...f, industry: e.target.value}))}>
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

              {/* Linked Requirement — themed searchable dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Linked Requirement</label>
                <RequirementPicker
                  value={form.requirement_id}
                  requirements={requirements}
                  onChange={val => set('requirement_id', val)}
                />
                {reqLoading && (
                  <p className="text-xs text-primary-500 mt-1 flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin"/> Loading requirement…
                  </p>
                )}
                {linkedReq && !reqLoading && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle size={11}/>
                    Requirement loaded — details shown in side panel
                    {linkedReq.requirement_items?.length > 0 && ` · ${linkedReq.requirement_items.length} item${linkedReq.requirement_items.length !== 1 ? 's' : ''} auto-populated`}
                  </p>
                )}
              </div>

              {/* Dates / VAT / Discount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Date</label>
                  <DatePicker value={form.quotation_date} onChange={v => set('quotation_date', v)} placeholder="Select date"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
                  <DatePicker value={form.valid_until} onChange={v => set('valid_until', v)} min={form.quotation_date} placeholder="Select date"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Discount (KWD)</label>
                  <input type="number" min="0" step="0.001" className="input" placeholder="0.000"
                    value={form.discount_amount} onWheel={blurOnWheel}
                    onChange={e => set('discount_amount', e.target.value)}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VAT %</label>
                  <input type="number" min="0" max="100" step="0.01" className="input"
                    value={form.vat_percent} onWheel={blurOnWheel}
                    onChange={e => set('vat_percent', e.target.value)}/>
                </div>
              </div>
            </div>

            {/* ── Line Items ── */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Package size={14} className="text-primary-500"/> Line Items
                  </h3>
                  {linkedReq?.requirement_items?.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">Pre-populated from requirement — adjust as needed</p>
                  )}
                </div>
                <button type="button" onClick={addItem}
                  className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5 transition-transform hover:scale-105 active:scale-95">
                  <Plus size={13}/> Add Item
                </button>
              </div>

              <div className="space-y-4">
                {items.map((item, idx) => {
                  const stockInfo   = getStockInfo(item);
                  const isOverStock = stockInfo && !stockInfo.ok;
                  const isEqOpen    = showEqSearch === idx;
                  const days        = calcDays(item.rental_start_date, item.rental_end_date);
                  const gross       = lineGross(item);
                  const net         = lineNet(item);

                  return (
                    <div
                      key={idx}
                      className={clsx(
                        'relative rounded-xl border p-4 space-y-3 transition-all duration-200',
                        isOverStock
                          ? 'border-red-200 bg-red-50/50 shadow-sm shadow-red-100'
                          : 'border-gray-100 bg-gray-50/30 hover:border-primary-200 hover:shadow-md'
                      )}
                      style={{ animation: `fadeSlideIn 0.25s ease ${Math.min(idx, 6) * 40}ms both`, zIndex: items.length - idx }}
                    >
                      {/* Item header — sliding type switcher + remove */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-400 w-5">#{idx + 1}</span>
                        <ItemTypeSwitcher value={item.item_type} onChange={key => setItem(idx, 'item_type', key)}/>
                        <button type="button" onClick={() => removeItem(idx)}
                          className="text-gray-300 hover:text-red-500 transition-all hover:scale-110 active:scale-95">
                          <Trash2 size={15}/>
                        </button>
                      </div>

                      {/* ── Equipment type: fleet selector ── */}
                      {item.item_type === 'equipment' && (
                        <div className="space-y-2">
                          <div className="relative">
                            <div
                              role="button" tabIndex={0}
                              onClick={() => { setShowEqSearch(isEqOpen ? null : idx); setEqSearch(''); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowEqSearch(isEqOpen ? null : idx); setEqSearch(''); } }}
                              className={clsx(
                                'input w-full text-left flex items-center justify-between text-sm cursor-pointer select-none transition-all duration-200',
                                isOverStock && 'border-red-300',
                                isEqOpen && 'ring-2 ring-primary-300 border-primary-300'
                              )}>
                              <span className={item.equipment_id ? 'text-gray-800' : 'text-gray-400'}>
                                {item.equipment_id
                                  ? (() => { const eq = equipment.find(e => e.equipment_id === item.equipment_id); return eq ? `${eq.equipment_types?.name} ${eq.capacity ?? ''} — ${eq.equipment_id}`.trim() : item.equipment_id; })()
                                  : 'Search and select equipment…'}
                              </span>
                              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                                {item.equipment_id && (
                                  <button type="button" onClick={e => { e.stopPropagation(); setItem(idx, 'equipment_id', null); }}
                                    className="text-gray-300 hover:text-gray-500 transition-all hover:scale-110 active:scale-95"><X size={12}/></button>
                                )}
                                <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200', isEqOpen && 'rotate-180')}/>
                              </div>
                            </div>

                            {isEqOpen && (
                              <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden"
                                style={{ animation: 'slideDown 0.15s ease' }}>
                                <div className="p-2 border-b border-gray-100">
                                  <div className="relative">
                                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                                    <input autoFocus className="input pl-7 text-xs"
                                      placeholder="Search by type, serial, capacity, location…"
                                      value={eqSearch} onChange={e => setEqSearch(e.target.value)}
                                      onClick={e => e.stopPropagation()}/>
                                    {eqSearch && <button onClick={() => setEqSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"><X size={12}/></button>}
                                  </div>
                                </div>
                                <div className="max-h-56 overflow-y-auto">
                                  {filteredEquipment.length === 0 ? (
                                    <p className="text-xs text-gray-400 text-center py-4">No equipment found</p>
                                  ) : filteredEquipment.map((eq, i) => {
                                    const eqTypeId   = eq.type_id ?? eq.equipment_types?.type_id;
                                    const eqCapacity = eq.capacity ?? null;
                                    const peers      = equipment.filter(e => (e.type_id ?? e.equipment_types?.type_id) === eqTypeId && (e.capacity ?? null) === eqCapacity);
                                    const avail      = peers.filter(e => e.status === 'Available').length;
                                    const isSelected = item.equipment_id === eq.equipment_id;
                                    return (
                                      <button key={eq.equipment_id} type="button"
                                        onClick={() => setItem(idx, 'equipment_id', eq.equipment_id)}
                                        style={{ animation: `fadeSlideIn 0.15s ease ${Math.min(i, 8) * 15}ms both` }}
                                        className={clsx('w-full flex items-center justify-between px-4 py-2.5 text-left border-b border-gray-50 last:border-0 transition-colors text-xs',
                                          isSelected ? 'bg-primary-50' : 'hover:bg-gray-50')}>
                                        <div>
                                          <p className="font-medium text-gray-800">{eq.equipment_types?.name} {eq.capacity ?? ''}</p>
                                          <p className="text-gray-400">{eq.equipment_id} · {eq.serial_number ?? 'No serial'} · {eq.location ?? '—'}</p>
                                        </div>
                                        <div className="flex items-center gap-2 ml-3 shrink-0">
                                          <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium',
                                            avail === 0 ? 'bg-red-100 text-red-600' : avail === 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700')}>
                                            {avail} avail
                                          </span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="p-2 border-t border-gray-100 flex justify-end">
                                  <button type="button" onClick={() => setShowEqSearch(null)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Capacity-aware stock badge with shimmer bar */}
                          {stockInfo && (
                            <div className={clsx(
                              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300',
                              stockInfo.ok ? 'bg-green-50 text-green-700' : 'bg-red-100 text-red-700'
                            )} style={!stockInfo.ok ? { animation: 'pulseGlowRed 2s ease-in-out infinite' } : undefined}>
                              {stockInfo.ok ? <CheckCircle size={12}/> : <AlertTriangle size={12}/>}
                              <span>
                                {stockInfo.available} unit{stockInfo.available !== 1 ? 's' : ''} available
                                {stockInfo.label ? ` (${stockInfo.label})` : ''}
                                {!stockInfo.ok && ` — you've used ${stockInfo.usedInForm}, only ${stockInfo.available} in fleet`}
                              </span>
                              <div className="ml-auto flex items-center gap-1 shrink-0">
                                <div className="w-16 h-1.5 bg-white/70 rounded-full overflow-hidden relative">
                                  <div
                                    className={clsx('h-full rounded-full transition-all duration-500',
                                      stockInfo.ok ? 'bg-gradient-to-r from-green-400 to-green-600' : 'bg-gradient-to-r from-red-400 to-red-600')}
                                    style={{ width: `${Math.min(100, (stockInfo.available / Math.max(stockInfo.usedInForm, stockInfo.available, 1)) * 100)}%` }}
                                  />
                                  {stockInfo.ok && (
                                    <div className="absolute inset-0 w-1/3" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)', animation: 'shimmerSlide 2s ease-in-out infinite' }}/>
                                  )}
                                </div>
                                {!stockInfo.ok && <span className="font-bold text-red-700">EXCEEDS</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Procurement type: pending procurement form ── */}
                      {item.item_type === 'procurement' && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2"
                          style={{ animation: 'fadeSlideIn 0.2s ease' }}>
                          <div className="flex items-start gap-2">
                            <ShoppingCart size={14} className="text-amber-600 shrink-0 mt-0.5"/>
                            <div>
                              <p className="text-xs font-semibold text-amber-800">Procurement Required</p>
                              <p className="text-xs text-amber-600 mt-0.5">
                                This item will be flagged for the Procurement team after the quotation is approved.
                                A purchase order will be raised and the equipment added to fleet before dispatch.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5">
                            <Info size={11} className="shrink-0"/>
                            <span>No procurement order needed now — fill in description and estimated cost below.</span>
                          </div>
                        </div>
                      )}

                      {/* ── Service type: info badge ── */}
                      {item.item_type === 'service' && (
                        <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                          <Wrench size={12} className="shrink-0"/> Manual / Service item — not linked to fleet
                        </div>
                      )}

                      {/* ── Description + Rate row ── */}
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-12 sm:col-span-8">
                          <label className="block text-xs text-gray-400 mb-1">
                            Description <span className="text-red-400">*</span>
                            {item.equipment_id && <span className="text-green-600 ml-1">(auto-filled)</span>}
                          </label>
                          <input className="input text-sm" placeholder="Description *"
                            value={item.description} onChange={e => setItem(idx, 'description', e.target.value)} required/>
                        </div>
                        <div className="col-span-12 sm:col-span-4">
                          <label className="block text-xs text-gray-400 mb-1">
                            Daily Rate (KWD)
                            {item.item_type === 'procurement' && <span className="text-amber-500 ml-1">(estimated)</span>}
                          </label>
                          <input type="number" min="0" step="0.001"
                            className={clsx('input text-sm', isOverStock && 'border-red-300')}
                            placeholder="Rate KWD"
                            value={item.unit_rate_kwd}
                            onWheel={blurOnWheel}
                            onChange={e => setItem(idx, 'unit_rate_kwd', e.target.value)}/>
                        </div>
                      </div>

                      {/* ── Rental dates → auto-computes quantity ── */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1 flex items-center gap-1">
                            <Calendar size={10}/> Rental Start
                          </label>
                          <DatePicker
                            value={item.rental_start_date}
                            onChange={v => setItem(idx, 'rental_start_date', v)}
                            placeholder="Start date"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1 flex items-center gap-1">
                            <Calendar size={10}/> Rental End / Return
                          </label>
                          <DatePicker
                            value={item.rental_end_date}
                            onChange={v => setItem(idx, 'rental_end_date', v)}
                            min={item.rental_start_date}
                            placeholder="End date"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1 flex items-center gap-1">
                            <Clock size={10}/> Duration
                          </label>
                          {days != null ? (
                            <div className="input text-sm bg-gray-50 text-primary-600 font-semibold flex items-center gap-1.5" style={{ animation: 'popIn 0.2s ease' }}>
                              <Clock size={12} className="text-primary-400 shrink-0"/>
                              {days} day{days !== 1 ? 's' : ''}
                              <span className="text-gray-400 font-normal ml-auto text-xs">auto</span>
                            </div>
                          ) : (
                            <div>
                              <input type="number" min="1" className="input text-sm"
                                placeholder="Qty (manual)"
                                value={item.quantity}
                                onWheel={blurOnWheel}
                                onChange={e => setItem(idx, 'quantity', e.target.value)}/>
                              <p className="text-xs text-gray-400 mt-0.5">Set dates above to auto-calculate</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Item discount + line total ── */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <label className="shrink-0">Item discount:</label>
                          <input type="number" min="0" step="0.001" className="input text-xs w-28 py-1"
                            placeholder="KWD 0.000" value={item.discount_amount}
                            onWheel={blurOnWheel}
                            onChange={e => setItem(idx, 'discount_amount', e.target.value)}/>
                        </div>
                        <div className="text-right text-xs space-y-0.5 shrink-0">
                          {Number(item.discount_amount) > 0 && (
                            <p className="text-gray-400 line-through">KWD {fmt(gross)}</p>
                          )}
                          <p className="font-semibold text-gray-800 text-sm transition-all duration-300">
                            KWD {fmt(net)}
                          </p>
                          {days != null && (
                            <p className="text-gray-400">{days}d × KWD {fmt(Number(item.unit_rate_kwd || 0))}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Totals — animated count-up ── */}
              <div className="mt-6 border-t border-gray-100 pt-4 space-y-1.5 flex flex-col items-end text-sm">
                <div className="flex gap-10 text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-medium w-44 text-right">KWD {fmt(subtotalDisplay)}</span>
                </div>
                {headerDiscount > 0 && (
                  <div className="flex gap-10 text-red-500">
                    <span>Quotation Discount</span>
                    <span className="font-medium w-44 text-right">− KWD {fmt(headerDiscount)}</span>
                  </div>
                )}
                {headerDiscount > 0 && (
                  <div className="flex gap-10 text-gray-600">
                    <span>After Discount</span>
                    <span className="font-medium w-44 text-right">KWD {fmt(afterDiscDisplay)}</span>
                  </div>
                )}
                {Number(form.vat_percent) > 0 && (
                  <div className="flex gap-10 text-gray-600">
                    <span>VAT ({form.vat_percent}%)</span>
                    <span className="font-medium w-44 text-right">KWD {fmt(vatDisplay)}</span>
                  </div>
                )}
                <div className="relative flex gap-10 font-bold text-gray-900 text-base border-t border-gray-200 pt-2 mt-1">
                  <span>Total</span>
                  <span className="w-44 text-right bg-gradient-to-r from-primary-600 to-primary-700 bg-clip-text text-transparent">
                    KWD {fmt(totalDisplay)}
                  </span>
                </div>
              </div>
            </div>

            {/* Terms & Notes */}
            <div className="card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">Terms & Notes</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
                <textarea className="input resize-y" rows={3} value={form.terms_conditions}
                  onChange={e => set('terms_conditions', e.target.value)}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
                <textarea className="input resize-y" rows={2} value={form.notes}
                  onChange={e => set('notes', e.target.value)}/>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pb-6">
              <button type="button" onClick={onCancel}
                className="btn-secondary transition-transform hover:scale-105 active:scale-95">Cancel</button>
              <button type="submit" disabled={saving || stockViolations.length > 0}
                className={clsx(
                  'btn-primary flex items-center gap-2 transition-all',
                  (saving || stockViolations.length > 0)
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:scale-105 active:scale-95'
                )}>
                {saving && <Loader2 size={15} className="animate-spin"/>}
                {saving ? 'Saving…' : isEdit ? 'Update Quotation' : 'Create Quotation'}
              </button>
            </div>
          </div>

          {/* Desktop side panel — sticky */}
          {form.requirement_id && (
            <div className="hidden lg:block w-80 shrink-0">
              <div className="sticky top-4">
                <RequirementSidePanel
                  requirementId={form.requirement_id}
                  onClose={() => set('requirement_id', '')}
                />
              </div>
            </div>
          )}
        </div>
      </form>

      {/* Keyframes + scoped fix: disable scroll/spinner on number inputs within this form only */}
      <style>{`
        .qf-scope input[type=number]::-webkit-outer-spin-button,
        .qf-scope input[type=number]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .qf-scope input[type=number] {
          -moz-appearance: textfield;
        }

        /* ── Smooth transitions for all interactive fields ── */
        .qf-scope .input,
        .qf-scope input,
        .qf-scope textarea,
        .qf-scope select {
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, opacity 0.18s ease;
        }
        .qf-scope .input:hover,
        .qf-scope input:hover,
        .qf-scope textarea:hover {
          border-color: #a5b4fc;
        }
        .qf-scope .input:focus,
        .qf-scope input:focus,
        .qf-scope textarea:focus {
          border-color: #818cf8;
          box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
          outline: none;
        }

        /* ── Dropdown / card entrance ── */
        .qf-scope [role="button"] {
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.15s ease;
        }
        .qf-scope [role="button"]:hover {
          border-color: #a5b4fc;
        }

        /* ── Buttons ── */
        .qf-scope button {
          transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease, opacity 0.15s ease;
        }

        /* ── Label fade-in ── */
        .qf-scope label {
          transition: color 0.15s ease;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          0%   { opacity: 0; transform: scale(0.9); }
          60%  { transform: scale(1.03); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes pulseGlowRed {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.25); }
          50%      { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
        }
        @keyframes shimmerSlide {
          0%   { transform: translateX(-150%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}