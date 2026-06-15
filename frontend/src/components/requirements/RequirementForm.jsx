import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createRequirement, updateRequirement, getCustomers } from '../../api/requirements';
import { getEquipmentUnitsWithProcurement } from '../../api/equipment';
import { useDraft } from '../../hooks/useDraft';
import {
  ArrowLeft, Loader2, Plus, Trash2, Package,
  Search, X, ChevronDown, ChevronUp, CheckCircle,
} from 'lucide-react';
import StatusBadge from '../common/StatusBadge';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const EMPTY_ITEM = {
  equipment_id:      '',    // actual fleet unit
  equipment_type_id: '',
  description:       '',
  quantity:          1,
  capacity:          '',
  notes:             '',
};

// Equipment fleet searchable selector
function EquipmentSelector({ value, equipment, usedEquipmentIds = [], onChange }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref                 = useRef(null);

  const filtered = equipment.filter(e => {
    // Exclude equipment already used in other items (but allow current value)
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

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* div instead of button to avoid nested <button> invalid HTML */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); setSearch(''); } }}
        className="input w-full text-left flex items-center justify-between text-sm cursor-pointer select-none"
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-medium text-gray-800 truncate">
              {selected.equipment_types?.name} {selected.capacity}
            </span>
            <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
              — {selected.equipment_id}
            </span>
            <StatusBadge status={selected.status}/>
          </div>
        ) : (
          <span className="text-gray-400 flex items-center gap-2">
            <Search size={13}/> Search equipment fleet…
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              className="text-gray-300 hover:text-gray-500"
            >
              <X size={13}/>
            </button>
          )}
          {open ? <ChevronUp size={14} className="text-gray-400"/> : <ChevronDown size={14} className="text-gray-400"/>}
        </div>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-40 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                autoFocus
                className="input pl-7 text-xs"
                placeholder="Search by type, ID, serial, capacity, location…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={12}/>
                </button>
              )}
            </div>
          </div>

          {/* Equipment list */}
          <div className="max-h-60 overflow-y-auto">
            {/* None option */}
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50"
            >
              None / Manual description
            </button>

            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No equipment found</p>
            ) : filtered.map(eq => (
              <button
                key={eq.equipment_id}
                type="button"
                onClick={() => { onChange(eq.equipment_id); setOpen(false); setSearch(''); }}
                className={clsx(
                  'w-full flex items-start justify-between px-4 py-3 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                  value === eq.equipment_id && 'bg-primary-50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">
                    {eq.equipment_types?.name}
                    {eq.capacity && <span className="text-gray-500 ml-1">— {eq.capacity}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {eq.equipment_id}
                    {eq.serial_number && ` · Serial: ${eq.serial_number}`}
                    {eq.location && ` · ${eq.location}`}
                  </p>
                  {eq.equipment_types?.category && (
                    <p className="text-xs text-gray-300">{eq.equipment_types.category}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                  <StatusBadge status={eq.status}/>
                  {eq.daily_rate_kwd && (
                    <span className="text-xs text-gray-400">
                      KWD {Number(eq.daily_rate_kwd).toLocaleString()}/day
                    </span>
                  )}
                </div>
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

// Selected equipment detail card
function EquipmentDetailCard({ equipment, equipmentId }) {
  const eq = equipment.find(e => e.equipment_id === equipmentId);
  if (!eq) return null;

  return (
    <div className={clsx(
      'rounded-xl border p-3 text-xs space-y-2',
      eq.status === 'Available'   ? 'bg-green-50 border-green-100' :
      eq.status === 'Reserved'    ? 'bg-yellow-50 border-yellow-100' :
      eq.status === 'Dispatched'  ? 'bg-blue-50 border-blue-100' :
      eq.status === 'Maintenance' ? 'bg-red-50 border-red-100' :
      'bg-gray-50 border-gray-100'
    )}>
      <div className="flex items-center gap-2">
        <CheckCircle size={12} className="text-green-500 shrink-0"/>
        <span className="font-semibold text-gray-700">Equipment confirmed</span>
        <StatusBadge status={eq.status}/>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
        <div><span className="text-gray-400">Type:</span> {eq.equipment_types?.name ?? '—'}</div>
        <div><span className="text-gray-400">Capacity:</span> {eq.capacity ?? '—'}</div>
        <div><span className="text-gray-400">ID:</span> <span className="font-mono">{eq.equipment_id}</span></div>
        <div><span className="text-gray-400">Serial:</span> {eq.serial_number ?? '—'}</div>
        <div><span className="text-gray-400">Location:</span> {eq.location ?? '—'}</div>
        <div><span className="text-gray-400">Rate:</span> KWD {Number(eq.daily_rate_kwd).toLocaleString()}/day</div>
      </div>
      {eq.status !== 'Available' && (
        <div className="flex items-center gap-1.5 text-orange-600 bg-orange-50 rounded-lg px-2 py-1">
          <span className="font-medium">Note:</span> This equipment is currently {eq.status.toLowerCase()}. It may not be available when needed.
        </div>
      )}
    </div>
  );
}

export default function RequirementForm({ existing, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers, setCustomers] = useState([]);
  const [equipment, setEquipment] = useState([]);  // full fleet
  const [loading,   setLoading]   = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

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

  // Map existing requirement_items to fleet-based items
  const INIT_ITEMS = existing?.requirement_items?.length > 0
    ? existing.requirement_items.map(i => ({
        equipment_id:      i.equipment_id      ?? '',
        equipment_type_id: i.equipment_type_id ?? '',
        description:       i.description,
        quantity:          i.quantity,
        capacity:          i.capacity  ?? '',
        notes:             i.notes     ?? '',
      }))
    : [];

  const [form,  setForm,  clearDraft,      hasDraft]      = useDraft(draftKey, INIT_FORM);
  const [items, setItems, clearItemsDraft, hasItemsDraft] = useDraft(`${draftKey}-items`, INIT_ITEMS);

  useEffect(() => {
    setDataLoading(true);
    Promise.all([
      getCustomers(),
      getEquipmentUnitsWithProcurement(),
    ])
      .then(([c, e]) => {
        setCustomers(c);
        setEquipment(e);
      })
      .catch(() => toast.error('Failed to load form data'))
      .finally(() => setDataLoading(false));
  }, []);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const addItem    = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(i => i.filter((_, j) => j !== idx));

  const setItem = (idx, field, val) => {
    setItems(items => items.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: val };

      // When equipment is selected from fleet, auto-fill details
      if (field === 'equipment_id' && val) {
        const eq = equipment.find(e => e.equipment_id === val);
        if (eq) {
          updated.equipment_type_id = eq.type_id ?? '';
          updated.description       = `${eq.equipment_types?.name ?? ''} ${eq.capacity ?? ''}`.trim();
          updated.capacity          = eq.capacity ?? '';
        }
      }

      // Clear equipment-derived fields if equipment cleared
      if (field === 'equipment_id' && !val) {
        updated.equipment_type_id = '';
        updated.capacity          = '';
        // Keep description as user may have edited it
      }

      return updated;
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id)              return toast.error('Please select a customer');
    if (!form.requested_by.trim())      return toast.error('Please enter the contact name');
    if (!form.requirement_summary.trim()) return toast.error('Please describe the requirement');

    setLoading(true);
    try {
      const payload    = { ...form, created_by: profile.user_id };
      const cleanItems = items
        .filter(i => i.description?.trim())
        .map(i => ({
          equipment_id:      i.equipment_id      || null,
          equipment_type_id: i.equipment_type_id || null,
          description:       i.description,
          quantity:          Number(i.quantity)   || 1,
          capacity:          i.capacity           || null,
          notes:             i.notes              || null,
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
      <Loader2 size={28} className="animate-spin text-primary-500"/>
      <p className="text-sm text-gray-400">Loading form data…</p>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2"><ArrowLeft size={16}/></button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit Requirement' : 'New Requirement'}
          </h2>
          <p className="text-sm text-gray-400">
            {isEdit ? `Editing ${existing.requirement_id}` : 'Create a new requirement ticket'}
          </p>
        </div>
      </div>

      {/* Draft banner */}
      {!isEdit && hasDraft() && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-yellow-700">📝 Draft restored from your last session</p>
          <button type="button"
            onClick={() => { clearDraft(); clearItemsDraft(); window.location.reload(); }}
            className="text-xs text-yellow-600 hover:underline ml-4">Clear draft
          </button>
        </div>
      )}

      {/* Status note */}
      {!isEdit && (
        <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100">
          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/>
          <p className="text-xs text-blue-700">
            New requirements start with <span className="font-semibold">Pending Review</span> status and progress automatically
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Basic info */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">Requirement Details</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            <select className="input" value={form.customer_id}
              onChange={e => set('customer_id', e.target.value)} required>
              <option value="">Select a customer…</option>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.company_name}{c.contact_person ? ` — ${c.contact_person}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Requested By (Contact Name) <span className="text-red-500">*</span>
            </label>
            <input className="input" placeholder="e.g. Hassan Shaikh"
              value={form.requested_by}
              onChange={e => set('requested_by', e.target.value)} required/>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Requirement Summary <span className="text-red-500">*</span>
            </label>
            <textarea className="input min-h-[80px] resize-y"
              placeholder="Describe what the customer needs…"
              value={form.requirement_summary}
              onChange={e => set('requirement_summary', e.target.value)} required/>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input className="input" placeholder="e.g. Ahmadi Refinery"
                value={form.location} onChange={e => set('location', e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input type="date" className="input" value={form.start_date}
                onChange={e => set('start_date', e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input type="date" className="input" value={form.end_date}
                onChange={e => set('end_date', e.target.value)}/>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input resize-y" rows={2}
              placeholder="Any additional notes…"
              value={form.notes} onChange={e => set('notes', e.target.value)}/>
          </div>
        </div>

        {/* Equipment items — from fleet */}
        <div className="card p-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Package size={15} className="text-primary-500"/>
                Equipment Required
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Select equipment from fleet — or describe manually if not in fleet
              </p>
            </div>
            <button type="button" onClick={addItem}
              className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5">
              <Plus size={13}/> Add Item
            </button>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <Package size={28} className="opacity-30 mb-2"/>
              <p className="text-sm">No equipment items added yet</p>
              <button type="button" onClick={addItem}
                className="mt-2 text-xs text-primary-500 hover:underline">
                Add first item
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item, idx) => (
                <div key={idx} className="border border-gray-100 rounded-xl p-4 bg-gray-50/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500">Item {idx + 1}</p>
                    <button type="button" onClick={() => removeItem(idx)}
                      className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={14}/>
                    </button>
                  </div>

                  {/* Equipment fleet selector */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Select from Equipment Fleet
                      <span className="text-gray-400 ml-1">(optional — or enter manually below)</span>
                    </label>
                    <EquipmentSelector
                      value={item.equipment_id}
                      equipment={equipment}
                      usedEquipmentIds={items
                        .filter((_, j) => j !== idx)
                        .map(i => i.equipment_id)
                        .filter(Boolean)}
                      onChange={val => setItem(idx, 'equipment_id', val)}
                    />
                  </div>

                  {/* Show equipment detail card if selected */}
                  {item.equipment_id && (
                    <EquipmentDetailCard equipment={equipment} equipmentId={item.equipment_id}/>
                  )}

                  {/* Manual description + qty + capacity */}
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 sm:col-span-6">
                      <label className="block text-xs text-gray-500 mb-1">
                        Description *
                        {item.equipment_id && <span className="text-green-600 ml-1">(auto-filled)</span>}
                      </label>
                      <input
                        className="input text-sm"
                        placeholder="e.g. 50 Ton Forklift"
                        value={item.description}
                        onChange={e => setItem(idx, 'description', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">
                        Capacity / Spec
                        {item.equipment_id && <span className="text-green-600 ml-1">(auto)</span>}
                      </label>
                      <input
                        className="input text-sm"
                        placeholder="e.g. 50 Ton"
                        value={item.capacity}
                        onChange={e => setItem(idx, 'capacity', e.target.value)}
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                      <input
                        type="number" min="1"
                        className="input text-sm text-center"
                        value={item.quantity}
                        onChange={e => setItem(idx, 'quantity', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
                    <input className="input text-sm"
                      placeholder="Any specific requirements or conditions…"
                      value={item.notes}
                      onChange={e => setItem(idx, 'notes', e.target.value)}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-4">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            {loading && <Loader2 size={15} className="animate-spin"/>}
            {loading ? 'Saving…' : isEdit ? 'Update' : 'Create Requirement'}
          </button>
        </div>
      </form>
    </div>
  );
}