import { useEffect, useState, useCallback } from 'react';
import { getCustomers, createCustomer, updateCustomer } from '../../api/customers';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../lib/rolePermissions';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { Plus, Search, Users, X, Loader2, Phone, Mail, Building } from 'lucide-react';
import toast from 'react-hot-toast';

const EMPTY = { company_name:'', contact_person:'', phone:'', email:'', industry:'', address:'', notes:'' };
const INDUSTRIES = ['Oil & Gas','Engineering','Construction','Logistics','Manufacturing','Government','Other'];

export default function CustomersPage() {
  const { role } = useAuth();
  const [customers,   setCustomers]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [showModal,   setShowModal]   = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState(EMPTY);
  const [formLoading, setFormLoading] = useState(false);

  const canWrite = hasPermission(role, 'customers_write');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCustomers(search);
      setCustomers(data);
    } catch { toast.error('Failed to load customers'); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setForm(EMPTY); setSelected(null); setShowModal(true); };
  const openEdit = (c) => { setForm({ company_name: c.company_name, contact_person: c.contact_person, phone: c.phone??'', email: c.email??'', industry: c.industry??'', address: c.address??'', notes: c.notes??'' }); setSelected(c); setShowModal(true); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.company_name.trim())   return toast.error('Enter company name');
    if (!form.contact_person.trim()) return toast.error('Enter contact person');
    setFormLoading(true);
    try {
      if (selected) {
        await updateCustomer(selected.customer_id, form);
        toast.success('Customer updated');
      } else {
        await createCustomer(form);
        toast.success('Customer added');
      }
      setShowModal(false);
      load();
    } catch (err) { toast.error(err.message || 'Failed to save');
    } finally { setFormLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Customers</h2>
          <p className="text-sm text-gray-400">{customers.length} customers</p>
        </div>
        <div className="flex gap-2">
          {canWrite && <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Customer</button>}
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by company or contact…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : customers.length === 0 ? <EmptyState message="No customers found" icon={Users} /> : (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">Company</th>
                  <th className="text-left px-5 py-3">Contact</th>
                  <th className="text-left px-5 py-3">Phone</th>
                  <th className="text-left px-5 py-3">Email</th>
                  <th className="text-left px-5 py-3">Industry</th>
                  {canWrite && <th className="text-left px-5 py-3">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map(c => (
                  <tr key={c.customer_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{c.company_name}</p>
                      <p className="text-xs text-gray-400">{c.customer_id}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{c.contact_person}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{c.phone ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{c.email ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{c.industry ?? '—'}</td>
                    {canWrite && <td className="px-5 py-3"><button onClick={() => openEdit(c)} className="text-xs text-primary-500 hover:underline">Edit</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden grid grid-cols-1 gap-3">
            {customers.map(c => (
              <div key={c.customer_id} className="card p-4" onClick={() => canWrite && openEdit(c)}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                    <Building size={18} className="text-primary-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">{c.company_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{c.contact_person}</p>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {c.phone && <span className="flex items-center gap-1 text-xs text-gray-400"><Phone size={11} />{c.phone}</span>}
                      {c.email && <span className="flex items-center gap-1 text-xs text-gray-400"><Mail size={11} />{c.email}</span>}
                    </div>
                  </div>
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
              <h3 className="font-semibold text-gray-900">{selected ? 'Edit Customer' : 'Add Customer'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                <input className="input" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person *</label>
                  <input className="input" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                  <select className="input" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+965 XXXXXXXX" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : selected ? 'Update' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}