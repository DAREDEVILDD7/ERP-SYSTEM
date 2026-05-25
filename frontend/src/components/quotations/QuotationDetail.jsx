import { useEffect, useState } from 'react';
import { getQuotation, updateQuotation } from '../../api/quotations';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import { ArrowLeft, Edit2, Download, CheckCircle, XCircle, Send } from 'lucide-react';
import { format } from 'date-fns';
import { downloadQuotationPDF } from '../../lib/pdfGenerator';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';

export default function QuotationDetail({ quotationId, onBack, onEdit, canApprove, onRefresh }) {
  const { profile } = useAuth();
  const [quotation, setQuotation] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [acting,    setActing]    = useState(false);

  const load = async () => {
    try {
      const data = await getQuotation(quotationId);
      setQuotation(data);
    } catch {
      toast.error('Failed to load quotation');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [quotationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (status, extra = {}) => {
    setActing(true);
    try {
      await updateQuotation(quotationId, {
        status,
        approved_by: ['Approved', 'Rejected'].includes(status) ? profile.user_id : undefined,
        ...extra,
      });
      toast.success(`Quotation ${status}`);
      load();
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!quotation) return <p className="text-gray-400 text-sm text-center py-8">Quotation not found.</p>;

  const q = quotation;
  const fmt = (n) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 3 });

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary p-2"><ArrowLeft size={16} /></button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">{q.quotation_id}</h2>
              <StatusBadge status={q.status} />
            </div>
            <p className="text-sm text-gray-400">{q.customers?.company_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => downloadQuotationPDF(q)} className="btn-secondary flex items-center gap-2">
            <Download size={15} /> Download PDF
          </button>
          {onEdit && !['Approved','Invoiced'].includes(q.status) && (
            <button onClick={() => onEdit(q)} className="btn-secondary flex items-center gap-2">
              <Edit2 size={15} /> Edit
            </button>
          )}
          {q.status === 'Draft' && (
            <button onClick={() => handleAction('Sent')} disabled={acting} className="btn-primary flex items-center gap-2">
              <Send size={15} /> Send to Customer
            </button>
          )}
          {canApprove && q.status === 'Sent' && (
            <>
              <button onClick={() => handleAction('Approved')} disabled={acting} className="btn-primary flex items-center gap-2 bg-green-500 hover:bg-green-600">
                <CheckCircle size={15} /> Approve
              </button>
              <button onClick={() => handleAction('Rejected')} disabled={acting} className="btn-secondary flex items-center gap-2 text-red-500 hover:bg-red-50">
                <XCircle size={15} /> Reject
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Info grid */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 mb-4">Quotation Info</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-400 mb-1">Customer</p><p className="font-medium">{q.customers?.company_name}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Contact</p><p className="font-medium">{q.customers?.contact_person}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Prepared By</p><p className="font-medium">{q.users?.name}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Date</p><p className="font-medium">{format(new Date(q.quotation_date), 'dd MMM yyyy')}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Valid Until</p><p className="font-medium">{q.valid_until ? format(new Date(q.valid_until), 'dd MMM yyyy') : '—'}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Requirement</p><p className="font-medium text-xs">{q.requirement_id ?? '—'}</p></div>
            </div>
          </div>

          {/* Line items */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Line Items</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 text-xs text-gray-400 uppercase">
                    <th className="text-left px-5 py-2">#</th>
                    <th className="text-left px-5 py-2">Description</th>
                    <th className="text-center px-3 py-2">Qty</th>
                    <th className="text-center px-3 py-2">Unit</th>
                    <th className="text-right px-5 py-2">Rate</th>
                    <th className="text-right px-5 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {q.quotation_items?.map((item, i) => (
                    <tr key={item.item_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-5 py-3 text-gray-800">{item.description}</td>
                      <td className="px-3 py-3 text-center text-gray-600">{item.quantity}</td>
                      <td className="px-3 py-3 text-center text-gray-500 text-xs">{item.unit}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{fmt(item.unit_rate_kwd)}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-800">{fmt(item.total_kwd ?? item.quantity * item.unit_rate_kwd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-12 text-gray-600"><span>Subtotal</span><span className="font-medium">KWD {fmt(q.subtotal_kwd)}</span></div>
              {Number(q.vat_percent) > 0 && <div className="flex gap-12 text-gray-600"><span>VAT ({q.vat_percent}%)</span><span className="font-medium">KWD {fmt(q.vat_amount_kwd)}</span></div>}
              <div className="flex gap-12 font-bold text-gray-900 text-base border-t border-gray-100 pt-2"><span>Total</span><span>KWD {fmt(q.total_amount_kwd)}</span></div>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Terms & Conditions</h3>
            <p className="text-xs text-gray-500 leading-relaxed">{q.terms_conditions || '—'}</p>
          </div>
          {q.notes && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{q.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}