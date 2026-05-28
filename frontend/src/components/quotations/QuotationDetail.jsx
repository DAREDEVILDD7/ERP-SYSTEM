import { useEffect, useState } from "react";
import { getQuotation, updateQuotation } from "../../api/quotations";
import StatusBadge from "../common/StatusBadge";
import LoadingSpinner from "../common/LoadingSpinner";
import {
  ArrowLeft,
  Edit2,
  Download,
  CheckCircle,
  XCircle,
  Send,
  User,
} from "lucide-react";
import { format } from "date-fns";
import { downloadQuotationPDF } from "../../lib/pdfGenerator";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";

export default function QuotationDetail({
  quotationId,
  onBack,
  onEdit,
  canApprove,
  onRefresh,
}) {
  const { profile } = useAuth();
  const [quotation, setQuotation] = useState(null);
  const [approver, setApprover] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const data = await getQuotation(quotationId);
      setQuotation(data);

      // Fetch approver separately
      if (data?.approved_by) {
        const { data: u } = await supabase
          .from("users")
          .select("name, role")
          .eq("user_id", data.approved_by)
          .single();
        setApprover(u);
      }
    } catch {
      toast.error("Failed to load quotation");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [quotationId]); // eslint-disable-line

  const handleAction = async (status, extra = {}) => {
    setActing(true);
    try {
      const payload = {
        status,
        ...extra,
      };
      // Always set approved_by when approving or rejecting
      if (["Approved", "Rejected"].includes(status)) {
        payload.approved_by = profile.user_id;
      }
      await updateQuotation(quotationId, payload);
      toast.success(`Quotation ${status}`);
      load();
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || "Action failed");
    } finally {
      setActing(false);
      setShowReject(false);
    }
  };

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!quotation)
    return (
      <p className="text-gray-400 text-sm text-center py-8">
        Quotation not found.
      </p>
    );

  const q = quotation;
  const fmt = (n) =>
    Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 3 });
  const selectedCustomer = q.customers;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary p-2">
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">
                {q.quotation_id}
              </h2>
              <StatusBadge status={q.status} />
            </div>
            <p className="text-sm text-gray-400">
              {selectedCustomer?.company_name}
              {selectedCustomer?.industry && ` — ${selectedCustomer.industry}`}
              {selectedCustomer?.contact_person &&
                ` — ${selectedCustomer.contact_person}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => downloadQuotationPDF(q)}
            className="btn-secondary flex items-center gap-2"
          >
            <Download size={15} /> PDF
          </button>
          {onEdit && !["Approved", "Invoiced"].includes(q.status) && (
            <button
              onClick={() => onEdit(q)}
              className="btn-secondary flex items-center gap-2"
            >
              <Edit2 size={15} /> Edit
            </button>
          )}
          {q.status === "Draft" && (
            <button
              onClick={() => handleAction("Sent")}
              disabled={acting}
              className="btn-primary flex items-center gap-2"
            >
              <Send size={15} /> Send
            </button>
          )}
          {canApprove && q.status === "Sent" && (
            <>
              <button
                onClick={() => setShowApproveConfirm(true)}
                disabled={acting}
                className="btn-primary flex items-center gap-2 bg-green-500 hover:bg-green-600"
              >
                <CheckCircle size={15} /> Approve
              </button>
              <button
                onClick={() => setShowReject(true)}
                disabled={acting}
                className="btn-secondary flex items-center gap-2 text-red-500 hover:bg-red-50"
              >
                <XCircle size={15} /> Reject
              </button>
            </>
          )}
        </div>
      </div>

      {/* Approve confirmation modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <CheckCircle size={18} className="text-green-500"/> Confirm Quotation Approval
            </h3>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Quotation</span><span className="font-mono font-medium">{q.quotation_id}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-medium">{q.customers?.company_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-bold text-gray-900">KWD {Number(q.total_amount_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Items</span><span className="font-medium">{q.quotation_items?.length ?? 0} line items</span></div>
              {q.requirement_id && <div className="flex justify-between"><span className="text-gray-500">Requirement</span><span className="font-mono text-xs">{q.requirement_id}</span></div>}
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-sm text-green-700">
              <p className="font-medium mb-1">Approving will:</p>
              <ul className="text-xs space-y-0.5 list-disc list-inside text-green-600">
                <li>Mark this quotation as Approved</li>
                <li>Reserve the specified equipment</li>
                <li>Create pending dispatch entries</li>
                <li>Update the linked requirement status to Approved</li>
              </ul>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowApproveConfirm(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => { setShowApproveConfirm(false); handleAction('Approved'); }}
                disabled={acting}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                {acting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>}
                Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject note modal */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800">Rejection Reason</h3>
            <textarea
              className="input resize-y"
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Optional: explain why this quotation is being rejected…"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowReject(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleAction("Rejected", { rejection_reason: rejectNote })
                }
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                {acting && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Info */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3 mb-4">
              Quotation Info
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-1">Customer</p>
                <p className="font-medium text-gray-800">
                  {q.customers?.company_name}
                </p>
                {q.customers?.industry && (
                  <p className="text-xs text-gray-400">
                    {q.customers.industry}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Contact</p>
                <p className="font-medium text-gray-800">
                  {q.customers?.contact_person ?? "—"}
                </p>
                {q.customers?.phone && (
                  <p className="text-xs text-gray-400">{q.customers.phone}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Prepared By</p>
                <p className="font-medium text-gray-800">
                  {q.users?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                  <User size={11} /> Approved By
                </p>
                <p
                  className={`font-medium ${approver ? "text-green-700" : "text-gray-300"}`}
                >
                  {approver
                    ? approver.name
                    : q.status === "Rejected"
                      ? "Rejected"
                      : "Pending"}
                </p>
                {approver && (
                  <p className="text-xs text-gray-400">{approver.role}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Created</p>
                <p className="font-medium text-gray-800">
                  {format(new Date(q.quotation_date), "dd MMM yyyy")}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Created At</p>
                <p className="font-medium text-gray-800">
                  {format(new Date(q.created_at), "dd MMM yyyy, HH:mm")}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Valid Until</p>
                <p className="font-medium text-gray-800">
                  {q.valid_until
                    ? format(new Date(q.valid_until), "dd MMM yyyy")
                    : "—"}
                </p>
              </div>
              {q.requirement_id && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 mb-1">Requirement</p>
                  <p className="font-medium text-gray-700 font-mono text-xs">
                    {q.requirement_id}
                  </p>
                </div>
              )}
              {q.rejection_reason && (
                <div className="col-span-2">
                  <p className="text-xs text-red-400 mb-1">Rejection Reason</p>
                  <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2">
                    {q.rejection_reason}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Line Items
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 text-xs text-gray-400 uppercase">
                    <th className="text-left px-5 py-2">#</th>
                    <th className="text-left px-5 py-2">Description</th>
                    <th className="text-center px-3 py-2">Qty</th>
                    <th className="text-center px-3 py-2">Unit</th>
                    <th className="text-left px-3 py-2">Rental Period</th>
                    <th className="text-right px-5 py-2">Rate</th>
                    <th className="text-right px-5 py-2">Discount</th>
                    <th className="text-right px-5 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {q.quotation_items?.map((item, i) => (
                    <tr key={item.item_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-5 py-3">
                        <p className="text-gray-800">{item.description}</p>
                        {item.equipment_id && (
                          <p className="text-xs text-gray-400 font-mono">
                            {item.equipment_id}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600">
                        {item.quantity}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-500 text-xs">
                        {item.unit}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-400">
                        {item.rental_start_date && item.rental_end_date
                          ? `${format(new Date(item.rental_start_date), "dd MMM")} → ${format(new Date(item.rental_end_date), "dd MMM yyyy")}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {fmt(item.unit_rate_kwd)}
                      </td>
                      <td className="px-5 py-3 text-right text-red-500 text-xs">
                        {Number(item.discount_amount ?? 0) > 0
                          ? `-${fmt(item.discount_amount)}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-gray-800">
                        {fmt(
                          Math.max(
                            0,
                            (item.total_kwd ??
                              item.quantity * item.unit_rate_kwd) -
                              Number(item.discount_amount ?? 0),
                          ),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-12 text-gray-600">
                <span>Subtotal</span>
                <span className="font-medium">KWD {fmt(q.subtotal_kwd)}</span>
              </div>
              {Number(q.discount_amount ?? 0) > 0 && (
                <div className="flex gap-12 text-red-500">
                  <span>Discount</span>
                  <span className="font-medium">
                    -KWD {fmt(q.discount_amount)}
                  </span>
                </div>
              )}
              {Number(q.vat_percent) > 0 && (
                <div className="flex gap-12 text-gray-600">
                  <span>VAT ({q.vat_percent}%)</span>
                  <span className="font-medium">
                    KWD {fmt(q.vat_amount_kwd)}
                  </span>
                </div>
              )}
              <div className="flex gap-12 font-bold text-gray-900 text-base border-t border-gray-100 pt-2">
                <span>Total</span>
                <span>KWD {fmt(q.total_amount_kwd)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Terms & Conditions
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              {q.terms_conditions || "—"}
            </p>
          </div>
          {q.notes && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Notes
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed">{q.notes}</p>
            </div>
          )}
          {q.requirement_id && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Linked Requirement
              </h3>
              <p className="text-xs text-gray-400 font-mono mb-2">
                {q.requirement_id}
              </p>
              {q.requirements?.requirement_summary && (
                <p className="text-sm text-gray-600 mb-3">
                  {q.requirements.requirement_summary}
                </p>
              )}
              <button
                onClick={() =>
                  navigate("/requirements", {
                    state: { highlightId: q.requirement_id },
                  })
                }
                className="btn-secondary text-xs flex items-center gap-1 w-full justify-center"
              >
                <ExternalLink size={12} /> View Requirement
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}