import { useEffect, useState, useCallback } from "react";
import {
  getMaintenanceJobs,
  createMaintenanceJob,
  updateMaintenanceJob,
} from "../../api/maintenance";
import { getEquipmentUnits } from "../../api/equipment";
import { getUsers } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../lib/rolePermissions";
import StatusBadge from "../../components/common/StatusBadge";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import EmptyState from "../../components/common/EmptyState";
import { Plus, Wrench, X, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "../../lib/supabaseClient";
import toast from "react-hot-toast";

const STATUSES = ["All", "Open", "In Progress", "Completed", "Cancelled"];
const MNT_STATUSES = ["Open", "In Progress", "Completed", "Cancelled"];
const ISSUE_TYPES = [
  "Mechanical",
  "Electrical",
  "Hydraulic",
  "Tyre",
  "Cooling",
  "Body",
  "Other",
];

const EMPTY = {
  equipment_id: "",
  issue: "",
  issue_type: "Mechanical",
  service_date: "",
  cost_kwd: 0,
  status: "Open",
  notes: "",
  assigned_to: "",
};

export default function MaintenanceJobsPage() {
  const { profile, role } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formLoading, setFormLoading] = useState(false);

  const canWrite = hasPermission(role, "maintenance_create");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, e, u] = await Promise.all([
        getMaintenanceJobs(
          statusFilter !== "All" ? { status: statusFilter } : {},
        ),
        getEquipmentUnits(),
        getUsers(),
      ]);
      setJobs(j);
      setEquipment(e);
      setEngineers(
        u.filter(
          (u) =>
            u.role === "Maintenance Engineer" ||
            u.role === "Operations Manager",
        ),
      );
    } catch {
      toast.error("Failed to load maintenance jobs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("maintenance-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "maintenance" },
        load,
      )
      .subscribe();
    return () => ch.unsubscribe();
  }, [load]);

  const openAdd = () => {
    setForm({ ...EMPTY, service_date: new Date().toISOString().split("T")[0] });
    setSelected(null);
    setShowModal(true);
  };
  const openEdit = (j) => {
    setForm({
      equipment_id: j.equipment_id,
      issue: j.issue,
      issue_type: j.issue_type ?? "Mechanical",
      service_date: j.service_date ?? "",
      cost_kwd: j.cost_kwd ?? 0,
      status: j.status,
      notes: j.notes ?? "",
      assigned_to: j.assigned_to ?? "",
    });
    setSelected(j);
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.equipment_id) return toast.error("Select equipment");
    if (!form.issue.trim()) return toast.error("Describe the issue");
    setFormLoading(true);
    try {
      if (selected) {
        await updateMaintenanceJob(selected.maintenance_id, form);
        toast.success("Job updated");
      } else {
        await createMaintenanceJob({ ...form, reported_by: profile.user_id });
        toast.success("Maintenance job created");
      }
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.message || "Failed to save");
    } finally {
      setFormLoading(false);
    }
  };

  const quickComplete = async (job) => {
    // The DB trigger will auto-set equipment to Available
    // But we confirm with user first
    const confirmed = window.confirm(
      `Mark maintenance "${job.issue}" as completed?\n\n` +
        `Equipment ${job.equipment_units?.equipment_id} will automatically be set to "Available" status.`,
    );
    if (!confirmed) return;

    try {
      await updateMaintenanceJob(job.maintenance_id, {
        status: "Completed",
        completion_date: new Date().toISOString().split("T")[0],
      });
      toast.success(
        `Job completed — ${job.equipment_units?.equipment_id} is now Available`,
      );
      load();
    } catch {
      toast.error("Failed to complete job");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Maintenance Jobs
          </h2>
          <p className="text-sm text-gray-400">{jobs.length} jobs</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary p-2">
            <RefreshCw size={16} />
          </button>
          {canWrite && (
            <button
              onClick={openAdd}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} /> Log Issue
            </button>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex gap-2 overflow-x-auto">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === s ? "bg-primary-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner fullscreen={false} />
      ) : jobs.length === 0 ? (
        <EmptyState message="No maintenance jobs" icon={Wrench} />
      ) : (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">ID</th>
                  <th className="text-left px-5 py-3">Equipment</th>
                  <th className="text-left px-5 py-3">Issue</th>
                  <th className="text-left px-5 py-3">Type</th>
                  <th className="text-left px-5 py-3">Service Date</th>
                  <th className="text-left px-5 py-3">Cost (KWD)</th>
                  <th className="text-left px-5 py-3">Status</th>
                  {canWrite && <th className="text-left px-5 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map((j) => (
                  <tr key={j.maintenance_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">
                      {j.maintenance_id}
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">
                        {j.equipment_units?.equipment_types?.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {j.equipment_units?.equipment_id} ·{" "}
                        {j.equipment_units?.location}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-gray-700 max-w-xs">
                      <p className="truncate">{j.issue}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {j.issue_type ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {j.service_date
                        ? format(new Date(j.service_date), "dd MMM yyyy")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {Number(j.cost_kwd ?? 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={j.status} />
                    </td>
                    {canWrite && (
                      <td className="px-5 py-3 flex items-center gap-2">
                        {["Open", "In Progress"].includes(j.status) && (
                          <button
                            onClick={() => quickComplete(j)}
                            className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg"
                          >
                            ✓ Complete
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(j)}
                          className="text-xs text-primary-500 hover:underline"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {jobs.map((j) => (
              <div
                key={j.maintenance_id}
                className="card p-4"
                onClick={() => canWrite && openEdit(j)}
              >
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">
                    {j.equipment_units?.equipment_types?.name}
                  </p>
                  <StatusBadge status={j.status} />
                </div>
                <p className="text-sm text-gray-600 mt-1">{j.issue}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {j.issue_type} · {j.equipment_units?.equipment_id}
                </p>
                {canWrite && ["Open", "In Progress"].includes(j.status) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      quickComplete(j.maintenance_id);
                    }}
                    className="mt-2 text-xs bg-green-500 text-white px-3 py-1 rounded-lg"
                  >
                    Mark Complete
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                {selected ? "Edit Job" : "Log Maintenance Issue"}
              </h3>
              <button onClick={() => setShowModal(false)}>
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Equipment *
                </label>
                <select
                  className="input"
                  value={form.equipment_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, equipment_id: e.target.value }))
                  }
                  required
                >
                  <option value="">Select equipment…</option>
                  {equipment.map((e) => (
                    <option key={e.equipment_id} value={e.equipment_id}>
                      {e.equipment_id} — {e.equipment_types?.name} ({e.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Issue Description *
                </label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.issue}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, issue: e.target.value }))
                  }
                  placeholder="Describe the issue in detail…"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Issue Type
                  </label>
                  <select
                    className="input"
                    value={form.issue_type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, issue_type: e.target.value }))
                    }
                  >
                    {ISSUE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value }))
                    }
                  >
                    {MNT_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Service Date
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={form.service_date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, service_date: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost (KWD)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="input"
                    value={form.cost_kwd}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cost_kwd: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign To
                </label>
                <select
                  className="input"
                  value={form.assigned_to}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, assigned_to: e.target.value }))
                  }
                >
                  <option value="">Unassigned</option>
                  {engineers.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="btn-primary flex items-center gap-2"
                >
                  {formLoading && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {formLoading ? "Saving…" : selected ? "Update" : "Log Issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
