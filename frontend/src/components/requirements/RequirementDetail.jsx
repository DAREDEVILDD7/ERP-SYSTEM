import { useEffect, useState } from "react";
import { getRequirement, updateRequirement } from "../../api/requirements";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../common/StatusBadge";
import LoadingSpinner from "../common/LoadingSpinner";
import { ArrowLeft, Edit2, MessageSquare, Send, FileText } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import clsx from "clsx";

const STATUSES = [
  "Pending Review",
  "Operations Review",
  "Quotation In Progress",
  "Quoted",
  "Approved",
  "Rejected",
  "Completed",
  "Cancelled",
];

export default function RequirementDetail({
  requirementId,
  onBack,
  onEdit,
  canReview,
}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const data = await getRequirement(requirementId);
      setReq(data);
    } catch {
      toast.error("Failed to load requirement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [requirementId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const channel = supabase
      .channel(`req-detail-${requirementId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `related_requirement=eq.${requirementId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => channel.unsubscribe();
  }, [requirementId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.from("chat_messages").insert({
        related_requirement: requirementId,
        sender_id: profile.user_id,
        department: profile.department,
        message: message.trim(),
      });
      if (error) throw error;
      setMessage("");
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await updateRequirement(requirementId, { status: newStatus });
      toast.success(`Status updated to "${newStatus}"`);
      load();
    } catch {
      toast.error("Failed to update status");
    }
  };

  if (loading) return <LoadingSpinner fullscreen={false} />;
  if (!req)
    return (
      <p className="text-gray-400 text-sm text-center py-8">
        Requirement not found.
      </p>
    );

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
                {req.requirement_id}
              </h2>
              <StatusBadge status={req.status} />
              <StatusBadge status={req.priority ?? "Normal"} />
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              {req.customers?.company_name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onEdit && (
            <button
              onClick={() => onEdit(req)}
              className="btn-secondary flex items-center gap-2"
            >
              <Edit2 size={15} /> Edit
            </button>
          )}
          <button
            onClick={() =>
              navigate("/quotations", {
                state: { requirementId: req.requirement_id },
              })
            }
            className="btn-primary flex items-center gap-2"
          >
            <FileText size={15} /> Create Quotation
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">
              Details
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-1">Customer</p>
                <p className="font-medium text-gray-800">
                  {req.customers?.company_name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Contact</p>
                <p className="font-medium text-gray-800">{req.requested_by}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Location</p>
                <p className="font-medium text-gray-800">
                  {req.location ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Created By</p>
                <p className="font-medium text-gray-800">{req.users?.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Start Date</p>
                <p className="font-medium text-gray-800">
                  {req.start_date
                    ? format(new Date(req.start_date), "dd MMM yyyy")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">End Date</p>
                <p className="font-medium text-gray-800">
                  {req.end_date
                    ? format(new Date(req.end_date), "dd MMM yyyy")
                    : "—"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Summary</p>
              <p className="text-sm text-gray-800 leading-relaxed">
                {req.requirement_summary}
              </p>
            </div>
            {req.notes && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {req.notes}
                </p>
              </div>
            )}
          </div>

          {/* Linked quotations */}
          {req.quotations?.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Linked Quotations
              </h3>
              <div className="space-y-2">
                {req.quotations.map((q) => (
                  <div
                    key={q.quotation_id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <span className="text-sm font-mono text-gray-600">
                      {q.quotation_id}
                    </span>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={q.status} />
                      <span className="text-sm font-medium text-gray-700">
                        {Number(q.total_amount_kwd).toLocaleString()} KWD
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Status update */}
          {canReview && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Update Status
              </h3>
              <div className="space-y-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className={clsx(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                      req.status === s
                        ? "bg-primary-50 text-primary-600 font-medium"
                        : "text-gray-600 hover:bg-gray-50",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Thread chat */}
          <div className="card p-5 flex flex-col" style={{ maxHeight: 400 }}>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <MessageSquare size={15} /> Thread
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 mb-3 min-h-0">
              {!req.chat_messages || req.chat_messages.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  No messages yet.
                </p>
              ) : (
                req.chat_messages.map((m) => (
                  <div
                    key={m.chat_id}
                    className={clsx(
                      "flex flex-col",
                      m.sender_id === profile.user_id
                        ? "items-end"
                        : "items-start",
                    )}
                  >
                    <div
                      className={clsx(
                        "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                        m.sender_id === profile.user_id
                          ? "bg-primary-500 text-white"
                          : "bg-gray-100 text-gray-800",
                      )}
                    >
                      {m.message}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5 px-1">
                      {m.users?.name} · {m.department} ·{" "}
                      {format(new Date(m.created_at), "dd MMM HH:mm")}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Type a message…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button
                onClick={sendMessage}
                disabled={sending}
                className="btn-primary px-3"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
