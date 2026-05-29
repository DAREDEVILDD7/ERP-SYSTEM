import { useEffect, useState, useRef } from 'react';
import { getRequirement, updateRequirement } from '../../api/requirements';
import { getQuotation } from '../../api/quotations';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../common/StatusBadge';
import LoadingSpinner from '../common/LoadingSpinner';
import {
  ArrowLeft, Edit2, FileText, Send, X,
  CheckCircle, AtSign
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const PRIORITY_COLORS = {
  Low:    'bg-gray-100 text-gray-500',
  Normal: 'bg-blue-50 text-blue-600',
  High:   'bg-orange-50 text-orange-600',
  Urgent: 'bg-red-50 text-red-700',
};

// Quotation preview popup
function QuotationPreview({ quotationId, onClose }) {
  const [q,       setQ]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getQuotation(quotationId)
      .then(setQ)
      .catch(() => toast.error('Failed to load quotation'))
      .finally(() => setLoading(false));
  }, [quotationId]);

  const fmt = (n) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 3 });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-semibold text-gray-900">{quotationId}</h3>
            <p className="text-xs text-gray-400">Quotation Preview</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20}/></button>
        </div>
        {loading ? <div className="p-8 flex justify-center"><LoadingSpinner fullscreen={false}/></div> : !q ? (
          <p className="text-gray-400 text-sm text-center p-8">Not found</p>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex gap-2"><StatusBadge status={q.status}/></div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-400">Customer</p><p className="font-medium">{q.customers?.company_name}</p></div>
              <div><p className="text-xs text-gray-400">Prepared By</p><p className="font-medium">{q.users?.name ?? '—'}</p></div>
              <div><p className="text-xs text-gray-400">Date</p><p className="font-medium">{format(new Date(q.quotation_date), 'dd MMM yyyy')}</p></div>
              <div><p className="text-xs text-gray-400">Valid Until</p><p className="font-medium">{q.valid_until ? format(new Date(q.valid_until), 'dd MMM yyyy') : '—'}</p></div>
            </div>
            {q.quotation_items?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-2">Items</p>
                {q.quotation_items.map((item, i) => (
                  <div key={i} className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm mb-1">
                    <p className="text-gray-700">{item.description}</p>
                    <p className="font-medium text-gray-800">KWD {fmt(item.total_kwd ?? item.quantity * item.unit_rate_kwd)}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-gray-100 pt-3 text-right">
              <p className="text-xs text-gray-400">Total</p>
              <p className="text-xl font-bold text-gray-900">KWD {fmt(q.total_amount_kwd)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Rich chat message renderer — handles @mentions and ref links
function ChatMessageContent({ message, messageType, refId, refType, onPreviewQuote, onPreviewReq }) {
  if (messageType === 'system' || messageType === 'quote_ref') {
    return (
      <span className="flex items-center gap-1.5 italic text-xs opacity-90">
        <FileText size={11}/>
        {message.split(/(\bKW-QT-\S+|\bKW-REQ-\S+)/g).map((part, i) => {
          if (/^KW-QT-/.test(part)) {
            return (
              <button key={i} onClick={() => onPreviewQuote?.(part)}
                className="underline font-medium hover:opacity-80 cursor-pointer">
                {part}
              </button>
            );
          }
          if (/^KW-REQ-/.test(part)) {
            return (
              <button key={i} onClick={() => onPreviewReq?.(part)}
                className="underline font-medium hover:opacity-80 cursor-pointer">
                {part}
              </button>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  }

  // Parse @mentions and IDs in regular messages
  const parts = message.split(/(@\w[\w\s]*?\b|KW-QT-[\w-]+|KW-REQ-[\w-]+)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (/^@/.test(part)) {
          return <span key={i} className="font-semibold opacity-90">{part}</span>;
        }
        if (/^KW-QT-/.test(part)) {
          return (
            <button key={i} onClick={() => onPreviewQuote?.(part)}
              className="underline font-semibold hover:opacity-80 cursor-pointer">
              {part}
            </button>
          );
        }
        if (/^KW-REQ-/.test(part)) {
          return (
            <button key={i} onClick={() => onPreviewReq?.(part)}
              className="underline font-semibold hover:opacity-80 cursor-pointer">
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// Chat input with @mention support
function ChatInput({ onSend, sending }) {
  const [text,       setText]       = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [allUsers,   setAllUsers]   = useState([]);
  const [cursorPos,  setCursorPos]  = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    supabase.from('users').select('user_id, name, role, department')
      .eq('is_active', true).order('name')
      .then(({ data }) => setAllUsers(data ?? []));
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setText(val);
    setCursorPos(pos);

    // Detect @ trigger
    const textBefore = val.slice(0, pos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1]);
      setShowMentions(true);
    } else {
      setShowMentions(false);
      setMentionSearch('');
    }
  };

  const insertMention = (user) => {
    const textBefore = text.slice(0, cursorPos);
    const textAfter  = text.slice(cursorPos);
    const atIdx      = textBefore.lastIndexOf('@');
    const newText    = textBefore.slice(0, atIdx) + `@${user.name} ` + textAfter;
    setText(newText);
    setShowMentions(false);
    setMentionSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const filteredUsers = allUsers.filter(u =>
    !mentionSearch ||
    u.name.toLowerCase().includes(mentionSearch.toLowerCase()) ||
    u.department?.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) { onSend(text); setText(''); setShowMentions(false); }
    }
    if (e.key === 'Escape') setShowMentions(false);
  };

  return (
    <div className="relative">
      {/* @mention dropdown */}
      {showMentions && filteredUsers.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mb-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
            <AtSign size={12} className="text-primary-500"/>
            <span className="text-xs text-gray-500 font-medium">Tag a user</span>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filteredUsers.map(u => (
              <button key={u.user_id} type="button"
                onMouseDown={e => { e.preventDefault(); insertMention(u); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 text-left transition-colors">
                <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                  <span className="text-primary-600 text-xs font-semibold">{u.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.role} · {u.department}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            className="input resize-none text-sm leading-relaxed"
            style={{ minHeight: '40px', maxHeight: '120px' }}
            placeholder="Type a message… Use @ to mention someone, paste KW-QT-XXXX or KW-REQ-XXXX to link"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        </div>
        <button
          onClick={() => { if (text.trim()) { onSend(text); setText(''); setShowMentions(false); } }}
          disabled={sending || !text.trim()}
          className="btn-primary px-4 py-2.5 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
        >
          <Send size={15}/>
        </button>
      </div>
    </div>
  );
}

export default function RequirementDetail({ requirementId, onBack, onEdit, canReview }) {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  const [req,     setReq]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [settingOpsReview, setSettingOpsReview] = useState(false);

  // Preview states
  const [previewQuoteId, setPreviewQuoteId] = useState(null);
  const [previewReqId,   setPreviewReqId]   = useState(null);

  // Approve confirmation
  // const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const messagesEndRef = useRef(null);

  const load = async () => {
    try {
      const data = await getRequirement(requirementId);
      setReq(data);
    } catch { toast.error('Failed to load requirement'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [requirementId]); // eslint-disable-line

  useEffect(() => {
    const ch = supabase.channel(`req-detail-${requirementId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `related_requirement=eq.${requirementId}`,
      }, () => load())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'requirements',
        filter: `requirement_id=eq.${requirementId}`,
      }, () => load())
      .subscribe();
    return () => ch.unsubscribe();
  }, [requirementId]); // eslint-disable-line

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [req?.chat_messages]);

  const sendMessage = async (text) => {
    setSending(true);
    try {
      const { error } = await supabase.from('chat_messages').insert({
        related_requirement: requirementId,
        sender_id:    profile.user_id,
        department:   profile.department,
        message:      text.trim(),
        message_type: 'text',
      });
      if (error) throw error;
    } catch { toast.error('Failed to send message');
    } finally { setSending(false); }
  };

  const handleSetOpsReview = async () => {
    setSettingOpsReview(true);
    try {
      await updateRequirement(requirementId, { status: 'Operations Review' });
      toast.success('Status set to Operations Review — you can now create a quotation');
      load();
    } catch { toast.error('Failed to update status');
    } finally { setSettingOpsReview(false); }
  };

  const handleCreateQuotation = () => {
    navigate('/quotations', { state: { requirementId: req.requirement_id } });
  };

  if (loading) return <LoadingSpinner fullscreen={false}/>;
  if (!req)    return <p className="text-gray-400 text-sm text-center py-8">Requirement not found.</p>;

  const canCreateQuote = ['Operations Review','Quotation In Progress','Quoted'].includes(req.status);
  const canSetOpsReview = req.status === 'Pending Review' && canReview;

  const messages = [...(req.chat_messages ?? [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary p-2"><ArrowLeft size={16}/></button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">{req.requirement_id}</h2>
              <StatusBadge status={req.status}/>
              <span className={clsx('badge text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLORS[req.priority ?? 'Normal'])}>
                {req.priority ?? 'Normal'}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-0.5">{req.customers?.company_name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onEdit && ['Pending Review','Operations Review'].includes(req.status) && (
            <button onClick={() => onEdit(req)} className="btn-secondary flex items-center gap-2">
              <Edit2 size={15}/> Edit
            </button>
          )}

          {/* Operations Review button — only for ops/admin when status is Pending Review */}
          {canSetOpsReview && (
            <button onClick={handleSetOpsReview} disabled={settingOpsReview}
              className="btn-secondary flex items-center gap-2 text-blue-600 hover:bg-blue-50">
              {settingOpsReview
                ? <LoadingSpinner fullscreen={false}/>
                : <CheckCircle size={15}/>
              }
              Mark Operations Review Done
            </button>
          )}

          {/* Create Quotation button — visible once ops review done */}
          {canCreateQuote && (
            <button onClick={handleCreateQuotation} className="btn-primary flex items-center gap-2">
              <FileText size={15}/> Create Quotation
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-3">Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-400 mb-1">Customer</p><p className="font-medium text-gray-800">{req.customers?.company_name}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Contact</p><p className="font-medium text-gray-800">{req.requested_by}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Location</p><p className="font-medium text-gray-800">{req.location ?? '—'}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Created By</p><p className="font-medium text-gray-800">{req.users?.name}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">Start Date</p><p className="font-medium text-gray-800">{req.start_date ? format(new Date(req.start_date), 'dd MMM yyyy') : '—'}</p></div>
              <div><p className="text-xs text-gray-400 mb-1">End Date</p><p className="font-medium text-gray-800">{req.end_date ? format(new Date(req.end_date), 'dd MMM yyyy') : '—'}</p></div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-1">Created At</p>
                <p className="font-medium text-gray-800">{format(new Date(req.created_at), 'dd MMM yyyy, HH:mm')}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Summary</p>
              <p className="text-sm text-gray-800 leading-relaxed">{req.requirement_summary}</p>
            </div>
            {req.notes && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-600 leading-relaxed">{req.notes}</p>
              </div>
            )}
          </div>

          {/* Linked quotations */}
          {req.quotations?.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Linked Quotations</h3>
              <div className="space-y-2">
                {req.quotations.map(q => (
                  <div key={q.quotation_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div>
                      <button onClick={() => setPreviewQuoteId(q.quotation_id)}
                        className="font-mono text-primary-600 hover:underline text-sm font-medium">
                        {q.quotation_id}
                      </button>
                      <p className="text-xs text-gray-400">by {q.users?.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={q.status}/>
                      <span className="text-sm font-medium text-gray-700">KWD {Number(q.total_amount_kwd).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — status display + chat */}
        <div className="space-y-4">
          {/* Current status — read only, highlighted */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Current Status</h3>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="w-2.5 h-2.5 rounded-full bg-primary-500 shrink-0"/>
              <p className="text-sm font-semibold text-gray-800">{req.status}</p>
            </div>
            <p className="text-xs text-gray-400 mt-2">Status updates automatically based on workflow actions</p>

            {/* Workflow guide */}
            <div className="mt-3 space-y-1">
              {[
                'Pending Review',
                'Operations Review',
                'Quotation In Progress',
                'Quoted',
                'Approved',
                'Completed',
              ].map((s, i) => (
                <div key={s} className={clsx(
                  'flex items-center gap-2 px-2 py-1 rounded-lg text-xs',
                  req.status === s ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-400'
                )}>
                  <div className={clsx(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    req.status === s ? 'bg-primary-500' : 'bg-gray-200'
                  )}/>
                  {s}
                </div>
              ))}
            </div>
          </div>

          {/* Thread chat */}
          <div className="card flex flex-col" style={{ height: 420 }}>
            <div className="px-4 py-3 border-b border-gray-100 shrink-0">
              <h3 className="text-sm font-semibold text-gray-700">Thread</h3>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {messages.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No messages yet.</p>
              ) : messages.map(m => {
                const isMe     = m.sender_id === profile.user_id;
                const isSystem = m.message_type === 'system' || m.message_type === 'quote_ref';

                if (isSystem) {
                  return (
                    <div key={m.chat_id} className="flex justify-center">
                      <div className="bg-blue-50 border border-blue-100 text-blue-700 rounded-xl px-4 py-2 text-xs max-w-[85%] text-center">
                        <ChatMessageContent
                          message={m.message}
                          messageType={m.message_type}
                          refId={m.ref_id}
                          refType={m.ref_type}
                          onPreviewQuote={setPreviewQuoteId}
                          onPreviewReq={setPreviewReqId}
                        />
                        <p className="text-blue-400 mt-0.5">{format(new Date(m.created_at), 'dd MMM HH:mm')}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.chat_id} className={clsx('flex flex-col', isMe ? 'items-end' : 'items-start')}>
                    {!isMe && (
                      <p className="text-xs text-gray-400 mb-0.5 ml-1">{m.users?.name} · {m.department}</p>
                    )}
                    <div className={clsx(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                      isMe ? 'bg-primary-500 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    )}>
                      <ChatMessageContent
                        message={m.message}
                        messageType={m.message_type}
                        onPreviewQuote={setPreviewQuoteId}
                        onPreviewReq={setPreviewReqId}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5 px-1">
                      {format(new Date(m.created_at), 'dd MMM HH:mm')}
                    </p>
                  </div>
                );
              })}
              <div ref={messagesEndRef}/>
            </div>

            <div className="px-4 py-3 border-t border-gray-100 shrink-0">
              <ChatInput onSend={sendMessage} sending={sending}/>
            </div>
          </div>
        </div>
      </div>

      {/* Quotation preview popup */}
      {previewQuoteId && <QuotationPreview quotationId={previewQuoteId} onClose={() => setPreviewQuoteId(null)}/>}

      {/* Requirement preview popup (for linked req IDs in chat) */}
      {previewReqId && previewReqId !== requirementId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{previewReqId}</h3>
              <button onClick={() => setPreviewReqId(null)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <p className="text-sm text-gray-500 p-5">Requirement preview — navigate to Requirements section to view full details.</p>
          </div>
        </div>
      )}
    </div>
  );
}