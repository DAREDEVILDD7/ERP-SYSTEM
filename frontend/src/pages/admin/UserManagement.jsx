import { useEffect, useState, useCallback } from 'react';
import { getUsers, updateUser } from '../../api/users';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { X, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const ROLES = ['Admin','Sales Executive','Operations Manager','Warehouse Operator','Dispatch Coordinator','Finance Officer','Maintenance Engineer'];
const DEPTS = ['Admin','Sales','Operations','Warehouse','Dispatch','Finance','Maintenance'];

export default function UserManagement() {
  const [users,       setUsers]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState({});
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await getUsers()); }
    catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (u) => {
    setForm({ name: u.name, role: u.role, department: u.department, username: u.username??'', is_active: u.is_active });
    setSelected(u);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      await updateUser(selected.user_id, form);
      toast.success('User updated');
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message || 'Failed to update');
    } finally { setFormLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          <p className="text-sm text-gray-400">{users.length} users</p>
        </div>
        <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16} /></button>
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">User ID</th>
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-5 py-3">Username</th>
                  <th className="text-left px-5 py-3">Role</th>
                  <th className="text-left px-5 py-3">Department</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.user_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{u.user_id}</td>
                    <td className="px-5 py-3 font-medium text-gray-800">{u.name}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{u.username ?? '—'}</td>
                    <td className="px-5 py-3"><span className="badge bg-blue-50 text-blue-700 border border-blue-100">{u.role}</span></td>
                    <td className="px-5 py-3 text-gray-500">{u.department}</td>
                    <td className="px-5 py-3"><StatusBadge status={u.is_active ? 'Available' : 'Retired'} /></td>
                    <td className="px-5 py-3"><button onClick={() => openEdit(u)} className="text-xs text-primary-500 hover:underline">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {users.map(u => (
              <div key={u.user_id} className="card p-4 flex items-center justify-between" onClick={() => openEdit(u)}>
                <div>
                  <p className="font-medium text-gray-800">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.role} · {u.department}</p>
                  <p className="text-xs text-gray-300 font-mono">{u.username}</p>
                </div>
                <StatusBadge status={u.is_active ? 'Available' : 'Retired'} />
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Edit User</h3>
              <button onClick={() => setSelected(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                  <select className="input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                    {DEPTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-primary-500" />
                <label htmlFor="active" className="text-sm text-gray-700">Active</label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSelected(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : 'Update User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}