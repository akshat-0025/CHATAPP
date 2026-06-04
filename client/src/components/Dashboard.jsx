import { useState, useEffect, useRef } from 'react';
import { 
  Send, Search, LogOut, MessageSquare, Check, CheckCheck, 
  Info, X, ChevronRight, User, CircleDot, AlertCircle 
} from 'lucide-react';

export default function Dashboard({ socket, user, token, onLogout }) {
  const [contacts, setContacts] = useState([]);
  const [activeContactId, setActiveContactId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [typingStates, setTypingStates] = useState({}); // userId -> boolean
  const [connected, setConnected] = useState(socket ? socket.connected : false);
  const [apiError, setApiError] = useState('');

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const activeContact = contacts.find(c => c.id === activeContactId);

  // Fetch contacts list on load
  const fetchContacts = async () => {
    try {
      const response = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const data = await response.json();
      setContacts(data);
    } catch (err) {
      console.error(err);
      setApiError('Error loading contact list.');
    }
  };

  // Fetch chat history with active contact
  const fetchMessages = async (contactId) => {
    try {
      const response = await fetch(`/api/messages/${contactId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = await response.json();
      setMessages(data);
      
      // Auto-scroll to bottom after content loads
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      console.error(err);
      setApiError('Error loading messages.');
    }
  };

  useEffect(() => {
    fetchContacts();

    // Setup socket state monitoring
    if (socket) {
      setConnected(socket.connected);
      
      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);

      // Handle real-time user status changes
      socket.on('user_status', ({ userId, online, lastSeen }) => {
        setContacts(prev => prev.map(c => {
          if (c.id === userId) {
            return { ...c, online, lastSeen: lastSeen || c.lastSeen };
          }
          return c;
        }));
      });

      // Handle real-time incoming messages
      socket.on('private_message', (message) => {
        // If the message belongs to the current chat
        const isCurrentChat = 
          (message.sender === userId && message.recipient === activeContactId) || 
          (message.sender === activeContactId && message.recipient === userId);

        if (isCurrentChat) {
          setMessages(prev => [...prev, message]);
          setTimeout(scrollToBottom, 50);

          // If the message is incoming, mark it as read immediately
          if (message.sender === activeContactId) {
            socket.emit('read_receipt', { senderId: activeContactId });
          }
        }

        // Update contacts last message excerpt and unread count in sidebar
        setContacts(prev => prev.map(c => {
          const isSender = c.id === message.sender;
          const isRecipient = c.id === message.recipient;
          
          if (isSender || isRecipient) {
            const isPeer = isSender ? message.sender : message.recipient;
            const updatedUnread = (isSender && !isCurrentChat) ? (c.unreadCount + 1) : c.unreadCount;
            
            return {
              ...c,
              lastMessage: {
                text: message.text,
                sender: message.sender,
                createdAt: message.createdAt
              },
              unreadCount: updatedUnread
            };
          }
          return c;
        }));
      });

      // Handle real-time typing indicators
      socket.on('typing', ({ senderId, isTyping }) => {
        setTypingStates(prev => ({
          ...prev,
          [senderId]: isTyping
        }));
      });

      // Handle real-time read receipts updates
      socket.on('messages_read', ({ readerId }) => {
        if (readerId === activeContactId) {
          setMessages(prev => prev.map(m => {
            if (m.sender === userId) {
              return { ...m, read: true };
            }
            return m;
          }));
        }
      });

      return () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('user_status');
        socket.off('private_message');
        socket.off('typing');
        socket.off('messages_read');
      };
    }
  }, [socket, activeContactId]);

  // Load messages when the active contact changes
  useEffect(() => {
    if (activeContactId) {
      fetchMessages(activeContactId);
      
      // Mark read receipts for new active chat messages
      socket.emit('read_receipt', { senderId: activeContactId });

      // Reset sidebar unread badge
      setContacts(prev => prev.map(c => {
        if (c.id === activeContactId) {
          return { ...c, unreadCount: 0 };
        }
        return c;
      }));
    }
  }, [activeContactId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const userId = user.id;

  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !activeContactId) return;

    // Send private message over Socket.io
    socket.emit('private_message', {
      recipientId: activeContactId,
      text: inputText.trim()
    }, (response) => {
      if (response && !response.success) {
        setApiError(response.error || 'Failed to send message.');
      }
    });

    // Clear message input and reset local typing status
    setInputText('');
    stopTyping();
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    
    // Broadcast typing indicator
    if (activeContactId) {
      socket.emit('typing', { recipientId: activeContactId, isTyping: true });

      // Clear existing timeout
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      // Set timeout to trigger typing stop after 2s of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();
      }, 2000);
    }
  };

  const stopTyping = () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (activeContactId) {
      socket.emit('typing', { recipientId: activeContactId, isTyping: false });
    }
  };

  // Group messages list by Date (Today, Yesterday, DateString)
  const groupMessagesByDate = (messagesList) => {
    const groups = [];
    let lastDateLabel = '';

    messagesList.forEach((m) => {
      const dateLabel = formatDateHeader(m.createdAt);
      if (dateLabel !== lastDateLabel) {
        groups.push({ type: 'date', label: dateLabel });
        lastDateLabel = dateLabel;
      }
      groups.push({ type: 'message', data: m });
    });

    return groups;
  };

  // Helpers for timestamps
  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateHeader = (isoString) => {
    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const formatLastSeen = (isoString) => {
    if (!isoString) return 'never';
    const date = new Date(isoString);
    const diffMs = new Date() - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Filters contacts list by search query
  const filteredContacts = contacts.filter(c => 
    c.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-dark-950 text-gray-200 overflow-hidden font-sans relative">
      {/* Background glow effects */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-brand-600/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-accent-blue/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Main Container */}
      <div className="flex flex-1 relative z-10 w-full h-full">
        
        {/* PANEL 1: Left Contacts Sidebar */}
        <aside className="w-80 md:w-96 flex flex-col border-r border-white/5 bg-dark-950/40 backdrop-blur-md h-full shrink-0">
          
          {/* Sidebar Header */}
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Profile Avatar Bubble */}
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${user.avatarColor || 'from-brand-500 to-brand-700'} flex items-center justify-center text-white text-lg font-bold shadow-md shadow-brand-500/10`}>
                {user.avatarEmoji || '💬'}
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-white truncate max-w-[140px]">{user.username}</span>
                <span className="text-xs flex items-center gap-1.5 text-accent-teal font-medium">
                  <CircleDot className="w-2.5 h-2.5 fill-accent-teal" />
                  {connected ? 'connected' : 'offline'}
                </span>
              </div>
            </div>

            {/* Logout Action */}
            <button
              onClick={onLogout}
              title="Logout"
              className="p-2.5 rounded-xl text-dark-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
            >
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Search bar */}
          <div className="p-3 border-b border-white/5">
            <div className="relative">
              <Search className="w-4 h-4 text-dark-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl glass-input placeholder-dark-500 text-white"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Error alerts banner inside sidebar */}
          {apiError && (
            <div className="m-3 p-3 bg-accent-rose/10 border border-accent-rose/20 text-accent-rose text-xs rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{apiError}</span>
              </div>
              <button onClick={() => setApiError('')} className="text-accent-rose/70 hover:text-accent-rose">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Contacts List Area */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredContacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-dark-500">
                <User className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No contacts found</p>
                <p className="text-xs mt-1">Register other accounts to chat</p>
              </div>
            ) : (
              filteredContacts.map(contact => {
                const isActive = contact.id === activeContactId;
                const isTyping = typingStates[contact.id];
                
                return (
                  <button
                    key={contact.id}
                    onClick={() => setActiveContactId(contact.id)}
                    className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all duration-200 cursor-pointer ${
                      isActive 
                        ? 'bg-brand-600/15 border-l-3 border-brand-500 bg-white/[0.02]' 
                        : 'hover:bg-white/[0.03] border-l-3 border-transparent'
                    }`}
                  >
                    {/* Contact Avatar */}
                    <div className="relative shrink-0">
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${contact.avatarColor} flex items-center justify-center text-lg shadow-md`}>
                        {contact.avatarEmoji}
                      </div>
                      {/* Online status indicator dot */}
                      <div className={`absolute bottom-[-2px] right-[-2px] w-3.5 h-3.5 rounded-full border-2 border-dark-950 flex items-center justify-center ${
                        contact.online ? 'bg-accent-teal' : 'bg-dark-600'
                      }`} />
                    </div>

                    {/* Meta info & text excerpt */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-white truncate text-sm">{contact.username}</span>
                        {contact.lastMessage && (
                          <span className="text-xs text-dark-500 shrink-0">
                            {formatTime(contact.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>

                      {/* Excerpt message or typing status */}
                      <div className="flex items-center justify-between">
                        {isTyping ? (
                          <span className="text-xs text-brand-400 font-semibold animate-pulse">typing...</span>
                        ) : contact.lastMessage ? (
                          <p className="text-xs text-dark-400 truncate pr-2">
                            {contact.lastMessage.sender === userId ? 'You: ' : ''}
                            {contact.lastMessage.text}
                          </p>
                        ) : (
                          <span className="text-xs text-dark-500 italic">No messages yet</span>
                        )}

                        {/* Unread Message Badge */}
                        {contact.unreadCount > 0 && (
                          <span className="px-2 py-0.5 text-[10px] font-bold text-white bg-gradient-to-r from-brand-600 to-brand-500 rounded-full shrink-0 shadow-lg shadow-brand-500/20">
                            {contact.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* PANEL 2: Center Active Chat View */}
        <main className="flex-1 flex flex-col bg-dark-900/30 h-full min-w-0">
          {activeContact ? (
            <>
              {/* Chat Header */}
              <header className="p-4 border-b border-white/5 bg-dark-950/20 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Recipient Avatar */}
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${activeContact.avatarColor} flex items-center justify-center text-lg`}>
                    {activeContact.avatarEmoji}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-white truncate text-sm">{activeContact.username}</span>
                    <span className="text-xs text-dark-400 truncate">
                      {typingStates[activeContact.id] ? (
                        <span className="text-brand-400 font-medium animate-pulse">typing...</span>
                      ) : activeContact.online ? (
                        <span className="text-accent-teal font-medium">Online</span>
                      ) : (
                        <span>Offline • last seen {formatLastSeen(activeContact.lastSeen)}</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Right controls */}
                <button
                  onClick={() => setShowDetailPanel(!showDetailPanel)}
                  className={`p-2 rounded-xl transition-all duration-200 cursor-pointer ${
                    showDetailPanel ? 'text-brand-400 bg-brand-500/10' : 'text-dark-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Info className="w-5 h-5" />
                </button>
              </header>

              {/* Message Feed Container */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-dark-500">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                      <MessageSquare className="w-6 h-6 opacity-30 text-white" />
                    </div>
                    <p className="text-sm font-medium text-white">This is the start of your duo chat</p>
                    <p className="text-xs mt-1 max-w-[280px]">All messages in this session are encrypted and private.</p>
                  </div>
                ) : (
                  groupMessagesByDate(messages).map((item, idx) => {
                    if (item.type === 'date') {
                      return (
                        <div key={`date-${idx}`} className="flex justify-center my-6">
                          <span className="px-3 py-1 text-[11px] font-semibold text-dark-400 bg-white/5 rounded-full uppercase tracking-wider backdrop-blur-sm border border-white/[0.02]">
                            {item.label}
                          </span>
                        </div>
                      );
                    }

                    const msg = item.data;
                    const isSelf = msg.sender === userId;
                    
                    return (
                      <div
                        key={msg._id || idx}
                        className={`flex ${isSelf ? 'justify-end' : 'justify-start'} group`}
                      >
                        <div className={`max-w-[70%] flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
                          {/* Chat bubble body */}
                          <div className={`p-3 rounded-2xl text-sm relative transition-all duration-200 shadow-md ${
                            isSelf
                              ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white rounded-tr-none'
                              : 'glass-panel text-gray-200 rounded-tl-none'
                          }`}>
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                          </div>

                          {/* Message meta & receipt status */}
                          <div className="flex items-center gap-1.5 mt-1.5 px-1 text-[10px] text-dark-500">
                            <span>{formatTime(msg.createdAt)}</span>
                            {isSelf && (
                              msg.read ? (
                                <CheckCheck className="w-3.5 h-3.5 text-accent-blue" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-dark-500" />
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {/* Reference for scroll-to-bottom */}
                <div ref={messagesEndRef} />
              </div>

              {/* Recipient Typing Indicator bubble */}
              {typingStates[activeContact.id] && (
                <div className="px-6 py-2 flex items-center gap-2 shrink-0">
                  <span className="text-xs text-dark-400">{activeContact.username} is typing</span>
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-bounce"></span>
                  </div>
                </div>
              )}

              {/* Chat Input Footer */}
              <footer className="p-3 border-t border-white/5 bg-dark-950/20 shrink-0">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`Type a message to ${activeContact.username}...`}
                    value={inputText}
                    onChange={handleInputChange}
                    className="flex-1 px-4 py-3 rounded-xl text-white placeholder-dark-500 text-sm glass-input"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="p-3 bg-gradient-to-r from-brand-600 to-brand-500 text-white rounded-xl shadow-lg hover:from-brand-500 hover:to-brand-600 transition-all duration-200 flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-none"
                  >
                    <Send className="w-4.5 h-4.5" />
                  </button>
                </form>
              </footer>
            </>
          ) : (
            // Panel 2 Fallback: Empty Chat Window
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-dark-950/10">
              <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-brand-600/20 to-brand-500/5 border border-brand-500/10 flex items-center justify-center mb-6">
                {/* Floating ambient glow */}
                <div className="absolute inset-0 bg-brand-500/10 rounded-3xl filter blur-xl animate-pulse"></div>
                <MessageSquare className="w-12 h-12 text-brand-400" />
              </div>
              <h2 className="text-2xl font-bold text-white font-heading mb-2">No conversation active</h2>
              <p className="text-dark-400 text-sm max-w-sm leading-relaxed mb-6">
                Select a contact from the sidebar list to start a secure duo conversation session.
              </p>
              
              <div className="flex flex-col gap-3 max-w-xs text-left text-xs bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-dark-400">
                <span className="font-semibold text-white text-center mb-1">Duo System Tips:</span>
                <span className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-brand-400 shrink-0 mt-0.5" />
                  <span>Real-time typing triggers are sent as you compose.</span>
                </span>
                <span className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-brand-400 shrink-0 mt-0.5" />
                  <span>Double ticks turn blue once the recipient loads your chat.</span>
                </span>
                <span className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-brand-400 shrink-0 mt-0.5" />
                  <span>If there are no other users, open another browser session to register a new one.</span>
                </span>
              </div>
            </div>
          )}
        </main>

        {/* PANEL 3: Collapsible Details Panel */}
        {activeContact && showDetailPanel && (
          <aside className="w-80 border-l border-white/5 bg-dark-950/40 backdrop-blur-md h-full flex flex-col shrink-0 animate-fade-in">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <span className="font-semibold text-white text-sm">Contact Information</span>
              <button 
                onClick={() => setShowDetailPanel(false)}
                className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Profile body card */}
            <div className="p-6 flex flex-col items-center text-center border-b border-white/5">
              <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${activeContact.avatarColor} flex items-center justify-center text-4xl shadow-lg mb-4`}>
                {activeContact.avatarEmoji}
              </div>
              <h3 className="font-bold text-white text-lg font-heading">{activeContact.username}</h3>
              
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                {activeContact.online ? (
                  <span className="px-2 py-0.5 text-[10px] font-semibold text-accent-teal bg-accent-teal/10 border border-accent-teal/20 rounded-full">
                    Online
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-semibold text-dark-400 bg-white/5 border border-white/5 rounded-full">
                    Offline
                  </span>
                )}
              </div>
            </div>

            {/* Details information fields */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
              <div className="space-y-1">
                <span className="text-xs text-dark-500 uppercase tracking-wider block font-semibold">User ID</span>
                <span className="text-white font-mono text-xs select-all bg-dark-950/50 p-2 rounded-lg border border-white/[0.03] block truncate">
                  {activeContact.id}
                </span>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-dark-500 uppercase tracking-wider block font-semibold">Online Status</span>
                <span className="text-white block">
                  {activeContact.online ? 'Currently connected' : `Offline, last active ${formatLastSeen(activeContact.lastSeen)}`}
                </span>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-dark-500 uppercase tracking-wider block font-semibold">Duo Secure ID</span>
                <span className="text-white text-xs block leading-relaxed italic text-dark-400">
                  End-to-end routing enabled via channel:
                  <code className="block mt-1 font-mono text-[10px] bg-dark-950/50 p-1.5 rounded border border-white/[0.03] text-brand-400 not-italic select-none">
                    socket.io//room::{activeContact.id}
                  </code>
                </span>
              </div>
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t border-white/5 text-center text-xs text-dark-500">
              Private Duo Chat v1.0
            </div>
          </aside>
        )}

      </div>
    </div>
  );
}
