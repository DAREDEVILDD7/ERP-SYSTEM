import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createRequirement, updateRequirement, getCustomers } from '../../api/requirements';
import { getEquipmentTypes } from '../../api/equipment';
import { useDraft } from '../../hooks/useDraft';
import {
  ArrowLeft, Loader2, Plus, Trash2, Package,
  Search, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const EMPTY_ITEM = {
  equipment_type_id: '',
  description: '',
  quantity: 1,
  capacity: '',
  notes: '',
};

// Equipment type searchable selector
function EqTypeSelector({ value, eqTypes, onChange, placeholder = 'Search equipment type…' }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');

  const filtered = eqTypes.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.category?.toLowerCase().includes(search.toLowerCase())
  );

  const selected = eqTypes.find(t => t.type_id === value);

  return (
    <div className="relative">
      <button type="button"
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        className="input w-full text-left flex items-center justify-between text-sm"
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? `${selected.name}${selected.category ? ` (${selected.category})` : ''}` : placeholder}
        </span>
        <ChevronDown size={14} className="text-gray-400 shrink-0 ml-2"/>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-40 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input autoFocus className="input pl-7 text-xs"
                placeholder="Search…" value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}/>
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto">
            <button type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 text-gray-400 border-b border-gray-50">
              None / Manual
            </button>
            {filtered.map(t => (
              <button key={t.type_id} type="button"
                onClick={() => { onChange(t.type_id); setOpen(false); setSearch(''); }}
                className={clsx('w-full text-left px-4 py-2.5 text-xs border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors',
                  value === t.type_id && 'bg-primary-50')}>
                <p className="font-medium text-gray-800">{t.name}</p>
                {t.category && <p className="text-gray-400">{t.category}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RequirementForm({ existing, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers, setCustomers] = useState([]);
  const [eqTypes,   setEqTypes]   = useState([]);
  const [loading,   setLoading]   = useState(false);

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
        equipment_type_id: i.equipment_type_id ?? '',
        description:       i.description,
        quantity:          i.quantity,
        capacity:          i.capacity ?? '',
        notes:             i.notes ?? '',
      }))
    : [];

  const [form, setForm, clearDraft, hasDraft] = useDraft(draftKey, INIT_FORM);
  const [items, setItems, clearItemsDraft] = useDraft(`${draftKey}-items`, INIT_ITEMS);

  useEffect(() => {
    Promise.all([getCustomers(), getEquipmentTypes()])
      .then(([c, et]) => { setCustomers(c); setEqTypes(et); })
      .catch(() => toast.error('Failed to load form data'));
  }, []);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const addItem = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(i => i.filter((_, j) => j !== idx));
  const setItem = (idx, field, val) => {
    setItems(items => items.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: val };
      // Auto-fill description from equipment type
      if (field === 'equipment_type_id' && val) {
        const t = eqTypes.find(t => t.type_id === val);
        if (t && !item.description) updated.description = t.name;
      }
      return updated;
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id)         return toast.error('Please select a customer');
    if (!form.requested_by.trim()) return toast.error('Please enter the contact name');
    if (!form.requirement_summary.trim()) return toast.error('Please describe the requirement');

    setLoading(true);
    try {
      const payload  = { ...form, created_by: profile.user_id };
      const cleanItems = items
        .filter(i => i.description.trim())
        .map(i => ({
          equipment_type_id: i.equipment_type_id || null,
          description: i.description,
          quantity:    Number(i.quantity) || 1,
          capacity:    i.capacity || null,
          notes:       i.notes || null,
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
          <button type="button" onClick={() => { clearDraft(); clearItemsDraft(); window.location.reload(); }}
            className="text-xs text-yellow-600 hover:underline ml-4">Clear draft</button>
        </div>
      )}

      {/* Status note */}
      {!isEdit && (
        <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100">
          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/>
          <p className="text-xs text-blue-700">
            New requirements start with <span className="font-semibold">Pending Review</span> status and progress automatically through the workflow
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
                  {c.company_name} — {c.contact_person}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Requested By (Contact Name) <span className="text-red-500">*</span>
            </label>
            <input className="input" placeholder="e.g. Hassan Shaikh"
              value={form.requested_by} onChange={e => set('requested_by', e.target.value)} required/>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Requirement Summary <span className="text-red-500">*</span>
            </label>
            <textarea className="input min-h-[90px] resize-y"
              placeholder="Describe what the customer needs…"
              value={form.requirement_summary}
              onChange={e => set('requirement_summary', e.target.value)} required/>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input className="input" placeholder="e.g. Ahmadi, Shuwaikh"
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

        {/* Equipment items */}
        <div className="card p-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Equipment Required</h3>
              <p className="text-xs text-gray-400 mt-0.5">Specify equipment items needed for this requirement</p>
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
                className="mt-2 text-xs text-primary-500 hover:underline">Add first item</button>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="border border-gray-100 rounded-xl p-4 bg-gray-50/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">Item {idx + 1}</p>
                    <button type="button" onClick={() => removeItem(idx)}
                      className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={14}/>
                    </button>
                  </div>

                  {/* Equipment type selector */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Equipment Type</label>
                    <EqTypeSelector
                      value={item.equipment_type_id}
                      eqTypes={eqTypes}
                      onChange={val => setItem(idx, 'equipment_type_id', val)}
                    />
                  </div>

                  <div className="grid grid-cols-12 gap-2">
                    {/* Description */}
                    <div className="col-span-12 sm:col-span-5">
                      <label className="block text-xs text-gray-500 mb-1">Description *</label>
                      <input className="input text-sm" placeholder="e.g. 50 Ton Forklift"
                        value={item.description}
                        onChange={e => setItem(idx, 'description', e.target.value)} required/>
                    </div>
                    {/* Capacity */}
                    <div className="col-span-6 sm:col-span-4">
                      <label className="block text-xs text-gray-500 mb-1">Capacity / Spec</label>
                      <input className="input text-sm" placeholder="e.g. 50 Ton, 100 KVA"
                        value={item.capacity}
                        onChange={e => setItem(idx, 'capacity', e.target.value)}/>
                    </div>
                    {/* Quantity */}
                    <div className="col-span-6 sm:col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                      <input type="number" min="1" className="input text-sm text-center"
                        value={item.quantity}
                        onChange={e => setItem(idx, 'quantity', e.target.value)}/>
                    </div>
                    {/* Notes */}
                    <div className="col-span-12">
                      <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
                      <input className="input text-sm" placeholder="Any specific requirements…"
                        value={item.notes}
                        onChange={e => setItem(idx, 'notes', e.target.value)}/>
                    </div>
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