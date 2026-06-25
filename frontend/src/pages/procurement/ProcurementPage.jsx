import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getProcurements, createProcurement, updateProcurement,
  getVendors, createVendor,
  getPurchaseOrders, createPurchaseOrder, updatePurchaseOrder,
  submitPurchaseOrder, receiveProcurement,
} from '../../api/procurement';
import { getEquipmentTypes, createEquipmentType } from '../../api/equipment';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { downloadPurchaseOrderPDF } from '../../lib/pdfGenerator';
import {
  Plus, ShoppingCart, X, Loader2, RefreshCw, FileText,
  Send, Download, Trash2, CheckCircle, Eye, Package, Search,
  ChevronDown, Calendar, MapPin, Sparkles, RotateCcw, Hash,
  AlertCircle, ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const TABS          = ['Requests','Purchase Orders','Vendors'];
// const PROC_STATUSES = ['Draft','Pending Approval','Approved','PO Issued','Partially Delivered','Delivered','Received','Cancelled','Rejected'];
const EMPTY_ITEM    = { description:'', capacity:'', unit_price_kwd:'', equipment_type_id:'' };

// ── Serial-number suggestion helpers ─────────────────────────────────────────

function getSerialPrefix(typeName) {
  if (!typeName) return 'EQ';
  const words = typeName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map(w => w[0].toUpperCase()).slice(0, 4).join('');
}

function parseSerial(s) {
  // Handles CC001, CC-001, FL123, EXCV-001 etc.
  const m = s?.match(/^([A-Za-z]+[-_]?)(\d+)$/);
  return m ? { prefix: m[1], num: parseInt(m[2], 10), padLen: m[2].length } : null;
}

function suggestNextSerials(typeName, dbSerials, count, sessionSerials = []) {
  const all = [...dbSerials, ...sessionSerials].filter(Boolean);
  const parsed = all.map(parseSerial).filter(Boolean);

  if (parsed.length === 0) {
    // No existing pattern — generate prefix with dash for new types
    const pfx = getSerialPrefix(typeName) + '-';
    return Array.from({ length: count }, (_, i) =>
      `${pfx}${String(i + 1).padStart(3, '0')}`
    );
  }

  // Find most-used prefix
  const freq = {};
  parsed.forEach(p => { freq[p.prefix] = (freq[p.prefix] || 0) + 1; });
  const prefix   = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  const relevant = parsed.filter(p => p.prefix === prefix);
  const maxNum   = Math.max(...relevant.map(p => p.num));
  const padLen   = Math.max(3, relevant[0].padLen);

  return Array.from({ length: count }, (_, i) =>
    `${prefix}${String(maxNum + 1 + i).padStart(padLen, '0')}`
  );
}

// ── Vendor Modal — defined OUTSIDE parent to prevent remount on state change ──
function VendorModal({ vendors, setVendors, showModal, setShowModal, onVendorCreated, formLoading, setFormLoading }) {
  const [form, setForm] = useState({
    name:'', contact_person:'', phone:'', email:'',
    address:'', country:'Kuwait', category:'', payment_terms:'', notes:'',
  });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Enter vendor name');
    setFormLoading(true);
    try {
      const newVendor = await createVendor(form);
      toast.success('Vendor added');
      onVendorCreated(newVendor);
    } catch (err) {
      toast.error(err.message || 'Failed to add vendor');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Add New Vendor</h3>
          <button type="button" onClick={() => setShowModal(showModal === 'vendor-inline' ? 'proc' : showModal === 'vendor-po' ? 'po' : null)}>
            <X size={18} className="text-gray-400"/>
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name *</label>
            <input
              className="input" value={form.name}
              onChange={e => setForm(f => ({...f, name: e.target.value}))}
              autoComplete="off" required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <input className="input" value={form.contact_person}
                onChange={e => setForm(f => ({...f, contact_person: e.target.value}))} autoComplete="off"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input className="input" value={form.category}
                onChange={e => setForm(f => ({...f, category: e.target.value}))}
                placeholder="e.g. Heavy Equipment" autoComplete="off"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input className="input" value={form.phone}
                onChange={e => setForm(f => ({...f, phone: e.target.value}))} autoComplete="off"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" className="input" value={form.email}
                onChange={e => setForm(f => ({...f, email: e.target.value}))} autoComplete="off"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input className="input" value={form.country}
                onChange={e => setForm(f => ({...f, country: e.target.value}))} autoComplete="off"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
              <input className="input" value={form.payment_terms}
                onChange={e => setForm(f => ({...f, payment_terms: e.target.value}))}
                placeholder="e.g. Net 30" autoComplete="off"/>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea className="input" rows={2} value={form.address}
              onChange={e => setForm(f => ({...f, address: e.target.value}))}/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => setForm(f => ({...f, notes: e.target.value}))}/>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button"
              onClick={() => setShowModal(showModal === 'vendor-inline' ? 'proc' : showModal === 'vendor-po' ? 'po' : null)}
              className="btn-secondary">Cancel</button>
            <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
              {formLoading && <Loader2 size={14} className="animate-spin"/>}
              {formLoading ? 'Saving…' : 'Add Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── New Equipment Type Modal — also outside to prevent remount ──
function NewEquipmentTypeModal({ onCreated, onClose, formLoading, setFormLoading, initialName = '' }) {
  const [form, setForm] = useState({
    name: initialName, category:'',
    default_daily_rate_kwd:'', manufacturer:'', unit:'Unit',
  });

  // Re-sync if initialName arrives after first render (e.g. async open)
  const prevInitial = useRef(initialName);
  useEffect(() => {
    if (initialName && initialName !== prevInitial.current) {
      setForm(f => ({ ...f, name: initialName }));
      prevInitial.current = initialName;
    }
  }, [initialName]);

  const CATEGORIES = ['Crane','Material Handling','Lifting','Transport','Trailer','Tanker','Power','Other'];

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Enter type name');
    setFormLoading(true);
    try {
      const newType = await createEquipmentType(form);
      toast.success(`Equipment type "${newType.name}" created`);
      onCreated(newType);
    } catch (err) {
      toast.error(err.message || 'Failed to create type');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Add New Equipment Type</h3>
          <button type="button" onClick={onClose}><X size={18} className="text-gray-400"/></button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type Name * <span className="text-xs text-gray-400">(must be unique)</span>
            </label>
            <input className="input" value={form.name}
              onChange={e => setForm(f => ({...f, name: e.target.value}))}
              placeholder="e.g. Mini Excavator" autoComplete="off" required/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select className="input" value={form.category}
                onChange={e => setForm(f => ({...f, category: e.target.value}))}>
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Daily Rate (KWD)</label>
              <input type="number" min="0" step="0.001" className="input" value={form.default_daily_rate_kwd}
                onChange={e => setForm(f => ({...f, default_daily_rate_kwd: e.target.value}))}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturer</label>
              <input className="input" value={form.manufacturer}
                onChange={e => setForm(f => ({...f, manufacturer: e.target.value}))}
                placeholder="e.g. Liebherr" autoComplete="off"/>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
              {formLoading && <Loader2 size={14} className="animate-spin"/>}
              {formLoading ? 'Creating…' : 'Create Type'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Searchable Equipment Type Selector ──────────────────────────────────────
// Renders the dropdown via a React portal so it is never clipped by an
// ancestor with overflow:hidden/auto (e.g. the receive-modal scroll container).
function EqTypeSelector({ value, eqTypes, onChange, onAddNew }) {
  const [search, setSearch] = useState('');
  const [open,   setOpen]   = useState(false);
  const [pos,    setPos]    = useState({ top: 0, left: 0, width: 200 });
  const triggerRef          = useRef(null);
  const dropRef             = useRef(null);

  const filtered = eqTypes.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedType = eqTypes.find(t => t.type_id === value);

  const calcPos = () => {
    if (!triggerRef.current) return;
    const rect  = triggerRef.current.getBoundingClientRect();
    const dropH = 320;
    const top   = rect.bottom + dropH > window.innerHeight ? rect.top - dropH : rect.bottom + 4;
    setPos({ top, left: rect.left, width: rect.width });
  };

  useEffect(() => {
    // Close only when clicking outside BOTH the trigger and the portal dropdown
    const closeClick = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropRef.current   && !dropRef.current.contains(e.target)
      ) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', closeClick);
    window.addEventListener('scroll', calcPos, true);
    window.addEventListener('resize', calcPos);
    return () => {
      document.removeEventListener('mousedown', closeClick);
      window.removeEventListener('scroll', calcPos, true);
      window.removeEventListener('resize', calcPos);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = () => {
    if (!open) calcPos();
    setOpen(v => !v);
    setSearch('');
  };

  return (
    <div ref={triggerRef} className="relative">
      <button type="button"
        onClick={handleOpen}
        className="input w-full text-left flex items-center justify-between text-sm"
      >
        <span className={selectedType ? 'text-gray-800' : 'text-gray-400'}>
          {selectedType
            ? `${selectedType.name}${selectedType.category ? ` (${selectedType.category})` : ''}`
            : 'Search equipment type…'}
        </span>
        <ChevronDown size={14} className={clsx('text-gray-400 shrink-0 ml-2 transition-transform', open && 'rotate-180')}/>
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[9999] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                autoFocus
                className="input pl-7 text-xs"
                placeholder="Search by name or category…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No types found</p>
            ) : filtered.map(t => (
              <button key={t.type_id} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(t.type_id); setOpen(false); setSearch(''); }}
                className={clsx(
                  'w-full text-left px-4 py-2.5 text-xs border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                  value === t.type_id && 'bg-primary-50'
                )}
              >
                <p className="font-medium text-gray-800">{t.name}</p>
                {t.category && <p className="text-gray-400 text-xs">{t.category}</p>}
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-gray-100">
            <button type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setOpen(false); onAddNew(); }}
              className="w-full flex items-center gap-2 text-xs text-primary-600 hover:bg-primary-50 px-2 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={12}/> Add new equipment type
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Capacity Selector ────────────────────────────────────────────────────────
function CapacitySelector({ typeId, value, onChange, onAddNew }) {
  const [options, setOptions]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [open,    setOpen]      = useState(false);
  const ref                     = useRef(null);

  useEffect(() => {
    if (!typeId) { setOptions([]); return; }
    setLoading(true);
    supabase
      .from('equipment_units')
      .select('capacity')
      .eq('type_id', typeId)
      .then(({ data }) => {
        const unique = [...new Set(
          (data ?? []).map(u => u.capacity?.trim()).filter(Boolean)
        )].sort();
        setOptions(unique);
        setLoading(false);
      });
  }, [typeId]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const display = value || 'Select capacity…';
  const isPlaceholder = !value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={!typeId}
        onClick={() => { if (typeId) setOpen(v => !v); }}
        className={clsx(
          'input w-full text-left flex items-center justify-between text-sm',
          !typeId && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className={isPlaceholder ? 'text-gray-400' : 'text-gray-800'}>{display}</span>
        <ChevronDown size={14} className="text-gray-400 shrink-0 ml-2"/>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
          <div className="max-h-44 overflow-y-auto">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-3">Loading…</p>
            ) : (
              <>
                {/* N/A option always first */}
                <button type="button"
                  onClick={() => { onChange('N/A'); setOpen(false); }}
                  className={clsx(
                    'w-full text-left px-4 py-2.5 text-xs border-b border-gray-50 hover:bg-gray-50 transition-colors',
                    value === 'N/A' && 'bg-primary-50'
                  )}
                >
                  <span className="text-gray-500 italic">N/A — No capacity</span>
                </button>
                {options.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">No existing capacities</p>
                )}
                {options.map(cap => (
                  <button key={cap} type="button"
                    onClick={() => { onChange(cap); setOpen(false); }}
                    className={clsx(
                      'w-full text-left px-4 py-2.5 text-xs border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                      value === cap && 'bg-primary-50'
                    )}
                  >
                    <span className="font-medium text-gray-800">{cap}</span>
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="p-2 border-t border-gray-100">
            <button type="button"
              onClick={() => { setOpen(false); onAddNew(); }}
              className="w-full flex items-center gap-2 text-xs text-primary-600 hover:bg-primary-50 px-2 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={12}/> Add new capacity
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New Capacity Modal ────────────────────────────────────────────────────────
function NewCapacityModal({ onConfirm, onClose }) {
  const [value, setValue] = useState('');
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Add New Capacity</h3>
          <button type="button" onClick={onClose}><X size={16} className="text-gray-400"/></button>
        </div>
        <input
          autoFocus
          className="input text-sm"
          placeholder="e.g. 75 Ton, 20ft, 500L"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) { onConfirm(value.trim()); } }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={() => value.trim() && onConfirm(value.trim())}
            className="btn-primary text-xs"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PO Preview ───────────────────────────────────────────────────────────────
function POPreviewModal({ po, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-semibold text-gray-900">{po.po_number}</h3>
            <p className="text-sm text-gray-400">Purchase Order</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadPurchaseOrderPDF(po, po.procurements?.procurement_items ?? [])}
              className="btn-secondary flex items-center gap-1 text-xs">
              <Download size={13}/> PDF
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20}/></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400">Vendor</p>
              <p className="font-medium text-gray-800">{po.vendors?.name ?? '—'}</p>
              {po.vendors?.contact_person && <p className="text-xs text-gray-400">{po.vendors.contact_person}</p>}
              {po.vendors?.email && <p className="text-xs text-gray-400">{po.vendors.email}</p>}
            </div>
            <div>
              <p className="text-xs text-gray-400">Status</p>
              <StatusBadge status={po.status}/>
              {po.submitted_at && <p className="text-xs text-gray-400 mt-1">Submitted: {format(new Date(po.submitted_at), 'dd MMM yyyy HH:mm')}</p>}
              {po.actual_delivery && <p className="text-xs text-green-600 mt-1">Delivered: {format(new Date(po.actual_delivery), 'dd MMM yyyy')}</p>}
            </div>
            <div>
              <p className="text-xs text-gray-400">Issue Date</p>
              <p className="font-medium">{format(new Date(po.issue_date), 'dd MMM yyyy')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Expected Delivery</p>
              <p className="font-medium">{po.expected_delivery ? format(new Date(po.expected_delivery), 'dd MMM yyyy') : '—'}</p>
            </div>
          </div>

          {po.procurements && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-medium text-blue-600 mb-1">Linked Procurement</p>
              <p className="text-sm font-medium text-blue-800">{po.procurements.procurement_id} — {po.procurements.title}</p>
              <p className="text-xs text-blue-500">Type: {po.procurements.type}</p>
            </div>
          )}

          {po.procurements?.procurement_items?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Items</p>
              <div className="space-y-1">
                {po.procurements.procurement_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                    <div>
                      <p className="font-medium text-gray-700">{item.description}</p>
                      {item.equipment_types?.name && <p className="text-xs text-gray-400">{item.equipment_types.name}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      <p className="font-medium text-gray-700">KWD {Number(item.unit_price_kwd || 0).toLocaleString('en-US', { minimumFractionDigits: 3 })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-3 text-right">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-xl font-bold text-gray-900">KWD {Number(po.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</p>
          </div>

          {po.terms_conditions && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
              <p className="font-medium text-gray-600 mb-1">Terms & Conditions</p>
              <p>{po.terms_conditions}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Procurement Preview ──────────────────────────────────────────────────────
function ProcPreviewModal({ proc, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-900">{proc.procurement_id}</h3>
            <p className="text-sm text-gray-400">{proc.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Type</p>
              <span className={clsx('badge border text-xs', proc.type === 'Purchase' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-purple-50 text-purple-700 border-purple-100')}>{proc.type}</span>
            </div>
            <div><p className="text-xs text-gray-400">Status</p><StatusBadge status={proc.status}/></div>
            <div><p className="text-xs text-gray-400">Vendor</p><p className="font-medium">{proc.vendors?.name ?? '—'}</p></div>
            <div><p className="text-xs text-gray-400">Priority</p><p className="font-medium">{proc.priority}</p></div>
            <div><p className="text-xs text-gray-400">Required By</p><p className="font-medium">{proc.required_by_date ? format(new Date(proc.required_by_date), 'dd MMM yyyy') : '—'}</p></div>
            <div><p className="text-xs text-gray-400">Total (KWD)</p><p className="font-bold text-gray-900">{Number(proc.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</p></div>
          </div>

          {proc.type === 'Lease' && (
            <div className="bg-purple-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-xs">
              <div><p className="text-purple-500">Lease Start</p><p className="font-medium text-purple-800">{proc.lease_start_date ?? '—'}</p></div>
              <div><p className="text-purple-500">Lease End</p><p className="font-medium text-purple-800">{proc.lease_end_date ?? '—'}</p></div>
              <div><p className="text-purple-500">Monthly (KWD)</p><p className="font-medium text-purple-800">{proc.lease_monthly_kwd ?? '—'}</p></div>
            </div>
          )}

          {proc.description && <p className="text-sm text-gray-600">{proc.description}</p>}
          {proc.notes && <p className="text-sm text-gray-500 italic">{proc.notes}</p>}

          {proc.procurement_items?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Items</p>
              {proc.procurement_items.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm mb-1">
                  <div>
                    <p className="font-medium text-gray-700">{item.description}</p>
                    {item.equipment_types?.name && <p className="text-xs text-gray-400">{item.equipment_types.name}</p>}
                    {item.added_to_fleet && <p className="text-xs text-green-600 mt-0.5">✓ Added to fleet · {item.fleet_location}</p>}
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-gray-500">Qty: {item.quantity}</p>
                    <p className="font-medium text-gray-700">KWD {Number(item.unit_price_kwd || 0).toLocaleString()}</p>
                    {item.received_qty > 0 && <p className="text-green-600">Received: {item.received_qty}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {proc.purchase_orders?.length > 0 && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-medium text-blue-600 mb-1">Purchase Orders</p>
              {proc.purchase_orders.map(po => (
                <div key={po.po_id} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-blue-700">{po.po_number}</span>
                  <StatusBadge status={po.status}/>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ProcurementPage() {
  const { profile, role } = useAuth();

  const [tab,         setTab]         = useState('Requests');
  const [procs,       setProcs]       = useState([]);
  const [pos,         setPOs]         = useState([]);
  const [vendors,     setVendors]     = useState([]);
  const [eqTypes,     setEqTypes]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [formLoading, setFormLoading] = useState(false);

  // modal: null | 'proc' | 'po' | 'vendor' | 'vendor-inline' | 'receive' | 'new-eq-type'
  const [showModal,        setShowModal]        = useState(null);
  const [selected,         setSelected]         = useState(null);
  const [previewPO,        setPreviewPO]        = useState(null);
  const [previewProc,      setPreviewProc]      = useState(null);
  const [newCapacityForIdx,   setNewCapacityForIdx]   = useState(null);
  const [receiveNewTypeItemId,       setReceiveNewTypeItemId]       = useState(null);
  const [receiveNewTypeSuggestedName, setReceiveNewTypeSuggestedName] = useState('');

  const canWrite   = hasPermission(role, 'procurement_create');
  const canApprove = hasPermission(role, 'procurement_approve');
  const canPO      = hasPermission(role, 'po_create');
  const canVendor  = hasPermission(role, 'vendor_manage');

  // ── Procurement form ──────────────────────────────────────────────────────
  const [procForm, setProcForm] = useState({
    title:'', description:'', type:'Purchase', vendor_id:'',
    priority:'Normal', required_by_date:'', lease_start_date:'',
    lease_end_date:'', lease_monthly_kwd:'',
    terms_conditions:'Standard procurement terms apply.', notes:'', status:'Draft',
  });
  const [procItems, setProcItems] = useState([{ ...EMPTY_ITEM }]);

  // ── PO form ───────────────────────────────────────────────────────────────
  const [poForm, setPoForm] = useState({
    procurement_id:'', vendor_id:'',
    issue_date: new Date().toISOString().split('T')[0],
    expected_delivery:'', total_amount_kwd:'',
    terms_conditions:'Payment within 30 days upon delivery and inspection.',
    shipping_address:'KW Ops Yard, Kuwait', notes:'', status:'Draft',
  });

  // ── Receive form ──────────────────────────────────────────────────────────
  const [receiveItems, setReceiveItems] = useState([]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, po, v, et] = await Promise.all([
        getProcurements(), getPurchaseOrders(), getVendors(), getEquipmentTypes(),
      ]);
      setProcs(p); setPOs(po); setVendors(v); setEqTypes(et);
    } catch { toast.error('Failed to load procurement data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const ch = supabase.channel('procurement-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'procurements' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, loadAll)
      .subscribe();
    return () => ch.unsubscribe();
  }, [loadAll]);

  // ── Procurement CRUD ──────────────────────────────────────────────────────
  const openProcAdd = () => {
    setProcForm({ title:'', description:'', type:'Purchase', vendor_id:'', priority:'Normal', required_by_date:'', lease_start_date:'', lease_end_date:'', lease_monthly_kwd:'', terms_conditions:'Standard procurement terms apply.', notes:'', status:'Draft' });
    setProcItems([{ ...EMPTY_ITEM }]);
    setSelected(null);
    setShowModal('proc');
  };

  const openProcEdit = (p) => {
    setProcForm({ title:p.title, description:p.description??'', type:p.type, vendor_id:p.vendor_id??'', priority:p.priority??'Normal', required_by_date:p.required_by_date??'', lease_start_date:p.lease_start_date??'', lease_end_date:p.lease_end_date??'', lease_monthly_kwd:p.lease_monthly_kwd??'', terms_conditions:p.terms_conditions??'', notes:p.notes??'', status:p.status });
    setProcItems(p.procurement_items?.length > 0
      ? p.procurement_items.map(i => {
          const desc = i.description ?? '';
          const sep  = desc.indexOf(' — ');
          const capacity = sep !== -1 ? desc.slice(sep + 3) : 'N/A';
          return { description: desc, capacity, quantity: i.quantity, unit: i.unit, unit_price_kwd: i.unit_price_kwd, equipment_type_id: i.equipment_type_id ?? '' };
        })
      : [{ ...EMPTY_ITEM }]);
    setSelected(p);
    setShowModal('proc');
  };

  const handleProcSave = async (e) => {
    e.preventDefault();
    if (!procForm.title.trim()) return toast.error('Enter procurement title');
    if (procItems.some(i => !i.equipment_type_id)) return toast.error('Select an equipment type for every item');
    if (procItems.some(i => !i.capacity)) return toast.error('Select a capacity for every item');

    // Find the type name for each item to build a readable description
    const typeMap = Object.fromEntries(eqTypes.map(t => [t.type_id, t.name]));

    // Strip UI-only `capacity` field — procurement_items has no capacity column.
    // Store it as the description so it flows through to equipment_units.capacity on receive.
    const itemsToSave = procItems.map(({ capacity, ...rest }) => ({
      ...rest,
      description: capacity === 'N/A'
        ? (typeMap[rest.equipment_type_id] ?? rest.description ?? '')
        : `${typeMap[rest.equipment_type_id] ?? ''} — ${capacity}`.trim(),
      equipment_type_id: rest.equipment_type_id || null,
    }));
    setFormLoading(true);
    try {
      if (selected) {
        await updateProcurement(selected.procurement_id, {
          ...procForm,
          required_by_date:  procForm.required_by_date  || null,
          lease_start_date:  procForm.lease_start_date  || null,
          lease_end_date:    procForm.lease_end_date     || null,
          lease_monthly_kwd: procForm.lease_monthly_kwd || null,
          vendor_id:         procForm.vendor_id          || null,
        });
        await supabase.from('procurement_items').delete().eq('procurement_id', selected.procurement_id);
        if (itemsToSave.length > 0) {
          await supabase.from('procurement_items').insert(
            itemsToSave.map(({ description, unit_price_kwd, equipment_type_id }) => ({
              description, unit_price_kwd, equipment_type_id,
              procurement_id: selected.procurement_id,
            }))
          );
        }
        toast.success('Procurement updated');
      } else {
        await createProcurement(
          {
            ...procForm,
            requested_by:      profile.user_id,
            required_by_date:  procForm.required_by_date  || null,
            lease_start_date:  procForm.lease_start_date  || null,
            lease_end_date:    procForm.lease_end_date     || null,
            lease_monthly_kwd: procForm.lease_monthly_kwd || null,
            vendor_id:         procForm.vendor_id          || null,
          },
          itemsToSave
        );
        toast.success('Procurement request created');
      }
      setShowModal(null);
      loadAll();
    } catch (err) { toast.error(err.message || 'Failed to save');
    } finally { setFormLoading(false); }
  };

  const handleProcApprove = async (id, approve) => {
    try {
      await updateProcurement(id, { status: approve ? 'Approved' : 'Rejected', approved_by: profile.user_id });
      toast.success(approve ? 'Approved' : 'Rejected');
      loadAll();
    } catch { toast.error('Action failed'); }
  };

  const handleProcSubmit = async (id) => {
    try {
      await updateProcurement(id, { status: 'Pending Approval' });
      toast.success('Submitted for approval');
      loadAll();
    } catch { toast.error('Failed to submit'); }
  };

  // ── Receive helpers ───────────────────────────────────────────────────────
  const updateReceiveItem = (itemId, field, val) =>
    setReceiveItems(prev => prev.map(it => it.item_id === itemId ? { ...it, [field]: val } : it));

  const updateReceiveUnit = (itemId, unitIdx, field, val) =>
    setReceiveItems(prev => prev.map(it => {
      if (it.item_id !== itemId) return it;
      const units = it.units.map((u, i) => i === unitIdx ? { ...u, [field]: val } : u);
      return { ...it, units };
    }));

  const updateReceiveItemType = async (itemId, typeId, typeName, qty) => {
    const category = eqTypes.find(t => t.type_id === typeId)?.category ?? '';
    setReceiveItems(prev => prev.map(it => it.item_id !== itemId ? it : {
      ...it,
      equipment_type_id:       typeId,
      equipment_type_name:     typeName,
      equipment_type_category: category,
      typeAutoMatched:         false,
      showTypeOverride:        false,
      loadingSuggestions:      true,
    }));
    try {
      const { data: existing } = await supabase
        .from('equipment_units')
        .select('serial_number')
        .eq('type_id', typeId)
        .not('serial_number', 'is', null);
      const dbSerials = (existing ?? []).map(u => u.serial_number);

      // Read LATEST state inside the updater to avoid stale-closure duplicates
      // when two items of the same type update in quick succession.
      setReceiveItems(prev => {
        const sessionSerials = prev
          .filter(it => it.item_id !== itemId && it.equipment_type_id === typeId)
          .flatMap(it => it.units.map(u => (u.serial || u.suggestion || '').trim()).filter(Boolean));

        const suggestions = suggestNextSerials(typeName, dbSerials, qty ?? 1, sessionSerials);
        return prev.map(it => it.item_id !== itemId ? it : {
          ...it,
          loadingSuggestions: false,
          units: it.units.map((u, i) => ({ ...u, suggestion: suggestions[i] ?? '', serial: suggestions[i] ?? '' })),
        });
      });
    } catch {
      setReceiveItems(prev => prev.map(it => it.item_id !== itemId ? it : { ...it, loadingSuggestions: false }));
    }
  };

  // ── Receive ───────────────────────────────────────────────────────────────
  const openReceive = async (proc) => {
    const today = new Date().toISOString().split('T')[0];
    setSelected(proc);

    // Case-insensitive name match against the loaded equipment types list.
    // Auto-generated procurement items from quotations have no equipment_type_id —
    // this catches them so serial suggestions fire without the user having to select.
    const autoMatchType = (desc) => {
      if (!desc || !eqTypes.length) return null;
      const typePart = (desc.includes(' — ') ? desc.split(' — ')[0] : desc).toLowerCase().trim();
      return eqTypes.find(t => t.name.toLowerCase().trim() === typePart) ?? null;
    };

    const initial = (proc.procurement_items ?? []).map(item => {
      const desc = item.description ?? '';
      const sep  = desc.indexOf(' — ');
      const capacity = sep !== -1 ? desc.slice(sep + 3).trim() : '';

      let typeId          = item.equipment_type_id ?? null;
      let typeName        = item.equipment_types?.name ?? '';
      let typeCategory    = item.equipment_types?.category ?? '';
      let typeAutoMatched = false;

      if (!typeId) {
        const matched = autoMatchType(desc);
        if (matched) {
          typeId          = matched.type_id;
          typeName        = matched.name;
          typeCategory    = matched.category ?? '';
          typeAutoMatched = true;
        } else {
          // No match — extract display name from description prefix
          typeName = sep !== -1 ? desc.slice(0, sep).trim() : desc;
        }
      } else {
        typeCategory = eqTypes.find(t => t.type_id === typeId)?.category ?? '';
      }

      return {
        item_id:             item.item_id,
        description:         desc,
        capacity,
        equipment_type_id:   typeId,
        equipment_type_name: typeName,
        equipment_type_category: typeCategory,
        typeAutoMatched,
        showTypeOverride:    false,   // toggle inline type-change selector
        quantity:            item.quantity ?? 1,
        received_date:       today,
        location:            'Yard',
        daily_rate_kwd:      item.unit_price_kwd ? String(item.unit_price_kwd) : '',
        procurement_type:    proc.type ?? 'Purchase',
        lease_start:         proc.lease_start_date ?? '',
        lease_end:           proc.lease_end_date   ?? '',
        units:               Array.from({ length: item.quantity ?? 1 }, () => ({ serial: '', suggestion: '', error: '' })),
        loadingSuggestions:  !!typeId,
      };
    });

    setReceiveItems(initial);
    setShowModal('receive');

    // Fetch existing serials for all type_ids (including auto-matched) in a
    // single round-trip. Process items in order so that multiple items of the
    // same type in ONE procurement don't collide (CC003 → CC004, not CC003 × 2).
    const typeIds = [...new Set(initial.filter(i => i.equipment_type_id).map(i => i.equipment_type_id))];
    if (!typeIds.length) return;

    try {
      const { data: existing } = await supabase
        .from('equipment_units')
        .select('serial_number, type_id')
        .in('type_id', typeIds)
        .not('serial_number', 'is', null);

      const dbByType = {};
      for (const u of existing ?? []) {
        if (!dbByType[u.type_id]) dbByType[u.type_id] = [];
        dbByType[u.type_id].push(u.serial_number);
      }

      // sessionByType accumulates serials "used" earlier in THIS procurement
      // so two CC items in the same request get CC003 and CC004, not CC003 twice.
      const sessionByType = {};
      const withSuggestions = initial.map(item => {
        if (!item.equipment_type_id) return { ...item, loadingSuggestions: false };

        const dbSerials   = dbByType[item.equipment_type_id] ?? [];
        const session     = sessionByType[item.equipment_type_id] ?? [];
        const suggestions = suggestNextSerials(item.equipment_type_name, dbSerials, item.quantity, session);

        sessionByType[item.equipment_type_id] = [...session, ...suggestions];

        return {
          ...item,
          loadingSuggestions: false,
          units: item.units.map((u, i) => ({
            ...u,
            suggestion: suggestions[i] ?? '',
            serial:     suggestions[i] ?? '',
          })),
        };
      });

      // Safety dedup pass: if any two units across all items got the same
      // suggestion (e.g. sessionByType mismatch on type_id casing), bump the
      // duplicate forward to the next available serial.
      const globalUsed = new Set();
      const deduped = withSuggestions.map(item => {
        if (!item.equipment_type_id) return item;
        const units = item.units.map(u => {
          const s0 = u.serial;
          if (!s0) return u;
          let s = s0;
          let p = parseSerial(s);
          while (globalUsed.has(s.toUpperCase())) {
            if (p) {
              p = { ...p, num: p.num + 1 };
              s = `${p.prefix}${String(p.num).padStart(p.padLen, '0')}`;
            } else {
              break;
            }
          }
          globalUsed.add(s.toUpperCase());
          return s !== s0 ? { ...u, serial: s, suggestion: s } : u;
        });
        return { ...item, units };
      });

      setReceiveItems(deduped);
    } catch {
      setReceiveItems(prev => prev.map(it => ({ ...it, loadingSuggestions: false })));
    }
  };

  const handleReceive = async (e) => {
    e.preventDefault();

    // Warn about items that have no equipment type — they'll be marked received
    // but won't be added to the fleet.
    const unlinked = receiveItems.filter(it => !it.equipment_type_id);
    if (unlinked.length > 0 && receiveItems.length > 0) {
      const names = unlinked.map(it => `"${it.description}"`).join(', ');
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        `${unlinked.length} item(s) have no equipment type linked and will NOT be added to the fleet:\n${names}\n\nSelect an equipment type for each item to enable fleet tracking.\n\nProceed without fleet tracking for these items?`
      );
      if (!ok) return;
    }

    const allSerials = [];
    for (const item of receiveItems) {
      if (!item.equipment_type_id) continue;
      if (!item.daily_rate_kwd || Number(item.daily_rate_kwd) <= 0) {
        return toast.error(`Enter a daily rate for: ${item.equipment_type_name || item.description}`);
      }
      for (let i = 0; i < item.quantity; i++) {
        const serial = item.units[i]?.serial?.trim() ?? '';
        if (!serial) return toast.error(`Enter serial number for unit ${i + 1} of: ${item.equipment_type_name || item.description}`);
        if (allSerials.includes(serial)) return toast.error(`Duplicate serial "${serial}" — every unit needs a unique serial number`);
        allSerials.push(serial);
      }
    }

    setFormLoading(true);
    try {
      // Map new structure → format expected by receiveProcurement API
      const apiItems = receiveItems.map(item => ({
        item_id:           item.item_id,
        description:       item.description,
        equipment_type_id: item.equipment_type_id,
        quantity:          item.quantity,
        received_qty:      item.quantity,
        received_date:     item.received_date,
        fleet_location:    item.location,
        daily_rate_kwd:    item.daily_rate_kwd,
        procurement_type:  item.procurement_type,
        lease_start:       item.lease_start,
        lease_end:         item.lease_end,
        capacity:          item.capacity?.trim() || null,
        serial_numbers:    item.units.map(u => u.serial?.trim() ?? ''),
      }));
      await receiveProcurement(selected.procurement_id, apiItems, profile.user_id);
      toast.success('Procurement received — items added to equipment fleet');
      setShowModal(null);
      loadAll();
    } catch (err) {
      if (err.message?.includes('serial_number') || err.code === '23505') {
        toast.error('One or more serial numbers already exist in the fleet. Please use unique serial numbers.');
      } else {
        toast.error(err.message || 'Failed to receive');
      }
    } finally { setFormLoading(false); }
  };

  // ── PO ────────────────────────────────────────────────────────────────────
  const openPOAdd = (proc = null) => {
    setPoForm({
      procurement_id:   proc?.procurement_id ?? '',
      vendor_id:        proc?.vendor_id ?? '',
      total_amount_kwd: proc?.total_amount_kwd ?? '',
      issue_date:       new Date().toISOString().split('T')[0],
      expected_delivery: '',
      terms_conditions: 'Payment within 30 days upon delivery and inspection.',
      shipping_address: 'KW Ops Yard, Kuwait',
      notes: '', status: 'Draft',
    });
    setSelected(proc);
    setShowModal('po');
  };

  const handlePOSave = async (e) => {
    e.preventDefault();
    if (!poForm.vendor_id)        return toast.error('Select vendor');
    if (!poForm.total_amount_kwd) return toast.error('Enter amount');
    setFormLoading(true);
    try {
      await createPurchaseOrder({ ...poForm, created_by: profile.user_id });
      if (poForm.procurement_id) await updateProcurement(poForm.procurement_id, { status: 'PO Issued' });
      toast.success('Purchase Order created');
      setShowModal(null);
      loadAll();
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  const handleSubmitPO = async (po) => {
    try { await submitPurchaseOrder(po.po_id); toast.success('PO submitted'); loadAll(); }
    catch { toast.error('Failed to submit PO'); }
  };

  const handleDelivered = async (po) => {
    try {
      await updatePurchaseOrder(po.po_id, {
        status: 'Delivered',
        actual_delivery: new Date().toISOString().split('T')[0],
      });
      // Also mark the linked procurement as Delivered so Receive button appears
      if (po.procurement_id) {
        await updateProcurement(po.procurement_id, { status: 'Delivered' });
      }
      toast.success('Marked as delivered — you can now receive items in the Requests tab');
      loadAll();
    } catch { toast.error('Failed to mark as delivered'); }
  };

  // ── Vendor ────────────────────────────────────────────────────────────────
  const handleVendorCreated = async (newVendor) => {
    const updated = await getVendors();
    setVendors(updated);
    if (showModal === 'vendor-inline') {
      setProcForm(f => ({ ...f, vendor_id: newVendor.vendor_id }));
      setShowModal('proc');
    } else if (showModal === 'vendor-po') {
      setPoForm(f => ({ ...f, vendor_id: newVendor.vendor_id }));
      setShowModal('po');
    } else {
      setShowModal(null);
    }
  };

  // ── Equipment type created from procurement form ───────────────────────────
  const handleEqTypeCreated = async (newType) => {
    const updated = await getEquipmentTypes();
    setEqTypes(updated);
    setShowModal('proc');
  };

  // ── Equipment type created while in receive modal ──────────────────────────
  const handleEqTypeCreatedForReceive = async (newType) => {
    const updated = await getEquipmentTypes();
    setEqTypes(updated);
    if (receiveNewTypeItemId) {
      const item = receiveItems.find(it => it.item_id === receiveNewTypeItemId);
      updateReceiveItemType(receiveNewTypeItemId, newType.type_id, newType.name, item?.quantity ?? 1);
      setReceiveNewTypeItemId(null);
      setReceiveNewTypeSuggestedName('');
    }
    setShowModal('receive');
  };

  // ── Proc items helpers ────────────────────────────────────────────────────
  const addProcItem    = () => setProcItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeProcItem = (idx) => {
    if (procItems.length === 1) return toast.error('At least one item required');
    setProcItems(i => i.filter((_, j) => j !== idx));
  };
  const setProcItem = (idx, field, val) =>
    setProcItems(items => items.map((item, i) => i === idx ? { ...item, [field]: val } : item));

  const procTotal = procItems.reduce((s, i) => s + Number(i.unit_price_kwd || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Procurement</h2>
          <p className="text-sm text-gray-400">Purchases, leases, POs, and vendors</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadAll} className="btn-secondary p-2"><RefreshCw size={16}/></button>
          {canWrite  && <button onClick={openProcAdd}             className="btn-primary flex items-center gap-2"><Plus size={16}/> New Request</button>}
          {canPO     && <button onClick={() => openPOAdd()}       className="btn-secondary flex items-center gap-2"><FileText size={15}/> New PO</button>}
          {canVendor && <button onClick={() => setShowModal('vendor')} className="btn-secondary flex items-center gap-2"><Plus size={15}/> Add Vendor</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="card p-1 flex gap-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50')}>
            {t}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner fullscreen={false}/> : (
        <>
          {/* ── Requests Tab ── */}
          {tab === 'Requests' && (
            procs.length === 0 ? <EmptyState message="No procurement requests" icon={ShoppingCart}/> : (
              <>
                <div className="card hidden md:block overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">ID</th>
                        <th className="text-left px-5 py-3">Title</th>
                        <th className="text-left px-5 py-3">Type</th>
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-right px-5 py-3">Total (KWD)</th>
                        <th className="text-left px-5 py-3">Required By</th>
                        <th className="text-left px-5 py-3">PO</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-left px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {procs.map(p => {
                        const linkedPO = pos.find(po => po.procurement_id === p.procurement_id);
                        // Show Receive button when:
                        //  1. Procurement itself is 'Delivered', OR
                        //  2. The linked PO status is 'Delivered' (in case procurement wasn't synced)
                        // And not already Received
                        const poIsDelivered = linkedPO?.status === 'Delivered';
                        const canReceive = canWrite &&
                          p.status !== 'Received' &&
                          p.status !== 'Cancelled' &&
                          p.status !== 'Rejected' &&
                          (p.status === 'Delivered' || poIsDelivered);
                        return (
                          <tr key={p.procurement_id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-mono text-xs text-gray-400">{p.procurement_id}</td>
                            <td className="px-5 py-3 max-w-xs">
                              <p className="font-medium text-gray-800 truncate">{p.title}</p>
                              {p.notes && <p className="text-xs text-gray-400 truncate">{p.notes}</p>}
                            </td>
                            <td className="px-5 py-3">
                              <span className={clsx('badge border text-xs',
                                p.type === 'Purchase' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-purple-50 text-purple-700 border-purple-100')}>
                                {p.type}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-gray-500 text-xs">{p.vendors?.name ?? '—'}</td>
                            <td className="px-5 py-3 text-right font-medium text-gray-700">
                              {Number(p.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                            </td>
                            <td className="px-5 py-3 text-gray-400 text-xs">
                              {p.required_by_date ? format(new Date(p.required_by_date), 'dd MMM yyyy') : '—'}
                            </td>
                            <td className="px-5 py-3">
                              {linkedPO ? (
                                <button onClick={() => setPreviewPO(linkedPO)}
                                  className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-mono">
                                  <Eye size={11}/> {linkedPO.po_number}
                                  {poIsDelivered && (
                                    <span className="ml-1 text-green-600 font-sans">✓</span>
                                  )}
                                </button>
                              ) : <span className="text-gray-300 text-xs">No PO</span>}
                            </td>
                            <td className="px-5 py-3"><StatusBadge status={p.status}/></td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button onClick={() => setPreviewProc(p)} className="text-gray-400 hover:text-gray-600" title="Preview">
                                  <Eye size={14}/>
                                </button>
                                {canWrite && p.status === 'Draft' && (
                                  <>
                                    <button onClick={() => openProcEdit(p)} className="text-xs text-primary-500 hover:underline">Edit</button>
                                    <button onClick={() => handleProcSubmit(p.procurement_id)} className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg">Submit</button>
                                  </>
                                )}
                                {canApprove && p.status === 'Pending Approval' && (
                                  <>
                                    <button onClick={() => handleProcApprove(p.procurement_id, true)}  className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg">✓</button>
                                    <button onClick={() => handleProcApprove(p.procurement_id, false)} className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-lg">✗</button>
                                  </>
                                )}
                                {canPO && p.status === 'Approved' && (
                                  <button onClick={() => openPOAdd(p)} className="text-xs bg-purple-500 text-white px-2 py-1 rounded-lg">→ PO</button>
                                )}
                                {canReceive && (
                                  <button onClick={() => openReceive(p)}
                                    className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1 font-medium shadow-sm">
                                    <Package size={11}/> Receive
                                  </button>
                                )}
                                {p.status === 'Received' && (
                                  <span className="text-xs text-green-600 flex items-center gap-1">
                                    <CheckCircle size={12}/> Received
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile */}
                <div className="md:hidden space-y-3">
                  {procs.map(p => {
                    const linkedPO = pos.find(po => po.procurement_id === p.procurement_id);
                    const poIsDelivered = linkedPO?.status === 'Delivered';
                    const canReceive = canWrite &&
                      p.status !== 'Received' &&
                      p.status !== 'Cancelled' &&
                      p.status !== 'Rejected' &&
                      (p.status === 'Delivered' || poIsDelivered);
                    return (
                      <div key={p.procurement_id} className="card p-4">
                        <div className="flex justify-between items-start mb-1">
                          <p className="font-medium text-gray-800 flex-1 pr-2">{p.title}</p>
                          <StatusBadge status={p.status}/>
                        </div>
                        <p className="text-xs text-gray-400">{p.procurement_id} · {p.type} · {p.vendors?.name ?? 'No vendor'}</p>
                        {p.notes && <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>}
                        {linkedPO && (
                          <button onClick={() => setPreviewPO(linkedPO)} className="text-xs text-primary-600 flex items-center gap-1 mt-1">
                            <Eye size={11}/> {linkedPO.po_number}
                            {poIsDelivered && <span className="text-green-600">✓ Delivered</span>}
                          </button>
                        )}
                        <p className="text-sm font-semibold text-gray-700 mt-1">KWD {Number(p.total_amount_kwd).toLocaleString()}</p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          <button onClick={() => setPreviewProc(p)} className="text-xs btn-secondary flex items-center gap-1"><Eye size={12}/> Preview</button>
                          {canWrite && p.status === 'Draft' && <button onClick={() => handleProcSubmit(p.procurement_id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg">Submit</button>}
                          {canApprove && p.status === 'Pending Approval' && <button onClick={() => handleProcApprove(p.procurement_id, true)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg">Approve</button>}
                          {canPO && p.status === 'Approved' && <button onClick={() => openPOAdd(p)} className="text-xs bg-purple-500 text-white px-3 py-1 rounded-lg">Create PO</button>}
                          {canReceive && (
                            <button onClick={() => openReceive(p)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg flex items-center gap-1 font-medium">
                              <Package size={11}/> Receive
                            </button>
                          )}
                          {p.status === 'Received' && (
                            <span className="text-xs text-green-600 flex items-center gap-1 px-2 py-1 bg-green-50 rounded-lg">
                              <CheckCircle size={12}/> Received
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )
          )}

          {/* ── POs Tab ── */}
          {tab === 'Purchase Orders' && (
            pos.length === 0 ? <EmptyState message="No purchase orders" icon={FileText}/> : (
              <>
                <div className="card hidden md:block overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">PO Number</th>
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-left px-5 py-3">Issue Date</th>
                        <th className="text-left px-5 py-3">Expected Delivery</th>
                        <th className="text-right px-5 py-3">Total (KWD)</th>
                        <th className="text-left px-5 py-3">Submitted</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-left px-5 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pos.map(po => (
                        <tr key={po.po_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-mono text-xs text-gray-700 font-medium">{po.po_number}</td>
                          <td className="px-5 py-3 text-gray-800">{po.vendors?.name ?? '—'}</td>
                          <td className="px-5 py-3 text-gray-400 text-xs">{format(new Date(po.issue_date), 'dd MMM yyyy')}</td>
                          <td className="px-5 py-3 text-gray-400 text-xs">{po.expected_delivery ? format(new Date(po.expected_delivery), 'dd MMM yyyy') : '—'}</td>
                          <td className="px-5 py-3 text-right font-semibold text-gray-800">{Number(po.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</td>
                          <td className="px-5 py-3 text-xs">{po.submitted_at ? <span className="text-green-600">{format(new Date(po.submitted_at), 'dd MMM HH:mm')}</span> : <span className="text-gray-300">Not submitted</span>}</td>
                          <td className="px-5 py-3"><StatusBadge status={po.status}/></td>
                          <td className="px-5 py-3 flex items-center gap-2">
                            <button onClick={() => setPreviewPO(po)} className="text-gray-400 hover:text-gray-600"><Eye size={15}/></button>
                            <button onClick={() => downloadPurchaseOrderPDF(po, po.procurements?.procurement_items ?? [])} className="text-gray-400 hover:text-gray-600"><Download size={15}/></button>
                            {po.status === 'Draft' && <button onClick={() => handleSubmitPO(po)} className="text-xs bg-blue-500 text-white px-2 py-1 rounded-lg flex items-center gap-1"><Send size={11}/> Submit</button>}
                            {['Submitted','Acknowledged','Partially Delivered'].includes(po.status) && (
                              <button onClick={() => handleDelivered(po)} className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1"><CheckCircle size={11}/> Delivered</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden space-y-3">
                  {pos.map(po => (
                    <div key={po.po_id} className="card p-4">
                      <div className="flex justify-between mb-1">
                        <p className="font-medium text-gray-800 font-mono text-sm">{po.po_number}</p>
                        <StatusBadge status={po.status}/>
                      </div>
                      <p className="text-xs text-gray-500">{po.vendors?.name}</p>
                      <p className="text-sm font-bold text-gray-800 mt-1">KWD {Number(po.total_amount_kwd).toLocaleString()}</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => setPreviewPO(po)} className="text-xs btn-secondary flex items-center gap-1"><Eye size={12}/> Preview</button>
                        <button onClick={() => downloadPurchaseOrderPDF(po, [])} className="text-xs btn-secondary flex items-center gap-1"><Download size={12}/> PDF</button>
                        {po.status === 'Draft' && <button onClick={() => handleSubmitPO(po)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg">Submit</button>}
                        {['Submitted','Acknowledged'].includes(po.status) && <button onClick={() => handleDelivered(po)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg">Delivered</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}

          {/* ── Vendors Tab ── */}
          {tab === 'Vendors' && (
            <>
              <div className="flex justify-end">
                {canVendor && (
                  <button onClick={() => setShowModal('vendor')} className="btn-primary flex items-center gap-2"><Plus size={15}/> Add Vendor</button>
                )}
              </div>
              {vendors.length === 0 ? <EmptyState message="No vendors" icon={ShoppingCart}/> : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-left px-5 py-3">Contact</th>
                        <th className="text-left px-5 py-3">Category</th>
                        <th className="text-left px-5 py-3">Payment Terms</th>
                        <th className="text-left px-5 py-3">Country</th>
                        <th className="text-left px-5 py-3">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {vendors.map(v => (
                        <tr key={v.vendor_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3"><p className="font-medium text-gray-800">{v.name}</p><p className="text-xs text-gray-400">{v.vendor_id}</p></td>
                          <td className="px-5 py-3"><p className="text-gray-600">{v.contact_person ?? '—'}</p><p className="text-xs text-gray-400">{v.email ?? ''}</p></td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{v.category ?? '—'}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{v.payment_terms ?? '—'}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{v.country}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{v.phone ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Procurement Form Modal ── */}
      {showModal === 'proc' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{selected ? 'Edit Procurement' : 'New Procurement Request'}</h3>
              <button onClick={() => setShowModal(null)}><X size={18} className="text-gray-400"/></button>
            </div>
            <form onSubmit={handleProcSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input className="input" value={procForm.title}
                  onChange={e => setProcForm(f => ({...f, title: e.target.value}))}
                  placeholder="e.g. 2x Forklifts for Ahmadi Depot" required/>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                  <select className="input" value={procForm.type} onChange={e => setProcForm(f => ({...f, type: e.target.value}))}>
                    <option value="Purchase">Purchase</option>
                    <option value="Lease">Lease</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select className="input" value={procForm.priority} onChange={e => setProcForm(f => ({...f, priority: e.target.value}))}>
                    {['Low','Normal','High','Urgent'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              {/* Vendor with inline add */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                <div className="flex gap-2">
                  <select className="input flex-1" value={procForm.vendor_id}
                    onChange={e => setProcForm(f => ({...f, vendor_id: e.target.value}))}>
                    <option value="">Select vendor…</option>
                    {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowModal('vendor-inline')}
                    className="btn-secondary px-3 text-xs whitespace-nowrap flex items-center gap-1 shrink-0">
                    <Plus size={12}/> New Vendor
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Required By Date</label>
                <input type="date" className="input" value={procForm.required_by_date}
                  onChange={e => setProcForm(f => ({...f, required_by_date: e.target.value}))}/>
              </div>

              {procForm.type === 'Lease' && (
                <div className="grid grid-cols-3 gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">
                  <div>
                    <label className="block text-xs font-medium text-purple-700 mb-1">Lease Start</label>
                    <input type="date" className="input text-sm" value={procForm.lease_start_date}
                      onChange={e => setProcForm(f => ({...f, lease_start_date: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-700 mb-1">Lease End</label>
                    <input type="date" className="input text-sm" value={procForm.lease_end_date}
                      onChange={e => setProcForm(f => ({...f, lease_end_date: e.target.value}))}/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-700 mb-1">Monthly (KWD)</label>
                    <input type="number" className="input text-sm" value={procForm.lease_monthly_kwd}
                      onChange={e => setProcForm(f => ({...f, lease_monthly_kwd: e.target.value}))}/>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea className="input" rows={2} value={procForm.description}
                  onChange={e => setProcForm(f => ({...f, description: e.target.value}))}/>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={procForm.notes}
                  placeholder="Any additional notes…"
                  onChange={e => setProcForm(f => ({...f, notes: e.target.value}))}/>
              </div>

              {/* Line items with searchable type selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Items</label>
                  <button type="button" onClick={addProcItem}
                    className="text-xs text-primary-500 hover:underline flex items-center gap-1">
                    <Plus size={12}/> Add Item
                  </button>
                </div>
                <div className="space-y-3">
                  {procItems.map((item, idx) => (
                    <div key={idx} className="border border-gray-100 rounded-xl p-4 bg-gray-50/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-500">Item {idx + 1}</p>
                        <div className="flex items-center gap-2">
                          {/* Duplicate button */}
                          <button
                            type="button"
                            title="Duplicate item"
                            onClick={() => setProcItems(items => {
                              const copy = [...items];
                              copy.splice(idx + 1, 0, { ...item });
                              return copy;
                            })}
                            className="text-xs text-primary-500 hover:text-primary-700 px-2 py-0.5 rounded-lg border border-primary-200 hover:bg-primary-50 transition-colors"
                          >
                            + Duplicate
                          </button>
                          <button type="button" onClick={() => removeProcItem(idx)}
                            className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                        </div>
                      </div>

                      {/* Equipment type — searchable */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Equipment Type *</label>
                        <EqTypeSelector
                          value={item.equipment_type_id}
                          eqTypes={eqTypes}
                          onChange={val => setProcItems(items => items.map((it, i) =>
                            i === idx ? { ...it, equipment_type_id: val, capacity: '' } : it
                          ))}
                          onAddNew={() => setShowModal('new-eq-type')}
                        />
                      </div>

                      {/* Capacity selector — shown once type is picked */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          Capacity {item.equipment_type_id ? '*' : <span className="text-gray-300">(select type first)</span>}
                        </label>
                        <CapacitySelector
                          typeId={item.equipment_type_id}
                          value={item.capacity}
                          onChange={val => setProcItems(items => items.map((it, i) =>
                            i === idx ? { ...it, capacity: val } : it
                          ))}
                          onAddNew={() => setNewCapacityForIdx(idx)}
                        />
                      </div>

                      {/* Unit Price only — qty and unit removed as per requirements */}
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-7 sm:col-span-8">
                          <label className="block text-xs text-gray-500 mb-1">Unit Price (KWD)</label>
                          <input type="number" min="0" step="0.001" className="input text-sm" placeholder="0.000"
                            value={item.unit_price_kwd} onChange={e => setProcItem(idx, 'unit_price_kwd', e.target.value)}/>
                        </div>
                        <div className="col-span-5 sm:col-span-4 text-right text-xs font-medium text-gray-500 pb-2">
                          KWD {Number(item.unit_price_kwd || 0).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-right mt-2 text-sm font-semibold text-gray-700 pr-1">
                  Total: KWD {procTotal.toLocaleString('en-US', { minimumFractionDigits: 3 })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
                <textarea className="input" rows={2} value={procForm.terms_conditions}
                  onChange={e => setProcForm(f => ({...f, terms_conditions: e.target.value}))}/>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Saving…' : selected ? 'Update' : 'Create Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Receive Modal ── */}
      {showModal === 'receive' && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          style={{ animation: 'rcvFadeIn 0.2s ease' }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
            style={{ animation: 'rcvSlideUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <Package size={17} className="text-emerald-600"/>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Receive Procurement</h3>
                  <p className="text-xs text-gray-400 truncate max-w-xs">{selected.procurement_id} — {selected.title}</p>
                </div>
              </div>
              <button onClick={() => setShowModal(null)} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-50">
                <X size={18}/>
              </button>
            </div>

            <form onSubmit={handleReceive} className="flex-1 overflow-y-auto">
              <div className="px-6 py-4 space-y-4">

                {/* Info banner */}
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-1.5">
                  <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                    <CheckCircle size={14}/> Confirming receipt will:
                  </p>
                  <div className="space-y-1">
                    {[
                      'Add each unit to the equipment fleet with its serial number',
                      'Update procurement status to Received',
                      'Mark the linked Purchase Order as Delivered',
                    ].map((txt, i) => (
                      <p key={i} className="text-xs text-emerald-700 flex items-center gap-2 pl-1">
                        <ArrowRight size={10} className="shrink-0 text-emerald-400"/>
                        {txt}
                      </p>
                    ))}
                  </div>
                </div>

                {/* Item cards */}
                {receiveItems.map((item, itemIdx) => {
                  // Pre-compute duplicate serial set for this render
                  const allSerialsFlat = receiveItems.flatMap(it =>
                    it.equipment_type_id ? it.units.map(u => u.serial?.trim()).filter(Boolean) : []
                  );
                  const dupSet = new Set(
                    allSerialsFlat.filter((s, i, arr) => arr.indexOf(s) !== i)
                  );

                  return (
                    <div
                      key={item.item_id}
                      className="border border-gray-200 rounded-xl overflow-visible transition-all duration-200 hover:border-gray-300 hover:shadow-sm"
                      style={{ animation: `rcvFadeSlide 0.3s ease ${itemIdx * 70}ms both` }}
                    >
                      {/* Item header row */}
                      <div className={clsx(
                        'px-4 py-3 flex items-start gap-3 border-b rounded-t-xl',
                        item.equipment_type_id
                          ? 'bg-gray-50 border-gray-100'
                          : 'bg-amber-50/60 border-amber-100'
                      )}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-800 truncate">{item.description}</p>
                            {item.typeAutoMatched && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200 shrink-0"
                                style={{ animation: 'rcvPopIn 0.25s ease' }}>
                                <Sparkles size={9}/> Type matched
                              </span>
                            )}
                            {!item.equipment_type_id && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                                <AlertCircle size={9}/> No type linked
                              </span>
                            )}
                          </div>
                          {item.equipment_type_id && (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <p className="text-xs text-gray-500 font-medium">{item.equipment_type_name}</p>
                              {item.equipment_type_category && (
                                <span className="text-xs text-gray-400 px-1.5 py-0.5 rounded bg-gray-100">
                                  {item.equipment_type_category}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => updateReceiveItem(item.item_id, 'showTypeOverride', !item.showTypeOverride)}
                                className={clsx(
                                  'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border transition-colors',
                                  item.showTypeOverride
                                    ? 'bg-primary-100 text-primary-700 border-primary-200'
                                    : 'text-primary-600 border-primary-200 hover:bg-primary-50'
                                )}
                              >
                                <RotateCcw size={9}/> {item.showTypeOverride ? 'Cancel change' : 'Change type'}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                            item.procurement_type === 'Lease' ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-blue-50 text-blue-700 border-blue-100')}>
                            {item.procurement_type}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                            {item.quantity} {item.quantity === 1 ? 'unit' : 'units'}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 space-y-4">
                        {/* Shared fields */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                              <MapPin size={10}/> Location
                            </label>
                            <input className="input text-sm" placeholder="e.g. Ahmadi Depot"
                              value={item.location}
                              onChange={e => updateReceiveItem(item.item_id, 'location', e.target.value)}/>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                              <Calendar size={10}/> Received Date
                            </label>
                            <input type="date" className="input text-sm"
                              value={item.received_date}
                              onChange={e => updateReceiveItem(item.item_id, 'received_date', e.target.value)}/>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Source Type</label>
                            <select className="input text-sm" value={item.procurement_type}
                              onChange={e => updateReceiveItem(item.item_id, 'procurement_type', e.target.value)}>
                              <option value="Purchase">Purchase</option>
                              <option value="Lease">Lease</option>
                            </select>
                          </div>

                          {item.equipment_type_id && (
                            <>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">
                                  Daily Rate (KWD) <span className="text-red-400">*</span>
                                </label>
                                <input type="number" min="0" step="0.001" className="input text-sm" placeholder="0.000"
                                  value={item.daily_rate_kwd}
                                  onChange={e => updateReceiveItem(item.item_id, 'daily_rate_kwd', e.target.value)}/>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Capacity</label>
                                <input className="input text-sm" placeholder="e.g. 25 Ton, 20ft"
                                  value={item.capacity}
                                  onChange={e => updateReceiveItem(item.item_id, 'capacity', e.target.value)}/>
                              </div>
                            </>
                          )}

                          {item.procurement_type === 'Lease' && (
                            <>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Lease Start</label>
                                <input type="date" className="input text-sm" value={item.lease_start}
                                  onChange={e => updateReceiveItem(item.item_id, 'lease_start', e.target.value)}/>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Lease / Return End</label>
                                <input type="date" className="input text-sm" value={item.lease_end}
                                  onChange={e => updateReceiveItem(item.item_id, 'lease_end', e.target.value)}/>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Serial numbers — one per physical unit */}
                        {item.equipment_type_id ? (
                          <div className="space-y-2">
                            {/* Header row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                                <Hash size={11}/> Serial Numbers
                                <span className="text-red-400">*</span>
                              </p>
                              {item.loadingSuggestions && (
                                <span className="text-xs text-primary-500 flex items-center gap-1" style={{ animation: 'rcvFadeSlide 0.2s ease' }}>
                                  <Loader2 size={10} className="animate-spin"/> Generating suggestions…
                                </span>
                              )}
                              {!item.loadingSuggestions && item.units[0]?.suggestion && (
                                <span className="text-xs text-emerald-600 flex items-center gap-1" style={{ animation: 'rcvPopIn 0.25s ease' }}>
                                  <Sparkles size={10}/> Auto-suggested from fleet history
                                </span>
                              )}
                              {!item.loadingSuggestions && !item.units[0]?.suggestion && (
                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                  No existing units — first in fleet
                                </span>
                              )}
                            </div>

                            {/* Per-unit serial inputs */}
                            <div className="space-y-2">
                              {item.units.map((unit, unitIdx) => {
                                const serial      = unit.serial?.trim() ?? '';
                                const isDup       = serial && dupSet.has(serial);
                                const matchesSug  = serial && unit.suggestion && serial === unit.suggestion;
                                const hasSug      = !!unit.suggestion;
                                const diffFromSug = hasSug && serial && serial !== unit.suggestion;
                                const isEmpty     = !serial;

                                return (
                                  <div
                                    key={unitIdx}
                                    className={clsx(
                                      'rounded-xl border p-3 transition-all duration-200',
                                      isDup      ? 'border-red-200 bg-red-50/60 shadow-sm'
                                      : matchesSug ? 'border-emerald-200 bg-emerald-50/30'
                                      : isEmpty   ? 'border-gray-200 bg-white'
                                      : 'border-amber-200 bg-amber-50/30'
                                    )}
                                    style={{ animation: `rcvFadeSlide 0.22s ease ${unitIdx * 45}ms both` }}
                                  >
                                    <div className="flex items-center gap-2">
                                      {/* Unit badge */}
                                      <span className={clsx(
                                        'text-xs font-bold shrink-0 px-2 py-1 rounded-lg min-w-[52px] text-center',
                                        isDup ? 'bg-red-100 text-red-600'
                                          : matchesSug ? 'bg-emerald-100 text-emerald-700'
                                          : 'bg-primary-50 text-primary-700'
                                      )}>
                                        Unit {unitIdx + 1}
                                      </span>

                                      {/* Serial input */}
                                      <input
                                        className={clsx(
                                          'input text-sm font-mono flex-1 transition-all',
                                          isDup      ? 'border-red-300 bg-red-50 focus:border-red-400'
                                          : matchesSug ? 'border-emerald-300 focus:border-emerald-400'
                                          : diffFromSug ? 'border-amber-300 focus:border-amber-400'
                                          : ''
                                        )}
                                        placeholder={item.loadingSuggestions ? 'Generating suggestion…' : (hasSug ? unit.suggestion : `e.g. ${getSerialPrefix(item.equipment_type_name)}001`)}
                                        value={unit.serial}
                                        onChange={e => updateReceiveUnit(item.item_id, unitIdx, 'serial', e.target.value)}
                                        spellCheck={false}
                                        autoComplete="off"
                                        disabled={item.loadingSuggestions}
                                      />

                                      {/* Status icon */}
                                      {matchesSug && !isDup && (
                                        <CheckCircle size={15} className="text-emerald-500 shrink-0" style={{ animation: 'rcvPopIn 0.2s ease' }}/>
                                      )}
                                      {isDup && (
                                        <AlertCircle size={15} className="text-red-500 shrink-0" style={{ animation: 'rcvShake 0.3s ease' }}/>
                                      )}

                                      {/* Restore-to-suggestion */}
                                      {diffFromSug && !isDup && (
                                        <button
                                          type="button"
                                          title={`Restore to ${unit.suggestion}`}
                                          onClick={() => updateReceiveUnit(item.item_id, unitIdx, 'serial', unit.suggestion)}
                                          className="shrink-0 flex items-center gap-1 text-xs text-primary-500 hover:text-primary-700 px-2 py-1 rounded-lg border border-primary-200 hover:bg-primary-50 transition-all active:scale-95"
                                        >
                                          <RotateCcw size={10}/>
                                        </button>
                                      )}
                                    </div>

                                    {/* Contextual hint row */}
                                    <div className="mt-1.5 pl-[68px] min-h-[16px]">
                                      {isDup && (
                                        <p className="text-xs text-red-600 flex items-center gap-1" style={{ animation: 'rcvShake 0.3s ease' }}>
                                          <AlertCircle size={9}/> Duplicate — each unit needs a unique serial
                                        </p>
                                      )}
                                      {!isDup && matchesSug && (
                                        <p className="text-xs text-emerald-600 flex items-center gap-1">
                                          <CheckCircle size={9}/> Matches suggested serial
                                        </p>
                                      )}
                                      {!isDup && diffFromSug && (
                                        <p className="text-xs text-amber-600 flex items-center gap-1.5">
                                          <Sparkles size={9}/> Suggested:
                                          <button type="button"
                                            onClick={() => updateReceiveUnit(item.item_id, unitIdx, 'serial', unit.suggestion)}
                                            className="font-mono font-semibold underline underline-offset-2 hover:text-amber-800 transition-colors">
                                            {unit.suggestion}
                                          </button>
                                        </p>
                                      )}
                                      {!isDup && isEmpty && hasSug && (
                                        <p className="text-xs text-primary-600 flex items-center gap-1.5">
                                          <Sparkles size={9}/> Tap to use:
                                          <button type="button"
                                            onClick={() => updateReceiveUnit(item.item_id, unitIdx, 'serial', unit.suggestion)}
                                            className="font-mono font-bold hover:underline transition-colors">
                                            {unit.suggestion}
                                          </button>
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Inline type-change panel */}
                            {item.showTypeOverride && (
                              <div className="mt-2 p-3 border border-primary-200 rounded-xl bg-primary-50/30 space-y-2"
                                style={{ animation: 'rcvFadeSlide 0.18s ease' }}>
                                <p className="text-xs font-semibold text-primary-700 flex items-center gap-1.5">
                                  <ArrowRight size={10}/> Select a different equipment type
                                </p>
                                <EqTypeSelector
                                  value={item.equipment_type_id}
                                  eqTypes={eqTypes}
                                  onChange={typeId => {
                                    const t = eqTypes.find(t => t.type_id === typeId);
                                    updateReceiveItemType(item.item_id, typeId, t?.name ?? '', item.quantity);
                                  }}
                                  onAddNew={() => {
                                    setReceiveNewTypeItemId(item.item_id);
                                    const desc = item.description ?? '';
                                    setReceiveNewTypeSuggestedName(desc.includes(' — ') ? desc.split(' — ')[0].trim() : desc);
                                    setShowModal('new-eq-type-receive');
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          /* No type — show selector to link or create one */
                          <div className="space-y-3" style={{ animation: 'rcvFadeSlide 0.2s ease' }}>
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                              <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5"/>
                              <div>
                                <p className="text-xs font-semibold text-amber-800">Equipment type not recognised</p>
                                <p className="text-xs text-amber-600 mt-0.5">
                                  Select an existing type or create a new one (with category) to add this item to the fleet and generate serial numbers.
                                </p>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                                <Package size={11}/> Equipment Type
                                <span className="font-normal text-gray-400">(required for fleet tracking)</span>
                              </label>
                              <EqTypeSelector
                                value={item.equipment_type_id ?? ''}
                                eqTypes={eqTypes}
                                onChange={typeId => {
                                  const t = eqTypes.find(t => t.type_id === typeId);
                                  updateReceiveItemType(item.item_id, typeId, t?.name ?? '', item.quantity);
                                }}
                                onAddNew={() => {
                                  setReceiveNewTypeItemId(item.item_id);
                                  const desc = item.description ?? '';
                                  setReceiveNewTypeSuggestedName(desc.includes(' — ') ? desc.split(' — ')[0].trim() : desc);
                                  setShowModal('new-eq-type-receive');
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0 bg-white sticky bottom-0 rounded-b-2xl">
                <button type="button" onClick={() => setShowModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading}
                  className={clsx('btn-primary flex items-center gap-2 transition-all', formLoading && 'opacity-70 cursor-not-allowed')}>
                  {formLoading
                    ? <><Loader2 size={14} className="animate-spin"/> Processing…</>
                    : <><CheckCircle size={14}/> Confirm Receipt & Add to Fleet</>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── PO Form Modal ── */}
      {showModal === 'po' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Create Purchase Order</h3>
              <button onClick={() => setShowModal(null)}><X size={18} className="text-gray-400"/></button>
            </div>
            <form onSubmit={handlePOSave} className="p-5 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Vendor *</label>
                  <button type="button"
                    onClick={() => setShowModal('vendor-po')}
                    className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 font-medium">
                    <Plus size={11}/> New Vendor
                  </button>
                </div>
                <select className="input" value={poForm.vendor_id}
                  onChange={e => setPoForm(f => ({...f, vendor_id: e.target.value}))} required>
                  <option value="">Select vendor…</option>
                  {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Linked Procurement</label>
                <select className="input" value={poForm.procurement_id}
                  onChange={e => {
                    const p = procs.find(x => x.procurement_id === e.target.value);
                    setPoForm(f => ({...f, procurement_id: e.target.value, total_amount_kwd: p?.total_amount_kwd ?? f.total_amount_kwd, vendor_id: p?.vendor_id ?? f.vendor_id}));
                  }}>
                  <option value="">None</option>
                  {procs.filter(p => p.status === 'Approved').map(p => (
                    <option key={p.procurement_id} value={p.procurement_id}>{p.procurement_id} — {p.title}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Issue Date</label>
                  <input type="date" className="input" value={poForm.issue_date} onChange={e => setPoForm(f => ({...f, issue_date: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery</label>
                  <input type="date" className="input" value={poForm.expected_delivery} onChange={e => setPoForm(f => ({...f, expected_delivery: e.target.value}))}/>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (KWD) *</label>
                  <input type="number" min="0" step="0.001" className="input" value={poForm.total_amount_kwd}
                    onChange={e => setPoForm(f => ({...f, total_amount_kwd: e.target.value}))} required/>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Address</label>
                <input className="input" value={poForm.shipping_address} onChange={e => setPoForm(f => ({...f, shipping_address: e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
                <textarea className="input" rows={2} value={poForm.terms_conditions} onChange={e => setPoForm(f => ({...f, terms_conditions: e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={poForm.notes} onChange={e => setPoForm(f => ({...f, notes: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Creating…' : 'Create PO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Vendor Modals ── */}
      {(showModal === 'vendor' || showModal === 'vendor-inline' || showModal === 'vendor-po') && (
        <VendorModal
          vendors={vendors}
          setVendors={setVendors}
          showModal={showModal}
          setShowModal={setShowModal}
          onVendorCreated={handleVendorCreated}
          formLoading={formLoading}
          setFormLoading={setFormLoading}
        />
      )}

      {/* ── New Equipment Type Modal (from procurement form) ── */}
      {showModal === 'new-eq-type' && (
        <NewEquipmentTypeModal
          onCreated={handleEqTypeCreated}
          onClose={() => setShowModal('proc')}
          formLoading={formLoading}
          setFormLoading={setFormLoading}
        />
      )}

      {/* ── New Equipment Type Modal (from receive modal) ── */}
      {showModal === 'new-eq-type-receive' && (
        <NewEquipmentTypeModal
          onCreated={handleEqTypeCreatedForReceive}
          onClose={() => { setReceiveNewTypeItemId(null); setReceiveNewTypeSuggestedName(''); setShowModal('receive'); }}
          formLoading={formLoading}
          setFormLoading={setFormLoading}
          initialName={receiveNewTypeSuggestedName}
        />
      )}

      {/* ── New Capacity Modal ── */}
      {newCapacityForIdx !== null && (
        <NewCapacityModal
          onConfirm={(cap) => {
            setProcItems(items => items.map((it, i) =>
              i === newCapacityForIdx ? { ...it, capacity: cap } : it
            ));
            setNewCapacityForIdx(null);
          }}
          onClose={() => setNewCapacityForIdx(null)}
        />
      )}

      {/* ── PO Preview ── */}
      {previewPO  && <POPreviewModal  po={previewPO}    onClose={() => setPreviewPO(null)}/>}
      {previewProc && <ProcPreviewModal proc={previewProc} onClose={() => setPreviewProc(null)}/>}

      <style>{`
        @keyframes rcvFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes rcvSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes rcvFadeSlide {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes rcvPopIn {
          0%   { opacity: 0; transform: scale(0.85); }
          60%  { transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes rcvShake {
          0%,100% { transform: translateX(0); }
          25%     { transform: translateX(-4px); }
          75%     { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}