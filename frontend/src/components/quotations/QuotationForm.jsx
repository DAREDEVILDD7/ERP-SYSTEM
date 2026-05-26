import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';

import {
  createQuotation, updateQuotation, updateQuotationItems,
  getAvailableEquipment, getEquipmentStockByType,
} from '../../api/quotations';
import { getCustomers, getRequirements } from '../../api/requirements';
import { getProcurements } from '../../api/procurement';
import { useDraft } from '../../hooks/useDraft';
import { ArrowLeft, Plus, Trash2, Loader2, AlertTriangle, CheckCircle, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const EMPTY_ITEM = {
  description: '', quantity: 1, unit: 'Days',
  unit_rate_kwd: '', equipment_id: null,
  item_type: 'equipment', // 'equipment' | 'procurement' | 'service'
  procurement_id: null,
};

const INITIAL_FORM = {
  customer_id: '', requirement_id: '', quotation_date: new Date().toISOString().split('T')[0],
  valid_until: '', vat_percent: 0,
  terms_conditions: 'Payment within 30 days. Equipment subject to availability.',
  notes: '', status: 'Draft',
};

export default function QuotationForm({ existing, prefilledRequirement, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers,     setCustomers]     = useState([]);
  const [requirements,  setRequirements]  = useState([]);
  const [equipment,     setEquipment]     = useState([]);
  const [stockMap,      setStockMap]      = useState({});
  const [procurements,  setProcurements]  = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [dataLoading,   setDataLoading]   = useState(true);
  const submitRef = useRef(false);

  const draftKey = isEdit ? `quot-edit-${existing?.quotation_id}` : 'quot-new';

  const INIT_FORM = isEdit ? {
    customer_id:      existing.customer_id      ?? '',
    requirement_id:   existing.requirement_id   ?? prefilledRequirement?.requirement_id ?? '',
    quotation_date:   existing.quotation_date    ?? new Date().toISOString().split('T')[0],
    valid_until:      existing.valid_until       ?? '',
    vat_percent:      existing.vat_percent       ?? 0,
    terms_conditions: existing.terms_conditions  ?? 'Payment within 30 days.',
    notes:            existing.notes             ?? '',
    status:           existing.status            ?? 'Draft',
  } : {
    ...INITIAL_FORM,
    requirement_id: prefilledRequirement?.requirement_id ?? '',
    customer_id:    prefilledRequirement?.customer_id    ?? '',
  };

  const [form, setForm, clearDraft, hasDraft] = useDraft(draftKey, INIT_FORM);

  const INIT_ITEMS = isEdit && existing?.quotation_items?.length > 0
    ? existing.quotation_items.map(i => ({
        description:    i.description,
        quantity:       i.quantity,
        unit:           i.unit,
        unit_rate_kwd:  i.unit_rate_kwd,
        equipment_id:   i.equipment_id ?? null,
        item_type:      i.equipment_id ? 'equipment' : 'service',
        procurement_id: null,
      }))
    : [{ ...EMPTY_ITEM }];

  const [items, setItems, clearItemsDraft] = useDraft(`${draftKey}-items`, INIT_ITEMS);

  useEffect(() => {
    setDataLoading(true);
    Promise.all([
      getCustomers(),
      getAvailableEquipment(),
      getEquipmentStockByType(),
      getProcurements({ status: 'Approved' }),
    ])
      .then(([c, e, sm, p]) => {
        setCustomers(c);
        setEquipment(e);
        setStockMap(sm);
        setProcurements(p);
      })
      .catch(() => toast.error('Failed to load form data'))
      .finally(() => setDataLoading(false));
  }, []);

  useEffect(() => {
    if (form.customer_id) {
      getRequirements({ customer_id: form.customer_id })
        .then(setRequirements)
        .catch(() => {});
    }
  }, [form.customer_id]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const setItem = (idx, field, val) => {
    setItems(items => items.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: val };

      if (field === 'equipment_id' && val) {
        const eq = equipment.find(e => e.equipment_id === val);
        if (eq) {
          updated.unit_rate_kwd = eq.daily_rate_kwd;
          updated.description   = `${eq.equipment_types?.name} ${eq.capacity} — Rental`;
          updated.item_type     = 'equipment';
        }
      }

      if (field === 'procurement_id' && val) {
        const pr = procurements.find(p => p.procurement_id === val);
        if (pr) {
          updated.description   = pr.title;
          updated.unit_rate_kwd = pr.total_amount_kwd;
          updated.item_type     = 'procurement';
          updated.equipment_id  = null;
        }
      }

      if (field === 'item_type') {
        updated.equipment_id   = null;
        updated.procurement_id = null;
        updated.description    = '';
        updated.unit_rate_kwd  = '';
      }

      return updated;
    }));
  };

  const addItem    = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => {
    if (items.length === 1) return toast.error('At least one item required');
    setItems(i => i.filter((_, j) => j !== idx));
  };

  // Stock indicator for an equipment item
  const getStockInfo = (item) => {
    if (item.item_type !== 'equipment' || !item.equipment_id) return null;
    const eq = equipment.find(e => e.equipment_id === item.equipment_id);
    if (!eq) return null;
    const stock = stockMap[eq.equipment_types?.type_id];
    if (!stock) return null;
    // Count how many times this same type is used in current items
    const usedInForm = items.filter(i => {
      if (!i.equipment_id) return false;
      const e2 = equipment.find(e => e.equipment_id === i.equipment_id);
      return e2?.equipment_types?.type_id === eq.equipment_types?.type_id;
    }).length;
    return {
      available: stock.available,
      usedInForm,
      ok: usedInForm <= stock.available,
    };
  };

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) * Number(i.unit_rate_kwd || 0)), 0);
  const vatAmt   = subtotal * (Number(form.vat_percent) / 100);
  const total    = subtotal + vatAmt;

  // Check for stock violations
  const stockViolations = items.filter(item => {
    const info = getStockInfo(item);
    return info && !info.ok;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitRef.current) return; // prevent double submit

    if (!form.customer_id) return toast.error('Please select a customer');
    if (items.some(i => !i.description?.trim())) return toast.error('Fill in all item descriptions');
    if (items.some(i => !i.unit_rate_kwd)) return toast.error('Fill in all rates');

    if (stockViolations.length > 0) {
      toast.error('Some items exceed available stock. Please review.');
      return;
    }

    submitRef.current = true;
    setLoading(true);
    try {
      const payload = {
        ...form,
        prepared_by:      profile.user_id,
        subtotal_kwd:     subtotal,
        vat_amount_kwd:   vatAmt,
        total_amount_kwd: total,
        vat_percent:      Number(form.vat_percent),
        requirement_id:   form.requirement_id || null,
      };

      const cleanItems = items.map(({ item_type, procurement_id, ...rest }) => ({
        ...rest,
        description:   rest.description,
        quantity:      Number(rest.quantity),
        unit_rate_kwd: Number(rest.unit_rate_kwd),
        equipment_id:  rest.equipment_id || null,
      }));

      if (isEdit) {
        await updateQuotation(existing.quotation_id, payload);
        await updateQuotationItems(existing.quotation_id, cleanItems);
        toast.success('Quotation updated');
      } else {
        await createQuotation(payload, cleanItems);
        toast.success('Quotation created');
      }
      clearDraft();
      clearItemsDraft();
      onSuccess();
    } catch (err) {
      toast.error(err.message || 'Failed to save quotation');
    } finally {
      setLoading(false);
      submitRef.current = false;
    }
  };

  if (dataLoading) return <LoadingSpinner fullscreen={false} />;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2"><ArrowLeft size={16} /></button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Quotation' : 'New Quotation'}</h2>
          <p className="text-sm text-gray-400">{isEdit ? existing.quotation_id : 'Create a new quotation'}</p>
        </div>
      </div>

      {/* Draft banner */}
      {!isEdit && hasDraft() && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-yellow-700">📝 Draft restored — your previous progress is saved</p>
          <button type="button" onClick={() => { clearDraft(); clearItemsDraft(); window.location.reload(); }} className="text-xs text-yellow-600 hover:underline ml-4">Clear draft</button>
        </div>
      )}

      {/* Stock warning banner */}
      {stockViolations.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-700">
            {stockViolations.length} item(s) exceed available stock. Please adjust quantities or select different equipment.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Basic info */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">Quotation Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer <span className="text-red-500">*</span></label>
              <select className="input" value={form.customer_id} onChange={e => set('customer_id', e.target.value)} required>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Linked Requirement</label>
              <select className="input" value={form.requirement_id} onChange={e => set('requirement_id', e.target.value)}>
                <option value="">None</option>
                {requirements.map(r => (
                  <option key={r.requirement_id} value={r.requirement_id}>
                    {r.requirement_id} — {r.requirement_summary?.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Date</label>
              <input type="date" className="input" value={form.quotation_date} onChange={e => set('quotation_date', e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
              <input type="date" className="input" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VAT %</label>
              <input type="number" className="input" min="0" max="100" step="0.01" value={form.vat_percent} onChange={e => set('vat_percent', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
                {['Draft','Sent','Approved','Rejected','Expired'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
            <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
            <button type="button" onClick={addItem} className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5">
              <Plus size={13} /> Add Item
            </button>
          </div>

          <div className="space-y-4">
            {items.map((item, idx) => {
              const stockInfo = getStockInfo(item);
              const isOverStock = stockInfo && !stockInfo.ok;

              return (
                <div key={idx} className={clsx(
                  'p-3 rounded-xl border transition-colors',
                  isOverStock ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'
                )}>
                  {/* Item type selector */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium text-gray-500">Item {idx + 1}:</span>
                    {['equipment','procurement','service'].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setItem(idx, 'item_type', t)}
                        className={clsx(
                          'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize',
                          item.item_type === t
                            ? 'bg-primary-500 text-white'
                            : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
                        )}
                      >
                        {t}
                      </button>
                    ))}
                    <button type="button" onClick={() => removeItem(idx)} className="ml-auto text-red-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-12 gap-2 items-start">
                    {/* Equipment picker */}
                    {item.item_type === 'equipment' && (
                      <div className="col-span-12 sm:col-span-4 space-y-1">
                        <select
                          className={clsx('input text-xs', isOverStock && 'border-red-300')}
                          value={item.equipment_id ?? ''}
                          onChange={e => setItem(idx, 'equipment_id', e.target.value || null)}
                        >
                          <option value="">Select equipment…</option>
                          {equipment.map(e => {
                            const typeStock = stockMap[e.equipment_types?.type_id];
                            const avail = typeStock?.available ?? 0;
                            return (
                              <option key={e.equipment_id} value={e.equipment_id}>
                                {e.equipment_types?.name} {e.capacity} ({e.status}) — {avail} avail
                              </option>
                            );
                          })}
                        </select>

                        {/* Stock indicator pill */}
                        {stockInfo && (
                          <div className={clsx(
                            'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium w-fit',
                            stockInfo.ok
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          )}>
                            {stockInfo.ok
                              ? <CheckCircle size={11} />
                              : <AlertTriangle size={11} />
                            }
                            <span>
                              {stockInfo.available} available
                              {stockInfo.usedInForm > 1 && ` · ${stockInfo.usedInForm} in this quote`}
                            </span>
                            {/* Mini bar */}
                            <div className="ml-1 w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={clsx('h-full rounded-full transition-all', stockInfo.ok ? 'bg-green-500' : 'bg-red-500')}
                                style={{ width: `${Math.min(100, (stockInfo.available / Math.max(stockInfo.available, stockInfo.usedInForm, 1)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {isOverStock && (
                          <p className="text-xs text-red-600 flex items-center gap-1">
                            <AlertTriangle size={11} />
                            Only {stockInfo.available} unit(s) available
                          </p>
                        )}
                      </div>
                    )}

                    {/* Procurement picker */}
                    {item.item_type === 'procurement' && (
                      <div className="col-span-12 sm:col-span-4">
                        <select
                          className="input text-xs"
                          value={item.procurement_id ?? ''}
                          onChange={e => setItem(idx, 'procurement_id', e.target.value || null)}
                        >
                          <option value="">Select procurement item…</option>
                          {procurements.map(p => (
                            <option key={p.procurement_id} value={p.procurement_id}>
                              {p.title} — KWD {Number(p.total_amount_kwd).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Service — no picker, just description */}
                    {item.item_type === 'service' && (
                      <div className="col-span-12 sm:col-span-4">
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-600 text-xs">
                          <Package size={12} /> Manual / Service item
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    <div className={clsx('col-span-12', item.item_type !== 'service' ? 'sm:col-span-3' : 'sm:col-span-4')}>
                      <input
                        className="input text-xs"
                        placeholder="Description *"
                        value={item.description}
                        onChange={e => setItem(idx, 'description', e.target.value)}
                        required
                      />
                    </div>

                    {/* Qty */}
                    <div className="col-span-3 sm:col-span-1">
                      <input
                        type="number" min="1" className={clsx('input text-xs', isOverStock && 'border-red-300')}
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={e => setItem(idx, 'quantity', e.target.value)}
                      />
                    </div>

                    {/* Unit */}
                    <div className="col-span-4 sm:col-span-2">
                      <select className="input text-xs" value={item.unit} onChange={e => setItem(idx, 'unit', e.target.value)}>
                        {['Days','Hours','Months','Lumpsum','Trip','Unit'].map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>

                    {/* Rate */}
                    <div className="col-span-5 sm:col-span-2">
                      <input
                        type="number" min="0" step="0.001" className="input text-xs"
                        placeholder="Rate KWD"
                        value={item.unit_rate_kwd}
                        onChange={e => setItem(idx, 'unit_rate_kwd', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Line total */}
                  <div className="text-right mt-2 text-xs font-semibold text-gray-600">
                    Line total: KWD {(Number(item.quantity) * Number(item.unit_rate_kwd || 0)).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div className="mt-6 border-t border-gray-100 pt-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex gap-8 text-gray-600">
              <span>Subtotal</span>
              <span className="font-medium w-36 text-right">KWD {subtotal.toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
            </div>
            {Number(form.vat_percent) > 0 && (
              <div className="flex gap-8 text-gray-600">
                <span>VAT ({form.vat_percent}%)</span>
                <span className="font-medium w-36 text-right">KWD {vatAmt.toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
              </div>
            )}
            <div className="flex gap-8 font-bold text-gray-900 text-base border-t border-gray-100 pt-2 mt-1">
              <span>Total</span>
              <span className="w-36 text-right">KWD {total.toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
            </div>
          </div>
        </div>

        {/* Terms */}
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">Terms & Notes</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
            <textarea className="input resize-y" rows={3} value={form.terms_conditions} onChange={e => set('terms_conditions', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
            <textarea className="input resize-y" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pb-6">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button
            type="submit"
            disabled={loading || stockViolations.length > 0}
            className={clsx(
              'btn-primary flex items-center gap-2',
              stockViolations.length > 0 && 'opacity-60 cursor-not-allowed'
            )}
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Update Quotation' : 'Create Quotation'}
          </button>
        </div>
      </form>
    </div>
  );
}