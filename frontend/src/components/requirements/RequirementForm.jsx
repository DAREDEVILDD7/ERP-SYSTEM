import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  createRequirement,
  updateRequirement,
  getCustomers,
} from "../../api/requirements";
import { ArrowLeft, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useDraft } from "../../hooks/useDraft";

export default function RequirementForm({ existing, onSuccess, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!existing;

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const INITIAL_FORM = {
    customer_id: existing?.customer_id ?? "",
    requested_by: existing?.requested_by ?? "",
    requirement_summary: existing?.requirement_summary ?? "",
    location: existing?.location ?? "",
    start_date: existing?.start_date ?? "",
    end_date: existing?.end_date ?? "",
    notes: existing?.notes ?? "",
  };

  const [form, setForm] = useDraft(
    isEdit ? `req-edit-${existing?.requirement_id}` : "req-new",
    INITIAL_FORM,
  );

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch(() => toast.error("Failed to load customers"));
  }, []);

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id) return toast.error("Please select a customer");
    if (!form.requested_by.trim())
      return toast.error("Please enter the contact name");
    if (!form.requirement_summary.trim())
      return toast.error("Please describe the requirement");

    setLoading(true);
    try {
      const payload = { ...form, created_by: profile.user_id };
      if (isEdit) {
        await updateRequirement(existing.requirement_id, form);
        toast.success("Requirement updated");
      } else {
        await createRequirement(payload);
        toast.success("Requirement created successfully");
      }
      onSuccess();
    } catch (err) {
      toast.error(err.message || "Failed to save requirement");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="btn-secondary p-2">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? "Edit Requirement" : "New Requirement"}
          </h2>
          <p className="text-sm text-gray-400">
            {isEdit
              ? `Editing ${existing.requirement_id}`
              : "Create a new requirement ticket"}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Customer */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Customer <span className="text-red-500">*</span>
          </label>
          <select
            className="input"
            value={form.customer_id}
            onChange={(e) => set("customer_id", e.target.value)}
            required
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.company_name} — {c.contact_person}
              </option>
            ))}
          </select>
        </div>

        {/* Requested by */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Requested By (Contact Name) <span className="text-red-500">*</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Hassan Shaikh"
            value={form.requested_by}
            onChange={(e) => set("requested_by", e.target.value)}
            required
          />
        </div>

        {/* Summary */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Requirement Summary <span className="text-red-500">*</span>
          </label>
          <textarea
            className="input min-h-[100px] resize-y"
            placeholder="Describe what the customer needs…"
            value={form.requirement_summary}
            onChange={(e) => set("requirement_summary", e.target.value)}
            required
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Location
          </label>
          <input
            className="input"
            placeholder="e.g. Ahmadi, Shuwaikh"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </div>

        {/* Status info note */}
        {!isEdit && (
          <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-xl border border-blue-100">
            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/>
            <p className="text-xs text-blue-700">New requirements start with <span className="font-semibold">Pending Review</span> status and progress automatically</p>
          </div>
        )}

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              className="input"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              className="input"
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            className="input resize-y"
            rows={3}
            placeholder="Any additional notes…"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? "Saving…" : isEdit ? "Update" : "Create Requirement"}
          </button>
        </div>
      </form>
    </div>
  );
}