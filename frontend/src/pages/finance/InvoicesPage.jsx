import { useEffect, useState, useCallback } from 'react';
import { getInvoices, createInvoice, updateInvoice, getPendingQuotations } from '../../api/finance';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { Plus, DollarSign, X, Loader2, RefreshCw, Download, CheckCircle } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { downloadInvoicePDF } from '../../lib/pdfGenerator';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

const STATUSES = ['All','Draft','Sent','Paid','Overdue','Cancelled'];
const INV_STATUSES = ['Draft','Sent','Paid','Overdue','Cancelled'];

export default function InvoicesPage() {
  const { profile } = useAuth();
  const [invoices,    setInvoices]    = useState([]);
  const [pendingQ,    setPendingQ]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [statusFilter,setStatusFilter]= useState('All');
  const [showModal,   setShowModal]   = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState({ quotation_id:'', customer_id:'', total_amount_kwd:'', amount_paid_kwd:0, status:'Draft', issue_date: new Date().toISOString().split('T')[0], due_date:'', payment_method:'', notes:'' });
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, pq] = await Promise.all([
        getInvoices(statusFilter !== 'All' ? { status: statusFilter } : {}),
        getPendingQuotations(),
      ]);
      setInvoices(inv);
      setPendingQ(pq);
    } catch { toast.error('Failed to load invoices'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('invoices-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, load)
      .subscribe();
    return () => ch.unsubscribe();
  }, [load]);

  const openAdd = () => {
    setForm({ quotation_id:'', customer_id:'', total_amount_kwd:'', amount_paid_kwd:0, status:'Draft', issue_date: new Date().toISOString().split('T')[0], due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'), payment_method:'', notes:'' });
    setSelected(null);
    setShowModal(true);
  };

  const handleQuotationSelect = (qId) => {
    const q = pendingQ.find(q => q.quotation_id === qId);
    if (q) {
      setForm(f => ({ ...f, quotation_id: qId, customer_id: q.customer_id, total_amount_kwd: q.total_amount_kwd }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.quotation_id)      return toast.error('Select a quotation');
    if (!form.total_amount_kwd)  return toast.error('Enter total amount');
    setFormLoading(true);
    try {
      if (selected) {
        await updateInvoice(selected.invoice_id, form);
        toast.success('Invoice updated');
      } else {
        await createInvoice({ ...form, created_by: profile.user_id });
        // Mark quotation as invoiced
        await supabase.from('quotations').update({ status: 'Invoiced' }).eq('quotation_id', form.quotation_id);
        toast.success('Invoice created');
      }
      setShowModal(false);
      load();
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  const markPaid = async (inv) => {
    try {
      await updateInvoice(inv.invoice_id, { status: 'Paid', amount_paid_kwd: inv.total_amount_kwd, payment_date: new Date().toISOString().split('T')[0] });
      toast.success('Marked as paid');
      load();
    } catch { toast.error('Failed to mark paid'); }
  };

  const totalBilled    = invoices.reduce((s, i) => s + Number(i.total_amount_kwd ?? 0), 0);
  const totalCollected = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + Number(i.total_amount_kwd ?? 0), 0);
  const totalPending   = invoices.filter(i => ['Draft','Sent'].includes(i.status)).reduce((s, i) => s + Number(i.total_amount_kwd ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
          <p className="text-sm text-gray-400">{invoices.length} invoices</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16} /></button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={16} /> New Invoice</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Billed', value: totalBilled, color: 'text-blue-600' },
          { label: 'Collected', value: totalCollected, color: 'text-green-600' },
          { label: 'Pending', value: totalPending, color: 'text-yellow-600' },
        ].map(s => (
          <div key={s.label} className="card p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">{s.label}</p>
            <p className={`text-lg font-bold ${s.color}`}>
              {s.value.toLocaleString('en-US', { minimumFractionDigits: 3 })} <span className="text-xs font-normal">KWD</span>
            </p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex gap-2 overflow-x-auto">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : invoices.length === 0 ? <EmptyState message="No invoices found" icon={DollarSign} /> : (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">Invoice ID</th>
                  <th className="text-left px-5 py-3">Customer</th>
                  <th className="text-left px-5 py-3">Issue Date</th>
                  <th className="text-left px-5 py-3">Due Date</th>
                  <th className="text-left px-5 py-3">Total (KWD)</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map(inv => (
                  <tr key={inv.invoice_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{inv.invoice_id}</td>
                    <td className="px-5 py-3 font-medium text-gray-800">{inv.customers?.company_name}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{format(new Date(inv.issue_date), 'dd MMM yyyy')}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{inv.due_date ? format(new Date(inv.due_date), 'dd MMM yyyy') : '—'}</td>
                    <td className="px-5 py-3 font-semibold text-gray-800">{Number(inv.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</td>
                    <td className="px-5 py-3"><StatusBadge status={inv.status} /></td>
                    <td className="px-5 py-3 flex items-center gap-2">
                      <button onClick={() => downloadInvoicePDF(inv)} className="text-gray-400 hover:text-gray-600"><Download size={15} /></button>
                      {['Draft','Sent'].includes(inv.status) && (
                        <button onClick={() => markPaid(inv)} className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1">
                          <CheckCircle size={12} /> Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {invoices.map(inv => (
              <div key={inv.invoice_id} className="card p-4">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{inv.customers?.company_name}</p>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="text-xs text-gray-400">{inv.invoice_id}</p>
                <p className="text-sm font-bold text-gray-800 mt-1">KWD {Number(inv.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => downloadInvoicePDF(inv)} className="text-xs btn-secondary flex items-center gap-1"><Download size={12} /> PDF</button>
                  {['Draft','Sent'].includes(inv.status) && (
                    <button onClick={() => markPaid(inv)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg">Mark Paid</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{selected ? 'Edit Invoice' : 'Create Invoice'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Approved Quotation *</label>
                <select className="input" value={form.quotation_id} onChange={e => handleQuotationSelect(e.target.value)} required>
                  <option value="">Select quotation…</option>
                  {pendingQ.map(q => (
                    <option key={q.quotation_id} value={q.quotation_id}>
                      {q.quotation_id} — {q.customers?.company_name} — KWD {Number(q.total_amount_kwd).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Issue Date</label>
                  <input type="date" className="input" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total (KWD)</label>
                  <input type="number" className="input" value={form.total_amount_kwd} onChange={e => setForm(f => ({ ...f, total_amount_kwd: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {INV_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}