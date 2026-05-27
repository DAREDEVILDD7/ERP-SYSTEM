import { useEffect, useState, useCallback } from 'react';
import { getInvoices, createInvoice, updateInvoice, getPendingQuotations } from '../../api/finance';
import { getPurchaseOrders } from '../../api/procurement';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/common/StatusBadge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import {
  Plus, DollarSign, X, Loader2, RefreshCw,
  Download, CheckCircle, BarChart2, TrendingUp, TrendingDown, Search,
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import { downloadInvoicePDF, downloadZReportPDF } from '../../lib/pdfGenerator';
import { fetchAdminStats } from '../../api/dashboard';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import QuotationDetail from '../../components/quotations/QuotationDetail';
import { Eye } from 'lucide-react';

const FINANCE_TABS   = ['Customer Invoices', 'Procurement Expenses', 'Assets', 'Z Report'];
const STATUSES       = ['All','Draft','Sent','Paid','Overdue','Cancelled'];
const INV_STATUSES   = ['Draft','Sent','Paid','Overdue','Cancelled'];
const ASSET_CATS     = ['Vehicle','Equipment','Property','IT','Furniture','Other'];
const EXPENSE_CATS   = ['Equipment Purchase','Equipment Lease','Spare Parts','Fuel','Maintenance','Other'];

export default function InvoicesPage() {
  const { profile } = useAuth();

  // Tab
  const [finTab, setFinTab] = useState('Customer Invoices');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [viewingQuote, setViewingQuote]   = useState(null);

  // Invoices
  const [invoices,     setInvoices]     = useState([]);
  const [pendingQ,     setPendingQ]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showInvModal, setShowInvModal] = useState(false);
  const [selInv,       setSelInv]       = useState(null);
  const [invForm,      setInvForm]      = useState({
    quotation_id:'', customer_id:'', total_amount_kwd:'', amount_paid_kwd:0,
    status:'Draft', issue_date: new Date().toISOString().split('T')[0],
    due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
    payment_method:'', notes:'',
  });

  // Expenses
  const [expenses,     setExpenses]     = useState([]);
  const [poList,       setPoList]       = useState([]);
  const [showExpModal, setShowExpModal] = useState(false);
  const [expForm,      setExpForm]      = useState({
    po_id:'', vendor_id:'', category:'Equipment Purchase',
    amount_kwd:'', payment_date: new Date().toISOString().split('T')[0],
    payment_method:'Bank Transfer', description:'',
  });

  // Assets
  const [assets,       setAssets]       = useState([]);
  const [showAstModal, setShowAstModal] = useState(false);
  const [astForm,      setAstForm]      = useState({
    name:'', category:'Equipment', value_kwd:'',
    purchase_date:'', depreciation_rate:0, notes:'',
  });

  // Z Report
  const [zData,    setZData]    = useState(null);
  const [zLoading, setZLoading] = useState(false);

  const [formLoading, setFormLoading] = useState(false);

  const loadInvoices = useCallback(async () => {
    const [inv, pq] = await Promise.all([
      getInvoices(statusFilter !== 'All' ? { status: statusFilter } : {}),
      getPendingQuotations(),
    ]);
    setInvoices(inv);
    setPendingQ(pq);
  }, [statusFilter]);

  const loadExpenses = async () => {
    const { data } = await supabase
      .from('finance_expenses')
      .select('*, vendors(name), purchase_orders(po_number)')
      .order('created_at', { ascending: false });
    setExpenses(data ?? []);
  };

  const loadAssets = async () => {
    const { data } = await supabase
      .from('finance_assets')
      .select('*')
      .order('created_at', { ascending: false });
    setAssets(data ?? []);
  };

  const loadPOs = async () => {
    const pos = await getPurchaseOrders();
    setPoList(pos);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadInvoices(), loadExpenses(), loadAssets(), loadPOs()]);
    } catch { toast.error('Failed to load finance data'); }
    finally { setLoading(false); }
  }, [loadInvoices]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const ch = supabase.channel('finance-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, loadAll)
      .subscribe();
    return () => ch.unsubscribe();
  }, [loadAll]);

  // ── Invoice handlers ─────────────────────────────────────
  const handleQuotationSelect = (qId) => {
    const q = pendingQ.find(q => q.quotation_id === qId);
    if (q) setInvForm(f => ({ ...f, quotation_id: qId, customer_id: q.customer_id, total_amount_kwd: q.total_amount_kwd }));
  };

  const handleInvSave = async (e) => {
    e.preventDefault();
    if (!invForm.quotation_id)     return toast.error('Select a quotation');
    if (!invForm.total_amount_kwd) return toast.error('Enter total amount');
    setFormLoading(true);
    try {
      if (selInv) {
        await updateInvoice(selInv.invoice_id, invForm);
        toast.success('Invoice updated');
      } else {
        await createInvoice({ ...invForm, created_by: profile.user_id });
        await supabase.from('quotations').update({ status: 'Invoiced' }).eq('quotation_id', invForm.quotation_id);
        toast.success('Invoice created');
      }
      setShowInvModal(false);
      loadAll();
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  const markPaid = async (inv) => {
    try {
      await updateInvoice(inv.invoice_id, {
        status: 'Paid', amount_paid_kwd: inv.total_amount_kwd,
        payment_date: new Date().toISOString().split('T')[0],
      });
      toast.success('Marked as paid');
      loadAll();
    } catch { toast.error('Failed to mark paid'); }
  };

  // ── Expense handlers ─────────────────────────────────────
  const handleExpSave = async (e) => {
    e.preventDefault();
    if (!expForm.amount_kwd)  return toast.error('Enter amount');
    if (!expForm.category)    return toast.error('Select category');
    setFormLoading(true);
    try {
      const { error } = await supabase.from('finance_expenses').insert({
        ...expForm,
        po_id:     expForm.po_id     || null,
        vendor_id: expForm.vendor_id || null,
        recorded_by: profile.user_id,
        amount_kwd: Number(expForm.amount_kwd),
      });
      if (error) throw error;
      toast.success('Expense recorded');
      setShowExpModal(false);
      loadAll();
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  // ── Asset handlers ────────────────────────────────────────
  const handleAstSave = async (e) => {
    e.preventDefault();
    if (!astForm.name)      return toast.error('Enter asset name');
    if (!astForm.value_kwd) return toast.error('Enter value');
    setFormLoading(true);
    try {
      const { error } = await supabase.from('finance_assets').insert({
        ...astForm, value_kwd: Number(astForm.value_kwd),
        depreciation_rate: Number(astForm.depreciation_rate),
        created_by: profile.user_id,
      });
      if (error) throw error;
      toast.success('Asset added');
      setShowAstModal(false);
      loadAll();
    } catch (err) { toast.error(err.message || 'Failed');
    } finally { setFormLoading(false); }
  };

  // ── Z Report ─────────────────────────────────────────────
  const generateZReport = async () => {
    setZLoading(true);
    try {
      const stats = await fetchAdminStats();
      const totalBilled    = invoices.reduce((s,i) => s + Number(i.total_amount_kwd ?? 0), 0);
      const totalCollected = invoices.filter(i => i.status === 'Paid').reduce((s,i) => s + Number(i.total_amount_kwd ?? 0), 0);
      const expByCategory  = {};
      expenses.forEach(e => { expByCategory[e.category] = (expByCategory[e.category] || 0) + Number(e.amount_kwd); });

      setZData({
        revenue: { totalBilled, totalCollected, outstanding: totalBilled - totalCollected },
        expenses: Object.entries(expByCategory).map(([category, amount_kwd]) => ({ category, amount_kwd })),
        equipment: stats.equipmentByStatus,
        requirements: stats.requirementsByStatus,
      });
      toast.success('Z Report data ready');
    } catch { toast.error('Failed to generate Z Report'); }
    finally { setZLoading(false); }
  };

  // ── Summaries ─────────────────────────────────────────────
  const totalBilled    = invoices.reduce((s,i) => s + Number(i.total_amount_kwd ?? 0), 0);
  const totalCollected = invoices.filter(i => i.status === 'Paid').reduce((s,i) => s + Number(i.total_amount_kwd ?? 0), 0);
  const totalPending   = invoices.filter(i => ['Draft','Sent'].includes(i.status)).reduce((s,i) => s + Number(i.total_amount_kwd ?? 0), 0);
  const totalExpenses  = expenses.reduce((s,e) => s + Number(e.amount_kwd ?? 0), 0);
  const totalAssets    = assets.reduce((s,a) => s + Number(a.value_kwd ?? 0), 0);

  const openInvAdd = () => {
    setInvForm({ quotation_id:'', customer_id:'', total_amount_kwd:'', amount_paid_kwd:0, status:'Draft', issue_date: new Date().toISOString().split('T')[0], due_date: format(addDays(new Date(),30),'yyyy-MM-dd'), payment_method:'', notes:'' });
    setSelInv(null);
    setShowInvModal(true);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Finance</h2>
          <p className="text-sm text-gray-400">Invoices, expenses, assets & reporting</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadAll} className="btn-secondary p-2"><RefreshCw size={16} /></button>
          {finTab === 'Customer Invoices'     && <button onClick={openInvAdd}           className="btn-primary flex items-center gap-2"><Plus size={16}/> New Invoice</button>}
          {finTab === 'Procurement Expenses'  && <button onClick={() => setShowExpModal(true)} className="btn-primary flex items-center gap-2"><Plus size={16}/> Record Expense</button>}
          {finTab === 'Assets'                && <button onClick={() => setShowAstModal(true)} className="btn-primary flex items-center gap-2"><Plus size={16}/> Add Asset</button>}
        </div>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Total Billed',   value: totalBilled,    color:'text-blue-600',   bg:'bg-blue-50',   icon: TrendingUp },
          { label:'Collected',      value: totalCollected, color:'text-green-600',  bg:'bg-green-50',  icon: CheckCircle },
          { label:'Outstanding',    value: totalPending,   color:'text-yellow-600', bg:'bg-yellow-50', icon: DollarSign },
          { label:'Expenses (KWD)', value: totalExpenses,  color:'text-red-600',    bg:'bg-red-50',    icon: TrendingDown },
        ].map(s => (
          <div key={s.label} className={clsx('card p-4 flex items-center gap-3', s.bg)}>
            <s.icon size={20} className={s.color} />
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={clsx('text-base font-bold', s.color)}>
                {s.value.toLocaleString('en-US',{minimumFractionDigits:3})} <span className="text-xs font-normal">KWD</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="card p-1 flex gap-1 overflow-x-auto">
        {FINANCE_TABS.map(t => (
          <button key={t} onClick={() => setFinTab(t)}
            className={clsx('flex-1 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              finTab === t ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-50')}>
            {t}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner fullscreen={false} /> : (
        <>
          {/* ── Customer Invoices ── */}
{finTab === 'Customer Invoices' && (
  <>
    {/* Invoice-specific search */}
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
      <input className="input pl-9 w-full"
        placeholder="Search by invoice ID, customer, or quotation ID…"
        value={invoiceSearch}
        onChange={e => setInvoiceSearch(e.target.value)}/>
      {invoiceSearch && (
        <button onClick={() => setInvoiceSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          <X size={14}/>
        </button>
      )}
    </div>

    {/* Status filter */}
    <div className="flex gap-2 overflow-x-auto">
      {STATUSES.map(s => (
        <button key={s} onClick={() => setStatusFilter(s)}
          className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
            statusFilter === s ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
          {s}
        </button>
      ))}
    </div>

    {/* Filtered invoices */}
    {(() => {
      const q = invoiceSearch.toLowerCase();
      const filteredInv = invoices.filter(inv =>
        !q ||
        inv.invoice_id?.toLowerCase().includes(q) ||
        inv.customers?.company_name?.toLowerCase().includes(q) ||
        inv.quotations?.quotation_id?.toLowerCase().includes(q) ||
        inv.quotations?.requirements?.requirement_summary?.toLowerCase().includes(q)
      );

      if (filteredInv.length === 0) return <EmptyState message="No invoices found" icon={DollarSign}/>;

      return (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">Invoice ID</th>
                  <th className="text-left px-5 py-3">Customer</th>
                  <th className="text-left px-5 py-3">Quotation</th>
                  <th className="text-left px-5 py-3">Issue Date</th>
                  <th className="text-left px-5 py-3">Due Date</th>
                  <th className="text-right px-5 py-3">Total (KWD)</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredInv.map(inv => (
                  <tr key={inv.invoice_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{inv.invoice_id}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{inv.customers?.company_name}</p>
                      {inv.quotations?.requirements?.requirement_summary && (
                        <p className="text-xs text-gray-400 truncate max-w-xs">{inv.quotations.requirements.requirement_summary}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {inv.quotations ? (
                        <button
                          onClick={() => setViewingQuote(inv.quotations.quotation_id)}
                          className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-mono"
                        >
                          <Eye size={12}/> {inv.quotations.quotation_id}
                        </button>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{format(new Date(inv.issue_date),'dd MMM yyyy')}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{inv.due_date ? format(new Date(inv.due_date),'dd MMM yyyy') : '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-800">{Number(inv.total_amount_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</td>
                    <td className="px-5 py-3"><StatusBadge status={inv.status}/></td>
                    <td className="px-5 py-3 flex items-center gap-2">
                      <button onClick={() => downloadInvoicePDF(inv)} className="text-gray-400 hover:text-gray-600"><Download size={15}/></button>
                      {['Draft','Sent'].includes(inv.status) && (
                        <button onClick={() => markPaid(inv)} className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg flex items-center gap-1">
                          <CheckCircle size={12}/> Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {filteredInv.map(inv => (
              <div key={inv.invoice_id} className="card p-4">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-medium text-gray-800">{inv.customers?.company_name}</p>
                  <StatusBadge status={inv.status}/>
                </div>
                <p className="text-xs text-gray-400">{inv.invoice_id}</p>
                {inv.quotations && (
                  <button onClick={() => setViewingQuote(inv.quotations.quotation_id)}
                    className="text-xs text-primary-600 hover:underline flex items-center gap-1 mt-1">
                    <Eye size={11}/> {inv.quotations.quotation_id}
                  </button>
                )}
                <p className="text-sm font-bold text-gray-800 mt-1">KWD {Number(inv.total_amount_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => downloadInvoicePDF(inv)} className="text-xs btn-secondary flex items-center gap-1"><Download size={12}/> PDF</button>
                  {['Draft','Sent'].includes(inv.status) && <button onClick={() => markPaid(inv)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg">Mark Paid</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      );
    })()}

    {/* Quotation detail overlay */}
    {viewingQuote && (
      <div className="fixed inset-0 z-50 bg-white overflow-y-auto p-4 md:p-6">
        <QuotationDetail
          quotationId={viewingQuote}
          onBack={() => setViewingQuote(null)}
          canApprove={false}
          onRefresh={() => {}}
        />
      </div>
    )}
  </>
)}

          {/* ── Procurement Expenses ── */}
          {finTab === 'Procurement Expenses' && (
            <>
              {expenses.length === 0 ? <EmptyState message="No expenses recorded" icon={TrendingDown} /> : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">Date</th>
                        <th className="text-left px-5 py-3">Category</th>
                        <th className="text-left px-5 py-3">Description</th>
                        <th className="text-left px-5 py-3">Vendor</th>
                        <th className="text-left px-5 py-3">PO</th>
                        <th className="text-left px-5 py-3">Amount (KWD)</th>
                        <th className="text-left px-5 py-3">Method</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {expenses.map(e => (
                        <tr key={e.expense_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 text-gray-400 text-xs">{e.payment_date ? format(new Date(e.payment_date),'dd MMM yyyy') : '—'}</td>
                          <td className="px-5 py-3"><span className="badge bg-red-50 text-red-700 border border-red-100">{e.category}</span></td>
                          <td className="px-5 py-3 text-gray-700 max-w-xs"><p className="truncate">{e.description || '—'}</p></td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{e.vendors?.name ?? '—'}</td>
                          <td className="px-5 py-3 text-gray-400 font-mono text-xs">{e.purchase_orders?.po_number ?? '—'}</td>
                          <td className="px-5 py-3 font-semibold text-red-600">{Number(e.amount_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</td>
                          <td className="px-5 py-3 text-gray-400 text-xs">{e.payment_method ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── Assets ── */}
          {finTab === 'Assets' && (
            <>
              {/* Total asset value */}
              <div className="card p-4 bg-blue-50 flex items-center gap-4">
                <TrendingUp size={24} className="text-blue-500" />
                <div>
                  <p className="text-xs text-blue-600 font-medium">Total Asset Value</p>
                  <p className="text-2xl font-bold text-blue-700">{totalAssets.toLocaleString('en-US',{minimumFractionDigits:3})} KWD</p>
                </div>
              </div>

              {assets.length === 0 ? <EmptyState message="No assets recorded" icon={TrendingUp} /> : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                        <th className="text-left px-5 py-3">Asset ID</th>
                        <th className="text-left px-5 py-3">Name</th>
                        <th className="text-left px-5 py-3">Category</th>
                        <th className="text-left px-5 py-3">Value (KWD)</th>
                        <th className="text-left px-5 py-3">Purchase Date</th>
                        <th className="text-left px-5 py-3">Depreciation %</th>
                        <th className="text-left px-5 py-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {assets.map(a => (
                        <tr key={a.asset_id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-mono text-xs text-gray-400">{a.asset_id}</td>
                          <td className="px-5 py-3 font-medium text-gray-800">{a.name}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{a.category}</td>
                          <td className="px-5 py-3 font-semibold text-blue-600">{Number(a.value_kwd).toLocaleString('en-US',{minimumFractionDigits:3})}</td>
                          <td className="px-5 py-3 text-gray-400 text-xs">{a.purchase_date ? format(new Date(a.purchase_date),'dd MMM yyyy') : '—'}</td>
                          <td className="px-5 py-3 text-gray-500">{a.depreciation_rate}%</td>
                          <td className="px-5 py-3 text-gray-400 text-xs max-w-xs"><p className="truncate">{a.notes || '—'}</p></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── Z Report ── */}
          {finTab === 'Z Report' && (
            <div className="card p-6 space-y-6">
              <div className="text-center space-y-2">
                <BarChart2 size={40} className="mx-auto text-primary-500 opacity-60" />
                <h3 className="font-semibold text-gray-800">Z Report — Full Business Summary</h3>
                <p className="text-sm text-gray-400 max-w-md mx-auto">Comprehensive PDF with revenue, expenses, equipment status, and requirements summary.</p>
              </div>

              <div className="flex justify-center gap-3 flex-wrap">
                <button onClick={generateZReport} disabled={zLoading} className="btn-secondary flex items-center gap-2">
                  {zLoading ? <Loader2 size={16} className="animate-spin" /> : <BarChart2 size={16} />}
                  {zLoading ? 'Generating…' : 'Generate Preview'}
                </button>
                {zData && (
                  <button
                    onClick={() => downloadZReportPDF(zData, 'Z Report', `Generated: ${format(new Date(),'dd MMM yyyy HH:mm')}`)}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Download size={16} /> Download Z Report PDF
                  </button>
                )}
              </div>

              {zData && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 bg-green-50 rounded-xl">
                    <p className="text-xs text-green-600 font-medium mb-1">Total Billed</p>
                    <p className="text-xl font-bold text-green-700">{zData.revenue.totalBilled.toLocaleString('en-US',{minimumFractionDigits:3})}</p>
                    <p className="text-xs text-green-500">KWD</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <p className="text-xs text-blue-600 font-medium mb-1">Collected</p>
                    <p className="text-xl font-bold text-blue-700">{zData.revenue.totalCollected.toLocaleString('en-US',{minimumFractionDigits:3})}</p>
                    <p className="text-xs text-blue-500">KWD</p>
                  </div>
                  <div className="p-4 bg-yellow-50 rounded-xl">
                    <p className="text-xs text-yellow-600 font-medium mb-1">Outstanding</p>
                    <p className="text-xl font-bold text-yellow-700">{zData.revenue.outstanding.toLocaleString('en-US',{minimumFractionDigits:3})}</p>
                    <p className="text-xs text-yellow-500">KWD</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Invoice Modal ── */}
      {showInvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{selInv ? 'Edit Invoice' : 'Create Invoice'}</h3>
              <button onClick={() => setShowInvModal(false)}><X size={18} className="text-gray-400"/></button>
            </div>
            <form onSubmit={handleInvSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Approved Quotation *</label>
                <select className="input" value={invForm.quotation_id} onChange={e => handleQuotationSelect(e.target.value)} required>
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
                  <input type="date" className="input" value={invForm.issue_date} onChange={e => setInvForm(f => ({...f, issue_date: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input type="date" className="input" value={invForm.due_date} onChange={e => setInvForm(f => ({...f, due_date: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total (KWD)</label>
                  <input type="number" className="input" value={invForm.total_amount_kwd} onChange={e => setInvForm(f => ({...f, total_amount_kwd: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="input" value={invForm.status} onChange={e => setInvForm(f => ({...f, status: e.target.value}))}>
                    {INV_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={invForm.notes} onChange={e => setInvForm(f => ({...f, notes: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowInvModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Saving…' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Expense Modal ── */}
      {showExpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Record Expense</h3>
              <button onClick={() => setShowExpModal(false)}><X size={18} className="text-gray-400"/></button>
            </div>
            <form onSubmit={handleExpSave} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                  <select className="input" value={expForm.category} onChange={e => setExpForm(f => ({...f, category: e.target.value}))}>
                    {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KWD) *</label>
                  <input type="number" min="0" step="0.001" className="input" value={expForm.amount_kwd} onChange={e => setExpForm(f => ({...f, amount_kwd: e.target.value}))} required/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                  <input type="date" className="input" value={expForm.payment_date} onChange={e => setExpForm(f => ({...f, payment_date: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select className="input" value={expForm.payment_method} onChange={e => setExpForm(f => ({...f, payment_method: e.target.value}))}>
                    {['Bank Transfer','Cash','Cheque','Online'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link to PO</label>
                <select className="input" value={expForm.po_id} onChange={e => {
                  const po = poList.find(p => p.po_id === e.target.value);
                  setExpForm(f => ({...f, po_id: e.target.value, vendor_id: po?.vendor_id ?? f.vendor_id, amount_kwd: po?.total_amount_kwd ?? f.amount_kwd}));
                }}>
                  <option value="">None</option>
                  {poList.map(po => <option key={po.po_id} value={po.po_id}>{po.po_number} — {po.vendors?.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea className="input" rows={2} value={expForm.description} onChange={e => setExpForm(f => ({...f, description: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowExpModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Saving…' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Asset Modal ── */}
      {showAstModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Add Asset</h3>
              <button onClick={() => setShowAstModal(false)}><X size={18} className="text-gray-400"/></button>
            </div>
            <form onSubmit={handleAstSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Asset Name *</label>
                <input className="input" value={astForm.name} onChange={e => setAstForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Company Vehicle — Toyota Land Cruiser" required/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select className="input" value={astForm.category} onChange={e => setAstForm(f => ({...f, category: e.target.value}))}>
                    {ASSET_CATS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Value (KWD) *</label>
                  <input type="number" min="0" step="0.001" className="input" value={astForm.value_kwd} onChange={e => setAstForm(f => ({...f, value_kwd: e.target.value}))} required/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
                  <input type="date" className="input" value={astForm.purchase_date} onChange={e => setAstForm(f => ({...f, purchase_date: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Depreciation % / yr</label>
                  <input type="number" min="0" max="100" step="0.1" className="input" value={astForm.depreciation_rate} onChange={e => setAstForm(f => ({...f, depreciation_rate: e.target.value}))}/>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea className="input" rows={2} value={astForm.notes} onChange={e => setAstForm(f => ({...f, notes: e.target.value}))}/>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAstModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin"/>}
                  {formLoading ? 'Saving…' : 'Add Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}