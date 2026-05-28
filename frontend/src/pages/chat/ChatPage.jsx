import { useEffect, useState, useRef, useCallback } from 'react';
import { getChatThreads, getChatMessages, sendMessage } from '../../api/chat';
import { getQuotation } from '../../api/quotations';
import { getRequirement } from '../../api/requirements';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import StatusBadge from '../../components/common/StatusBadge';
import ChatInputWithMentions from '../../components/chat/ChatInputWithMentions';
import { MessageSquare, Search, X, FileText, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export default function ChatPage() {
  const { profile } = useAuth();
  const [threads,       setThreads]       = useState([]);
  const [activeReq,     setActiveReq]     = useState(null);
  const [messages,      setMessages]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [msgLoading,    setMsgLoading]    = useState(false);
  const [sending,       setSending]       = useState(false);
  const [search,        setSearch]        = useState('');
  // Preview modals for KW-* IDs clicked inside messages
  const [previewQuoteId,   setPreviewQuoteId]   = useState(null);
  const [previewQuote,     setPreviewQuote]     = useState(null);
  const [previewReqId,     setPreviewReqId]     = useState(null);
  const [previewReq,       setPreviewReq]       = useState(null);
  const [previewLoading,   setPreviewLoading]   = useState(false);
  const bottomRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const data = await getChatThreads(profile.user_id);
      setThreads(data);
    } catch { toast.error('Failed to load chat threads'); }
    finally { setLoading(false); }
  }, [profile.user_id]);

  const loadMessages = useCallback(async (reqId) => {
    if (!reqId) return;
    setMsgLoading(true);
    try {
      const data = await getChatMessages(reqId);
      setMessages(data);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch { toast.error('Failed to load messages'); }
    finally { setMsgLoading(false); }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (!activeReq) return;
    loadMessages(activeReq);
    const ch = supabase.channel(`chat-${activeReq}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `related_requirement=eq.${activeReq}`,
      }, () => loadMessages(activeReq))
      .subscribe();
    return () => ch.unsubscribe();
  }, [activeReq, loadMessages]);

  const handleSend = async (text) => {
    setSending(true);
    try {
      await sendMessage({
        related_requirement: activeReq,
        sender_id:    profile.user_id,
        department:   profile.department,
        message:      text,
        message_type: 'text',
      });
    } catch { toast.error('Failed to send message'); }
    finally { setSending(false); }
  };

  // Load quotation preview when a KW-Q* chip is clicked
  useEffect(() => {
    if (!previewQuoteId) { setPreviewQuote(null); return; }
    setPreviewLoading(true);
    getQuotation(previewQuoteId)
      .then(setPreviewQuote)
      .catch(() => toast.error('Failed to load quotation'))
      .finally(() => setPreviewLoading(false));
  }, [previewQuoteId]);

  // Load requirement preview when a KW-R* chip is clicked
  useEffect(() => {
    if (!previewReqId) { setPreviewReq(null); return; }
    setPreviewLoading(true);
    getRequirement(previewReqId)
      .then(setPreviewReq)
      .catch(() => toast.error('Failed to load requirement'))
      .finally(() => setPreviewLoading(false));
  }, [previewReqId]);

  const filteredThreads = threads.filter(t =>
    !search ||
    t.requirements?.requirement_summary?.toLowerCase().includes(search.toLowerCase()) ||
    t.requirements?.customers?.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  const activeThread = threads.find(t => t.related_requirement === activeReq);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 card overflow-hidden">
      {/* Thread list */}
      <div className={clsx(
        'w-full md:w-72 border-r border-gray-100 flex flex-col shrink-0',
        activeReq ? 'hidden md:flex' : 'flex'
      )}>
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-3">Requirement Threads</h2>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-8 text-sm" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {loading ? (
            <LoadingSpinner fullscreen={false} />
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <MessageSquare size={32} className="opacity-30 mb-2" />
              <p className="text-sm">No chat threads yet</p>
            </div>
          ) : filteredThreads.map(t => (
            <button
              key={t.related_requirement}
              onClick={() => setActiveReq(t.related_requirement)}
              className={clsx(
                'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors',
                activeReq === t.related_requirement && 'bg-primary-50'
              )}
            >
              <p className={clsx('text-sm font-medium truncate', activeReq === t.related_requirement ? 'text-primary-700' : 'text-gray-800')}>
                {t.requirements?.customers?.company_name ?? 'Unknown'}
              </p>
              <p className="text-xs text-gray-400 truncate mt-0.5">
                {t.requirements?.requirement_summary}
              </p>
              <p className="text-xs text-gray-300 mt-0.5 font-mono">{t.related_requirement}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Chat window */}
      <div className={clsx('flex-1 flex flex-col', !activeReq ? 'hidden md:flex' : 'flex')}>
        {!activeReq ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageSquare size={48} className="opacity-20 mb-3" />
            <p className="text-sm">Select a thread to start chatting</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
              <button
                className="md:hidden text-gray-400 hover:text-gray-600"
                onClick={() => setActiveReq(null)}
              >
                ←
              </button>
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 truncate">
                  {activeThread?.requirements?.customers?.company_name}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {activeThread?.requirements?.requirement_summary}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {msgLoading ? (
                <LoadingSpinner fullscreen={false} />
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">No messages yet. Start the conversation.</div>
              ) : messages.map(m => {
                const isMe = m.sender_id === profile.user_id;
                return (
                  <div key={m.chat_id} className={clsx('flex flex-col', isMe ? 'items-end' : 'items-start')}>
                    <div className={clsx(
                      'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      isMe ? 'bg-primary-500 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    )}>
                      <ChatMessageContent
                        text={m.message}
                        isMe={isMe}
                        onQuoteClick={setPreviewQuoteId}
                        onReqClick={setPreviewReqId}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 px-1">
                      {m.users?.name} · {m.department} · {format(new Date(m.created_at), 'dd MMM HH:mm')}
                    </p>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-gray-100">
              <ChatInputWithMentions onSend={handleSend} sending={sending}/>
            </div>
          </>
        )}
      </div>

      {/* ── Quotation preview modal ── */}
      {previewQuoteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary-500"/>
                <div>
                  <h3 className="font-semibold text-gray-900">{previewQuoteId}</h3>
                  <p className="text-xs text-gray-400">Quotation Details</p>
                </div>
              </div>
              <button onClick={() => { setPreviewQuoteId(null); setPreviewQuote(null); }}
                className="text-gray-400 hover:text-gray-600 p-1"><X size={20}/></button>
            </div>
            {previewLoading ? (
              <div className="p-8 flex justify-center"><LoadingSpinner fullscreen={false}/></div>
            ) : !previewQuote ? (
              <p className="text-gray-400 text-sm text-center p-8">Loading…</p>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex gap-2 flex-wrap">
                  <StatusBadge status={previewQuote.status}/>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Customer</p><p className="font-medium">{previewQuote.customers?.company_name ?? '—'}</p></div>
                  <div><p className="text-xs text-gray-400">Prepared By</p><p className="font-medium">{previewQuote.users?.name ?? '—'}</p></div>
                  <div><p className="text-xs text-gray-400">Date</p><p className="font-medium">{format(new Date(previewQuote.quotation_date), 'dd MMM yyyy')}</p></div>
                  <div><p className="text-xs text-gray-400">Valid Until</p><p className="font-medium">{previewQuote.valid_until ? format(new Date(previewQuote.valid_until), 'dd MMM yyyy') : '—'}</p></div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-xs text-gray-400">Total (KWD)</span>
                  <span className="font-bold text-gray-900 text-base">
                    {Number(previewQuote.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })}
                  </span>
                </div>
                {previewQuote.requirement_id && (
                  <div><p className="text-xs text-gray-400">Requirement</p><p className="font-mono text-xs text-gray-600">{previewQuote.requirement_id}</p></div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Requirement preview modal ── */}
      {previewReqId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-primary-500"/>
                <div>
                  <h3 className="font-semibold text-gray-900">{previewReqId}</h3>
                  <p className="text-xs text-gray-400">Requirement Details</p>
                </div>
              </div>
              <button onClick={() => { setPreviewReqId(null); setPreviewReq(null); }}
                className="text-gray-400 hover:text-gray-600 p-1"><X size={20}/></button>
            </div>
            {previewLoading ? (
              <div className="p-8 flex justify-center"><LoadingSpinner fullscreen={false}/></div>
            ) : !previewReq ? (
              <p className="text-gray-400 text-sm text-center p-8">Loading…</p>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex gap-2 flex-wrap">
                  <StatusBadge status={previewReq.status}/>
                  <StatusBadge status={previewReq.priority ?? 'Normal'}/>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Customer</p><p className="font-medium">{previewReq.customers?.company_name ?? '—'}</p></div>
                  <div><p className="text-xs text-gray-400">Contact</p><p className="font-medium">{previewReq.requested_by ?? '—'}</p></div>
                  <div><p className="text-xs text-gray-400">Location</p><p className="font-medium">{previewReq.location ?? '—'}</p></div>
                  <div><p className="text-xs text-gray-400">Created By</p><p className="font-medium">{previewReq.users?.name ?? '—'}</p></div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Summary</p>
                  <p className="text-sm text-gray-800 leading-relaxed">{previewReq.requirement_summary}</p>
                </div>
                {previewReq.notes && (
                  <div className="bg-yellow-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-1">Notes</p>
                    <p className="text-sm text-gray-600">{previewReq.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ChatMessageContent ──────────────────────────────────────────────────────
// Parses a message string and renders:
//   @Name        → blue bold highlight
//   KW-Q-*       → clickable quotation chip (FileText icon)
//   KW-R-* / KW-REQ-* → clickable requirement chip (ClipboardList icon)
//   other KW-*   → generic mono chip
function ChatMessageContent({ text, isMe, onQuoteClick, onReqClick }) {
  if (!text) return null;

  // Tokenise by @mentions and KW-* IDs
  const TOKEN_RE = /(@[\w\s]+(?=\s|$|[^a-zA-Z0-9_]))|(KW-[A-Z0-9]+(?:-[A-Z0-9]+)*)/g;
  const parts = [];
  let last = 0;
  let match;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });

    const raw = match[0];
    if (raw.startsWith('@')) {
      parts.push({ type: 'mention', value: raw });
    } else {
      // Classify KW-* IDs
      const upper = raw.toUpperCase();
      let kind = 'generic';
      if (/^KW-Q/i.test(raw))   kind = 'quotation';
      if (/^KW-R/i.test(raw))   kind = 'requirement';
      parts.push({ type: 'id', kind, value: raw });
    }
    last = match.index + raw.length;
  }

  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.value}</span>;

        if (p.type === 'mention') {
          return (
            <span key={i} className={clsx(
              'font-semibold',
              isMe ? 'text-white/90 underline decoration-dotted' : 'text-primary-600'
            )}>
              {p.value}
            </span>
          );
        }

        // KW-* ID chip
        const isQuote = p.kind === 'quotation';
        const isReq   = p.kind === 'requirement';
        const clickable = isQuote || isReq;

        return (
          <button
            key={i}
            type="button"
            onClick={clickable ? () => isQuote ? onQuoteClick(p.value) : onReqClick(p.value) : undefined}
            className={clsx(
              'inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded mx-0.5 align-middle',
              clickable ? 'cursor-pointer' : 'cursor-default',
              isMe
                ? 'bg-white/20 text-white hover:bg-white/30'
                : isQuote
                  ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100'
                  : isReq
                    ? 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-100'
                    : 'bg-gray-200 text-gray-600 border border-gray-200'
            )}
          >
            {isQuote && <FileText size={10}/>}
            {isReq   && <ClipboardList size={10}/>}
            {p.value}
          </button>
        );
      })}
    </span>
  );
}