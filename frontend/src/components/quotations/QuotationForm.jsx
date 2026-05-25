import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createQuotation, updateQuotation, updateQuotationItems, getAvailableEquipment } from '../../api/quotations';
import { getCustomers } from '../../api/requirements';
import { getRequirements } from '../../api/requirements';
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const EMPTY_ITEM = { description: '', quantity: 1, unit: 'Days', unit_rate_kwd: '', equipment_id: null };

export default function QuotationForm({ existing, prefilledRequirement, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers,  setCustomers]  = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [equipment,  setEquipment]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [items,      setItems]      = useState(
    existing?.quotation_items?.length > 0
      ? existing.quotation_items.map(i => ({
          description:   i.description,
          quantity:      i.quantity,
          unit:          i.unit,
          unit_rate_kwd: i.unit_rate_kwd,
          equipment_id:  i.equipment_id ?? null,
        }))
      : [{ ...EMPTY_ITEM }]
  );

  const [form, setForm] = useState({
    customer_id:       existing?.customer_id       ?? prefilledRequirement?.customer_id ?? '',
    requirement_id:    existing?.requirement_id    ?? prefilledRequirement?.requirement_id ?? '',
    quotation_date:    existing?.quotation_date     ?? new Date().toISOString().split('T')[0],
    valid_until:       existing?.valid_until        ?? '',
    vat_percent:       existing?.vat_percent        ?? 0,
    terms_conditions:  existing?.terms_conditions   ?? 'Payment within 30 days. Equipment subject to availability.',
    notes:             existing?.notes              ?? '',
    status:            existing?.status             ?? 'Draft',
  });

  useEffect(() => {
    Promise.all([getCustomers(), getAvailableEquipment()])
      .then(([c, e]) => { setCustomers(c); setEquipment(e); })
      .catch(() => toast.error('Failed to load form data'));
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
      // Auto-fill rate from equipment
      if (field === 'equipment_id' && val) {
        const eq = equipment.find(e => e.equipment_id === val);
        if (eq) {
          updated.unit_rate_kwd = eq.daily_rate_kwd;
          updated.description   = `${eq.equipment_types?.name} ${eq.capacity} — Rental`;
        }
      }
      return updated;
    }));
  };

  const addItem    = () => setItems(i => [...i, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(i => i.filter((_, j) => j !== idx));

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) * Number(i.unit_rate_kwd || 0)), 0);
  const vatAmt   = subtotal * (Number(form.vat_percent) / 100);
  const total    = subtotal + vatAmt;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id) return toast.error('Please select a customer');
    if (items.some(i => !i.description || !i.unit_rate_kwd)) return toast.error('Fill in all line items');

    setLoading(true);
    try {
      const payload = {
        ...form,
        prepared_by:      profile.user_id,
        subtotal_kwd:     subtotal,
        vat_amount_kwd:   vatAmt,
        total_amount_kwd: total,
        vat_percent:      Number(form.vat_percent),
      };

      if (isEdit) {
        await updateQuotation(existing.quotation_id, payload);
        await updateQuotationItems(existing.quotation_id, items);
        toast.success('Quotation updated');
      } else {
        await createQuotation(payload, items);
        toast.success('Quotation created');
      }
      onSuccess();
    } catch (err) {
      toast.error(err.message || 'Failed to save quotation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2"><ArrowLeft size={16} /></button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Quotation' : 'New Quotation'}</h2>
          <p className="text-sm text-gray-400">{isEdit ? existing.quotation_id : 'Create a new quotation'}</p>
        </div>
      </div>

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
                {requirements.map(r => <option key={r.requirement_id} value={r.requirement_id}>{r.requirement_id} — {r.requirement_summary?.slice(0, 40)}</option>)}
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
              <input type="number" className="input" min="0" max="100" value={form.vat_percent} onChange={e => set('vat_percent', e.target.value)} />
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

          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                {/* Equipment picker */}
                <div className="col-span-12 sm:col-span-3">
                  <select
                    className="input text-xs"
                    value={item.equipment_id ?? ''}
                    onChange={e => setItem(idx, 'equipment_id', e.target.value || null)}
                  >
                    <option value="">Manual / No equipment</option>
                    {equipment.map(e => (
                      <option key={e.equipment_id} value={e.equipment_id}>
                        {e.equipment_types?.name} {e.capacity} ({e.status})
                      </option>
                    ))}
                  </select>
                </div>
                {/* Description */}
                <div className="col-span-12 sm:col-span-4">
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
                    type="number" min="1" className="input text-xs"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={e => setItem(idx, 'quantity', e.target.value)}
                  />
                </div>
                {/* Unit */}
                <div className="col-span-4 sm:col-span-1">
                  <select className="input text-xs" value={item.unit} onChange={e => setItem(idx, 'unit', e.target.value)}>
                    {['Days','Hours','Months','Lumpsum','Trip'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
                {/* Rate */}
                <div className="col-span-4 sm:col-span-2">
                  <input
                    type="number" min="0" step="0.001" className="input text-xs"
                    placeholder="Rate KWD"
                    value={item.unit_rate_kwd}
                    onChange={e => setItem(idx, 'unit_rate_kwd', e.target.value)}
                    required
                  />
                </div>
                {/* Total + delete */}
                <div className="col-span-1 flex items-center gap-1 justify-end">
                  <span className="text-xs text-gray-500 hidden sm:block whitespace-nowrap">
                    {(Number(item.quantity) * Number(item.unit_rate_kwd || 0)).toLocaleString()}
                  </span>
                  <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="mt-6 border-t border-gray-100 pt-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex gap-8 text-gray-600">
              <span>Subtotal</span>
              <span className="font-medium w-32 text-right">KWD {subtotal.toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
            </div>
            {Number(form.vat_percent) > 0 && (
              <div className="flex gap-8 text-gray-600">
                <span>VAT ({form.vat_percent}%)</span>
                <span className="font-medium w-32 text-right">KWD {vatAmt.toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
              </div>
            )}
            <div className="flex gap-8 font-semibold text-gray-900 text-base border-t border-gray-100 pt-2 mt-1">
              <span>Total</span>
              <span className="w-32 text-right">KWD {total.toLocaleString('en-US', { minimumFractionDigits: 3 })}</span>
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

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? 'Saving…' : isEdit ? 'Update Quotation' : 'Create Quotation'}
          </button>
        </div>
      </form>
    </div>
  );
}