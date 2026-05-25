import { useEffect, useState, useRef, useCallback } from 'react';
import { getChatThreads, getChatMessages, sendMessage } from '../../api/chat';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { Send, MessageSquare, Search } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export default function ChatPage() {
  const { profile } = useAuth();
  const [threads,    setThreads]    = useState([]);
  const [activeReq,  setActiveReq]  = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [text,       setText]       = useState('');
  const [sending,    setSending]    = useState(false);
  const [search,     setSearch]     = useState('');
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

  const handleSend = async () => {
    if (!text.trim() || !activeReq) return;
    setSending(true);
    try {
      await sendMessage({
        related_requirement: activeReq,
        sender_id: profile.user_id,
        department: profile.department,
        message: text.trim(),
      });
      setText('');
    } catch { toast.error('Failed to send message'); }
    finally { setSending(false); }
  };

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
                      {m.message}
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
            <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Type a message… (Enter to send)"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              />
              <button
                onClick={handleSend}
                disabled={sending || !text.trim()}
                className="btn-primary px-4 flex items-center gap-2 disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}