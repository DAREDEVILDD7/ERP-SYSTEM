import { useState, useRef, useEffect } from 'react';
import { Send, AtSign } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function ChatInputWithMentions({ onSend, sending, placeholder }) {
  const [text,          setText]          = useState('');
  const [showMentions,  setShowMentions]  = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [allUsers,      setAllUsers]      = useState([]);
  const [cursorPos,     setCursorPos]     = useState(0);
  const textareaRef = useRef(null);

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

    const textBefore = val.slice(0, pos);
    const atMatch    = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1]);
      setShowMentions(true);
    } else {
      setShowMentions(false);
      setMentionSearch('');
    }
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const insertMention = (user) => {
    const before  = text.slice(0, cursorPos);
    const after   = text.slice(cursorPos);
    const atIdx   = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${user.name} ` + after;
    setText(newText);
    setShowMentions(false);
    setMentionSearch('');
    setTimeout(() => { textareaRef.current?.focus(); }, 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setShowMentions(false); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!text.trim() || sending) return;
    onSend(text.trim());
    setText('');
    setShowMentions(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const filteredUsers = allUsers.filter(u =>
    !mentionSearch ||
    u.name.toLowerCase().includes(mentionSearch.toLowerCase()) ||
    u.department?.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  return (
    <div className="relative">
      {showMentions && filteredUsers.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mb-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
            <AtSign size={12} className="text-primary-500"/>
            <span className="text-xs text-gray-500 font-medium">
              Tag someone{mentionSearch ? ` — "${mentionSearch}"` : ''}
            </span>
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filteredUsers.map(u => (
              <button key={u.user_id} type="button"
                onMouseDown={e => { e.preventDefault(); insertMention(u); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 text-left transition-colors">
                <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                  <span className="text-primary-600 text-xs font-semibold">{u.name.charAt(0)}</span>
                </div>
                <div className="min-w-0">
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
            ref={textareaRef}
            className="input resize-none text-sm w-full leading-relaxed"
            style={{ minHeight: '40px', maxHeight: '120px', overflow: 'hidden' }}
            placeholder={placeholder ?? 'Type a message… @ to mention, paste KW-QT-XXXX or KW-REQ-XXXX to link'}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="btn-primary px-4 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          style={{ height: '40px' }}
        >
          <Send size={15}/>
        </button>
      </div>
    </div>
  );
}