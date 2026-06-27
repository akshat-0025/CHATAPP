import { useState, useEffect, useRef } from 'react';
import { 
  Send, Search, LogOut, MessageSquare, Check, CheckCheck, 
  Info, X, ChevronRight, User, CircleDot, AlertCircle, ChevronLeft,
  Plus, Lock, Settings, Link, Copy, Edit3, Trash2, Smile, Clock, Sparkles
} from 'lucide-react';
import { deriveKey, encryptMessage, decryptMessage } from '../utils/crypto';

export default function Dashboard({ socket, user, token, onLogout, onUpdateUser }) {
  const [contacts, setContacts] = useState([]);
  const [activeContactId, setActiveContactId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [typingStates, setTypingStates] = useState({}); // userId -> boolean
  const [connected, setConnected] = useState(socket ? socket.connected : false);
  const [apiError, setApiError] = useState('');

  // E2EE and Phase 1 Upgrades States
  const [activeChatKey, setActiveChatKey] = useState(null);
  const [selfDestructType, setSelfDestructType] = useState('forever');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [toastMessage, setToastMessage] = useState('');
  
  // Chat Invite Link States
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteExpiresType, setInviteExpiresType] = useState('24h');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Reset generated link when expiration choice changes in the invite modal
  useEffect(() => {
    setGeneratedInviteLink('');
  }, [inviteExpiresType]);

  // Profile Settings States
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileStatus, setProfileStatus] = useState(user.statusMessage || 'Available');
  const [profileEmoji, setProfileEmoji] = useState(user.avatarEmoji || '💬');
  const [profileColor, setProfileColor] = useState(user.avatarColor || 'from-purple-500 to-indigo-500');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Editing and Searching States
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [activeMobileMessageId, setActiveMobileMessageId] = useState(null);

  // Start New Chat Modal States
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState('');
  const [newChatError, setNewChatError] = useState('');
  const [newChatLoading, setNewChatLoading] = useState(false);

  const messageContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const activeContact = contacts.find(c => c.id === activeContactId);
  const userId = user.id || user._id;

  // E2EE helper to decrypt a list of messages
  const decryptMessagesList = async (list, key) => {
    if (!key) return list;
    return Promise.all(list.map(async (msg) => {
      try {
        if (msg.text.startsWith('E2EE:')) {
          const decrypted = await decryptMessage(msg.text, key);
          return { ...msg, text: decrypted };
        }
      } catch (err) {
        console.error('Error decrypting message:', err);
      }
      return msg;
    }));
  };

  // E2EE helper to decrypt last message excerpts in sidebar
  const decryptContactsList = async (contactsList) => {
    return Promise.all(contactsList.map(async (c) => {
      if (c.lastMessage && c.lastMessage.text.startsWith('E2EE:')) {
        try {
          const key = await deriveKey(userId, c.id);
          const decryptedText = await decryptMessage(c.lastMessage.text, key);
          return {
            ...c,
            lastMessage: { ...c.lastMessage, text: decryptedText }
          };
        } catch (err) {
          console.error(`Failed to decrypt sidebar excerpt for ${c.username}:`, err);
        }
      }
      return c;
    }));
  };

  // Fetch contacts list (runs once or on token change)
  const fetchContacts = async () => {
    try {
      const response = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const data = await response.json();
      const decrypted = await decryptContactsList(data);
      setContacts(decrypted);
    } catch (err) {
      console.error(err);
      setApiError('Error loading contact list.');
    }
  };

  // Fetch chat history with active contact
  const fetchMessages = async (contactId, key) => {
    try {
      const response = await fetch(`/api/messages/${contactId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = await response.json();
      const decrypted = await decryptMessagesList(data, key);
      setMessages(decrypted);
      
      // Auto-scroll to bottom after content loads
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      console.error(err);
      setApiError('Error loading messages.');
    }
  };

  // Initial load
  useEffect(() => {
    fetchContacts();
  }, [token]);

  // Keep countdown times fresh
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Toast auto-clear
  useEffect(() => {
    if (toastMessage) {
      const t = setTimeout(() => setToastMessage(''), 3000);
      return () => clearTimeout(t);
    }
  }, [toastMessage]);

  // Check for invite links to accept
  useEffect(() => {
    const inviteCode = localStorage.getItem('pending_invite_code');
    if (inviteCode && token) {
      localStorage.removeItem('pending_invite_code');
      
      fetch(`/api/chat-links/${inviteCode}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Failed to accept invite');
          
          setContacts(prev => {
            const exists = prev.some(c => c.id === data.creator.id);
            if (exists) return prev;
            return [data.creator, ...prev];
          });
          setActiveContactId(data.creator.id);
          setToastMessage(`Securely connected with ${data.creator.username}!`);
        })
        .catch(err => {
          console.error('Accept invite link error:', err);
          setApiError(err.message || 'Failed to establish connection via invite link.');
        });
    }
  }, [token]);

  // Derive E2EE Key when Active Contact Changes
  useEffect(() => {
    if (activeContactId && userId) {
      setActiveChatKey(null);
      deriveKey(userId, activeContactId)
        .then(key => {
          setActiveChatKey(key);
        })
        .catch(err => {
          console.error('E2EE key derivation failed:', err);
          setApiError('Failed to establish E2EE channel.');
        });
    } else {
      setActiveChatKey(null);
    }
  }, [activeContactId, userId]);

  // Load chat messages when Contact and Key are established
  useEffect(() => {
    if (activeContactId && activeChatKey) {
      fetchMessages(activeContactId, activeChatKey);
      
      // Mark read receipts
      socket.emit('read_receipt', { senderId: activeContactId });

      // Reset sidebar unread badge
      setContacts(prev => prev.map(c => {
        if (c.id === activeContactId) {
          return { ...c, unreadCount: 0 };
        }
        return c;
      }));
    }
  }, [activeContactId, activeChatKey]);

  // Socket.IO event subscribers
  useEffect(() => {
    if (socket) {
      setConnected(socket.connected);
      
      const onConnect = () => setConnected(true);
      const onDisconnect = () => setConnected(false);

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);

      // Handle user online/offline status changes
      socket.on('user_status', ({ userId: statusUserId, online, lastSeen }) => {
        setContacts(prev => prev.map(c => {
          if (c.id === statusUserId) {
            return { ...c, online, lastSeen: lastSeen || c.lastSeen };
          }
          return c;
        }));
      });

      // Handle real-time profile updates
      socket.on('user_profile_updated', ({ userId: profileUserId, avatarEmoji, avatarColor, statusMessage }) => {
        setContacts(prev => prev.map(c => {
          if (c.id === profileUserId) {
            return { ...c, avatarEmoji, avatarColor, statusMessage };
          }
          return c;
        }));
      });

      // Handle real-time incoming messages
      socket.on('private_message', (message) => {
        const isCurrentChat = 
          (message.sender === userId && message.recipient === activeContactId) || 
          (message.sender === activeContactId && message.recipient === userId);

        // Process message decrypt asynchronously
        const processIncomingMessage = async () => {
          try {
            let decryptedText = message.text;
            
            if (message.text.startsWith('E2EE:')) {
              const partnerId = message.sender === userId ? message.recipient : message.sender;
              const key = (isCurrentChat && activeChatKey) ? activeChatKey : await deriveKey(userId, partnerId);
              decryptedText = await decryptMessage(message.text, key);
            }

            const decryptedMessage = { ...message, text: decryptedText };

            if (isCurrentChat) {
              setMessages(prev => [...prev, decryptedMessage]);
              setTimeout(scrollToBottom, 50);

              if (message.sender === activeContactId) {
                socket.emit('read_receipt', { senderId: activeContactId });
              }
            }

            // Update sidebar contact snippet
            setContacts(prev => prev.map(c => {
              const isSender = c.id === message.sender;
              const isRecipient = c.id === message.recipient;
              
              if (isSender || isRecipient) {
                const updatedUnread = (isSender && !isCurrentChat) ? (c.unreadCount + 1) : c.unreadCount;
                return {
                  ...c,
                  lastMessage: {
                    text: decryptedText,
                    sender: message.sender,
                    createdAt: message.createdAt
                  },
                  unreadCount: updatedUnread
                };
              }
              return c;
            }));
          } catch (err) {
            console.error('Error handling incoming private_message:', err);
            // Safe fallback: append message as-is to ensure real-time updates don't stall
            if (isCurrentChat) {
              setMessages(prev => [...prev, message]);
              setTimeout(scrollToBottom, 50);
            }
          }
        };

        processIncomingMessage();
      });

      // Handle typing status
      socket.on('typing', ({ senderId, isTyping }) => {
        setTypingStates(prev => ({
          ...prev,
          [senderId]: isTyping
        }));
      });

      // Handle message read receipts
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

      // Handle message editing
      socket.on('message_edited', ({ messageId, text, isEdited }) => {
        const decryptAndEdit = async () => {
          let displayText = text;
          if (text.startsWith('E2EE:') && activeChatKey) {
            displayText = await decryptMessage(text, activeChatKey);
          }
          
          setMessages(prev => prev.map(m => {
            if (m._id === messageId) {
              return { ...m, text: displayText, isEdited };
            }
            return m;
          }));
        };
        decryptAndEdit();
      });

      // Handle message deletion
      socket.on('message_deleted', ({ messageId, text, isDeleted }) => {
        setMessages(prev => prev.map(m => {
          if (m._id === messageId) {
            return { ...m, text, isDeleted, isEdited: false };
          }
          return m;
        }));
      });

      // Handle message reactions
      socket.on('message_reacted', ({ messageId, reactions }) => {
        setMessages(prev => prev.map(m => {
          if (m._id === messageId) {
            return { ...m, reactions };
          }
          return m;
        }));
      });

      // Handle self-destruct countdown initialization (Disappearing Messages)
      socket.on('message_destruct_timer_started', ({ messageId, destructAt }) => {
        setMessages(prev => prev.map(m => {
          if (m._id === messageId) {
            return { ...m, destructAt };
          }
          return m;
        }));
      });

      // Handle real-time self-destruct deletion
      socket.on('message_destructed', ({ messageId }) => {
        setMessages(prev => prev.map(m => {
          if (m._id === messageId) {
            return { ...m, isDestructing: true };
          }
          return m;
        }));
        
        // Let the fade-out animation play before filtering it out from state
        setTimeout(() => {
          setMessages(prev => prev.filter(m => m._id !== messageId));
        }, 500);
      });

      return () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('user_status');
        socket.off('user_profile_updated');
        socket.off('private_message');
        socket.off('typing');
        socket.off('messages_read');
        socket.off('message_edited');
        socket.off('message_deleted');
        socket.off('message_reacted');
        socket.off('message_destruct_timer_started');
        socket.off('message_destructed');
      };
    }
  }, [socket, activeContactId, activeChatKey]);

  // Handle browser popstate to allow mobile hardware back button to close active chat
  useEffect(() => {
    if (activeContactId) {
      window.history.pushState({ hasChat: true }, '');
    }

    const handlePopState = (e) => {
      if (activeContactId) {
        setActiveContactId(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeContactId]);

  const scrollToBottom = () => {
    if (messageContainerRef.current) {
      messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !activeContactId || !activeChatKey) return;

    const plaintext = inputText.trim();
    const encryptedText = await encryptMessage(plaintext, activeChatKey);

    // Send private message over Socket.io
    socket.emit('private_message', {
      recipientId: activeContactId,
      text: encryptedText,
      selfDestructType: selfDestructType
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

  const handleStartNewChat = async (e) => {
    e.preventDefault();
    if (!newChatUsername.trim()) return;

    setNewChatLoading(true);
    setNewChatError('');

    try {
      const response = await fetch('/api/users/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: newChatUsername.trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'User not found');
      }

      // Add to contacts list if not already present
      setContacts(prev => {
        const exists = prev.some(c => c.id === data.id);
        if (exists) return prev;
        return [data, ...prev];
      });

      // Set as active chat
      setActiveContactId(data.id);

      // Close modal
      setShowNewChatModal(false);
      setNewChatUsername('');
    } catch (err) {
      setNewChatError(err.message || 'Failed to start chat');
    } finally {
      setNewChatLoading(false);
    }
  };

  // Generate a Shareable Chat Link
  const handleCreateInviteLink = async (e) => {
    if (e) e.preventDefault();
    setInviteLoading(true);
    setGeneratedInviteLink('');
    try {
      const res = await fetch('/api/chat-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ expiresType: inviteExpiresType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create invite link');

      const link = `${window.location.origin}/connect/${data.code}`;
      setGeneratedInviteLink(link);
    } catch (err) {
      console.error(err);
      setApiError(err.message || 'Failed to create chat link');
    } finally {
      setInviteLoading(false);
    }
  };

  // Save updated Profile Settings (Anonymous Profiles)
  const handleSaveProfile = (e) => {
    if (e) e.preventDefault();
    setProfileLoading(true);
    setProfileError('');

    socket.emit('update_profile', {
      avatarEmoji: profileEmoji,
      avatarColor: profileColor,
      statusMessage: profileStatus
    }, (response) => {
      setProfileLoading(false);
      if (response && response.success) {
        if (onUpdateUser) onUpdateUser(response.user);
        setShowProfileModal(false);
        setToastMessage('Profile settings saved!');
      } else {
        setProfileError(response?.error || 'Failed to save profile settings');
      }
    });
  };

  // Save edited message text
  const handleSaveEdit = async (messageId) => {
    if (!editingText.trim() || !activeChatKey) return;
    
    const encrypted = await encryptMessage(editingText.trim(), activeChatKey);
    
    socket.emit('edit_message', { messageId, text: encrypted }, (response) => {
      if (response && response.success) {
        setEditingMessageId(null);
        setEditingText('');
      } else {
        setApiError(response?.error || 'Failed to save edit.');
      }
    });
  };

  const handleMessageClick = (msgId) => {
    setActiveMobileMessageId(prev => prev === msgId ? null : msgId);
  };

  // Secure context and insecure context copy-to-clipboard wrapper
  const copyToClipboard = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          setToastMessage('Link copied to clipboard!');
        })
        .catch((err) => {
          console.error('navigator.clipboard failed, using fallback:', err);
          fallbackCopyText(text);
        });
    } else {
      fallbackCopyText(text);
    }
  };

  const fallbackCopyText = (text) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed'; // Avoid scrolling
      textArea.style.top = '0';
      textArea.style.left = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        setToastMessage('Link copied to clipboard!');
      } else {
        throw new Error('Copy failed');
      }
    } catch (err) {
      console.error('Fallback copy error:', err);
      setApiError('Failed to copy. Please manually copy the link.');
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

  // Filters messages list by search query
  const filteredMessages = messages.filter(m => 
    !chatSearchQuery || m.text.toLowerCase().includes(chatSearchQuery.toLowerCase())
  );

  // Helper to format remaining self-destruct time
  const getCountdownLabel = (destructAtStr) => {
    const diffMs = new Date(destructAtStr) - currentTime;
    if (diffMs <= 0) return 'Deleting...';
    
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return `${diffSecs}s`;
    
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m`;
    
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h`;
  };

  return (
    <div className="flex h-dvh bg-dark-950 text-gray-200 overflow-hidden font-sans relative">
      {/* Background glow effects */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-brand-600/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-accent-blue/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Main Container */}
      <div className="flex flex-1 relative z-10 w-full h-full">
        
        {/* PANEL 1: Left Contacts Sidebar */}
        <aside className={`flex flex-col border-r border-white/5 bg-dark-950/40 backdrop-blur-md h-full shrink-0 transition-all duration-300 ${
          activeContactId ? 'hidden md:flex w-80 md:w-96' : 'flex w-full md:w-96'
        }`}>
          
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

            <div className="flex items-center gap-1">
              {/* Private Invite Link Action */}
              <button
                onClick={() => {
                  setGeneratedInviteLink('');
                  setShowInviteModal(true);
                }}
                title="Create Private Link"
                className="p-2.5 rounded-xl text-dark-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
              >
                <Link className="w-4.5 h-4.5" />
              </button>

              {/* Profile Settings Action */}
              <button
                onClick={() => {
                  setProfileEmoji(user.avatarEmoji || '💬');
                  setProfileColor(user.avatarColor || 'from-purple-500 to-indigo-500');
                  setProfileStatus(user.statusMessage || 'Available');
                  setProfileError('');
                  setShowProfileModal(true);
                }}
                title="Profile Settings"
                className="p-2.5 rounded-xl text-dark-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
              >
                <Settings className="w-4.5 h-4.5" />
              </button>

              {/* New Chat Action */}
              <button
                onClick={() => setShowNewChatModal(true)}
                title="New Chat"
                className="p-2.5 rounded-xl text-dark-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
              >
                <Plus className="w-4.5 h-4.5" />
              </button>

              {/* Logout Action */}
              <button
                onClick={onLogout}
                title="Logout"
                className="p-2.5 rounded-xl text-dark-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
              >
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>
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
                <p className="text-xs mt-1">Use the "+" button above to start a private chat.</p>
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
        <main className={`flex-1 flex flex-col bg-dark-900/30 h-full min-w-0 transition-all duration-300 ${
          activeContactId ? 'flex w-full' : 'hidden md:flex'
        }`}>
          {activeContact ? (
            <>
              {/* Chat Header */}
              <header className="p-4 border-b border-white/5 bg-dark-950/20 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Back button on mobile */}
                  <button
                    onClick={() => {
                      if (window.history.state && window.history.state.hasChat) {
                        window.history.back();
                      } else {
                        setActiveContactId(null);
                      }
                    }}
                    className="mr-1 p-2 rounded-xl text-dark-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  {/* Recipient Avatar */}
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${activeContact.avatarColor} flex items-center justify-center text-lg`}>
                    {activeContact.avatarEmoji}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white truncate text-sm">{activeContact.username}</span>
                      <div 
                        title="End-to-End Encrypted: Messages are encrypted locally and only readable by you and your recipient."
                        className="group relative flex items-center"
                      >
                        <Lock className="w-3.5 h-3.5 text-accent-teal shrink-0 cursor-help" />
                        <span className="absolute bottom-[-32px] left-1/2 -translate-x-1/2 w-48 text-center p-1.5 text-[9px] bg-dark-900 border border-white/5 text-dark-300 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none select-none z-55 backdrop-blur-md">
                          End-to-End Encrypted
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-dark-400 truncate">
                      {typingStates[activeContact.id] ? (
                        <span className="text-brand-400 font-medium animate-pulse">typing...</span>
                      ) : activeContact.online ? (
                        <span className="text-accent-teal font-medium">Online {activeContact.statusMessage && `• "${activeContact.statusMessage}"`}</span>
                      ) : (
                        <span>Offline • last seen {formatLastSeen(activeContact.lastSeen)}</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-1.5">
                  {/* Search toggle */}
                  <div className="relative flex items-center">
                    {showSearchInput && (
                      <input
                        type="text"
                        placeholder="Search messages..."
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        className="px-3 py-1.5 text-xs rounded-xl glass-input placeholder-dark-500 text-white w-40 md:w-56 mr-2 animate-fade-in"
                        autoFocus
                      />
                    )}
                    <button
                      onClick={() => {
                        setShowSearchInput(!showSearchInput);
                        if (showSearchInput) setChatSearchQuery('');
                      }}
                      title="Search Messages"
                      className={`p-2 rounded-xl transition-all duration-200 cursor-pointer ${
                        showSearchInput ? 'text-brand-400 bg-brand-500/10' : 'text-dark-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Search className="w-5 h-5" />
                    </button>
                  </div>

                  <button
                    onClick={() => setShowDetailPanel(!showDetailPanel)}
                    title="Conversation Details"
                    className={`p-2 rounded-xl transition-all duration-200 cursor-pointer ${
                      showDetailPanel ? 'text-brand-400 bg-brand-500/10' : 'text-dark-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Info className="w-5 h-5" />
                  </button>
                </div>
              </header>

              {/* Message Feed Container */}
              <div ref={messageContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-dark-500">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                      <MessageSquare className="w-6 h-6 opacity-30 text-white" />
                    </div>
                    <p className="text-sm font-medium text-white">This is the start of your duo chat</p>
                    <p className="text-xs mt-1 max-w-[280px]">All messages in this session are encrypted and private.</p>
                  </div>
                ) : (
                  groupMessagesByDate(filteredMessages).map((item, idx) => {
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
                    const isEditing = msg._id === editingMessageId;
                    
                    return (
                      <div
                        key={msg._id || idx}
                        onClick={() => handleMessageClick(msg._id)}
                        className={`flex ${isSelf ? 'justify-end' : 'justify-start'} group transition-all duration-500 transform cursor-pointer ${
                          msg.isDestructing ? 'opacity-0 scale-95 max-h-0 py-0 my-0 overflow-hidden' : 'opacity-100 scale-100'
                        }`}
                      >
                        <div className={`max-w-[85%] md:max-w-[70%] flex flex-col ${isSelf ? 'items-end' : 'items-start'} relative`}>
                          
                          {/* Hover action toolbar for reactions, edit, and delete */}
                          {!msg.isDeleted && !isEditing && (
                            <div className={`absolute top-[-26px] z-20 items-center gap-1.5 bg-dark-900/90 border border-white/10 rounded-full px-2 py-1 shadow-2xl backdrop-blur-md transition-all duration-200 ${
                              isSelf ? 'right-2' : 'left-2'
                            } ${
                              activeMobileMessageId === msg._id ? 'flex animate-scale-in' : 'group-hover:flex hidden'
                            }`}>
                              {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    socket.emit('react_message', { messageId: msg._id, emoji });
                                    setActiveMobileMessageId(null); // close on react
                                  }}
                                  className="hover:scale-125 transition-transform duration-100 px-0.5 cursor-pointer text-xs"
                                >
                                  {emoji}
                                </button>
                              ))}
                              {isSelf && (
                                <>
                                  <div className="w-[1px] h-3 bg-white/10 mx-1"></div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingMessageId(msg._id);
                                      setEditingText(msg.text);
                                      setActiveMobileMessageId(null);
                                    }}
                                    title="Edit Message"
                                    className="p-1 rounded text-dark-400 hover:text-white transition-colors cursor-pointer"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm('Delete this message?')) {
                                        socket.emit('delete_message', { messageId: msg._id });
                                      }
                                      setActiveMobileMessageId(null);
                                    }}
                                    title="Delete Message"
                                    className="p-1 rounded text-dark-400 hover:text-accent-rose transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Chat bubble body */}
                          <div className={`p-3 rounded-2xl text-sm relative transition-all duration-200 shadow-md ${
                            isSelf
                              ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white rounded-tr-none'
                              : 'glass-panel text-gray-200 rounded-tl-none'
                          }`}>
                            {isEditing ? (
                              <div 
                                onClick={(e) => e.stopPropagation()} 
                                className="flex gap-2 items-center min-w-[200px]"
                              >
                                <input
                                  type="text"
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  className="flex-1 px-3 py-1 text-xs text-white rounded-lg glass-input bg-dark-950/50"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEdit(msg._id);
                                    if (e.key === 'Escape') setEditingMessageId(null);
                                  }}
                                  autoFocus
                                />
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleSaveEdit(msg._id); }}
                                  className="text-xs px-2 py-1 bg-brand-500 rounded-lg text-white font-semibold cursor-pointer"
                                >
                                  Save
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setEditingMessageId(null); }}
                                  className="text-xs px-2 py-1 bg-white/5 rounded-lg text-dark-300 hover:text-white cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : msg.isDeleted ? (
                              <p className="text-xs italic text-dark-500 leading-relaxed">This message was deleted</p>
                            ) : (
                              <>
                                <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                                
                                {/* Inline reaction counts */}
                                {msg.reactions && msg.reactions.length > 0 && (
                                  <div className={`flex flex-wrap gap-1 mt-2 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                                    {Object.entries(
                                      msg.reactions.reduce((acc, r) => {
                                        acc[r.emoji] = acc[r.emoji] || [];
                                        acc[r.emoji].push(r.userId);
                                        return acc;
                                      }, {})
                                    ).map(([emoji, userIds]) => {
                                      const hasReacted = userIds.includes(userId);
                                      return (
                                        <button
                                          key={emoji}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            socket.emit('react_message', { messageId: msg._id, emoji });
                                          }}
                                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] border transition-all duration-200 cursor-pointer ${
                                            hasReacted
                                              ? 'bg-brand-500/20 border-brand-500/40 text-brand-300 font-semibold'
                                              : 'bg-white/[0.02] border-white/5 text-dark-400 hover:bg-white/5 hover:text-white'
                                          }`}
                                        >
                                          <span>{emoji}</span>
                                          <span>{userIds.length}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Message meta & receipt status */}
                          <div className="flex items-center gap-1.5 mt-1.5 px-1 text-[10px] text-dark-500">
                            <span>{formatTime(msg.createdAt)}</span>
                            {msg.isEdited && <span className="text-[9px] text-dark-500 italic">(edited)</span>}
                            
                            {msg.destructAt && (
                              <span className="text-[10px] text-accent-rose flex items-center gap-1 font-semibold">
                                <Clock className="w-3 h-3 animate-pulse text-accent-rose" />
                                <span>{getCountdownLabel(msg.destructAt)}</span>
                              </span>
                            )}

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
                {/* End of message list */}
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
                <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
                  <select
                    value={selfDestructType}
                    onChange={(e) => setSelfDestructType(e.target.value)}
                    title="Self-Destruct Duration"
                    className="px-2 py-3 rounded-xl text-xs glass-input text-dark-300 font-medium cursor-pointer max-w-[80px] md:max-w-[125px] bg-dark-950 focus:border-brand-500/50"
                  >
                    <option value="forever">♾️ Forever</option>
                    <option value="after_read">⏱️ Read</option>
                    <option value="1h">🕒 1h</option>
                    <option value="24h">🕒 24h</option>
                  </select>
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
          <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-80 border-l border-white/5 bg-dark-950/95 md:bg-dark-950/40 md:relative backdrop-blur-md h-full flex flex-col shrink-0 animate-fade-in">
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

      {/* Start New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in animate-duration-200">
          <div className="w-full max-w-md glass-card rounded-2xl shadow-2xl p-6 relative overflow-hidden border border-white/5">
            {/* Decorative Top Glow Bar */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-brand-500 to-accent-blue"></div>
            
            {/* Modal Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Start New Chat</h3>
                <p className="text-xs text-dark-400 mt-1">
                  Enter the exact username of the person you want to talk to.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowNewChatModal(false);
                  setNewChatUsername('');
                  setNewChatError('');
                }}
                className="p-1 rounded-lg text-dark-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleStartNewChat} className="space-y-4">
              {newChatError && (
                <div className="p-3 bg-accent-rose/10 border border-accent-rose/20 text-accent-rose text-xs rounded-xl">
                  {newChatError}
                </div>
              )}
              
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Username
                </label>
                <input
                  type="text"
                  placeholder="e.g. bob"
                  value={newChatUsername}
                  onChange={(e) => setNewChatUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-white placeholder-dark-500 text-sm glass-input"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewChatModal(false);
                    setNewChatUsername('');
                    setNewChatError('');
                  }}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-dark-300 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newChatLoading || !newChatUsername.trim()}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md hover:from-brand-500 hover:to-brand-600 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {newChatLoading ? 'Searching...' : 'Start Chat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[120] bg-dark-900 border border-brand-500/30 text-brand-400 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-fade-in backdrop-blur-md">
          <Sparkles className="w-4.5 h-4.5 text-brand-400" />
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Create Invite Link Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in animate-duration-200">
          <div className="w-full max-w-md glass-card rounded-2xl shadow-2xl p-6 relative overflow-hidden border border-white/5">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-brand-500 to-accent-blue"></div>
            
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Create Private Link</h3>
                <p className="text-xs text-dark-400 mt-1">
                  Generate a temporary secure invite link to instantly connect with someone.
                </p>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-1 rounded-lg text-dark-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Link Expiration
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { type: '1h', label: '1 Hour' },
                    { type: '24h', label: '24 Hours' },
                    { type: '7d', label: '7 Days' },
                    { type: 'never', label: 'Never' }
                  ].map(opt => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setInviteExpiresType(opt.type)}
                      className={`px-2 py-2 text-xs font-semibold rounded-xl border transition-all duration-200 cursor-pointer ${
                        inviteExpiresType === opt.type
                          ? 'bg-brand-600/15 border-brand-500 text-brand-400'
                          : 'bg-white/[0.02] border-white/5 text-dark-400 hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {generatedInviteLink ? (
                <div className="space-y-3 pt-2">
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={generatedInviteLink}
                      className="w-full pl-3 pr-12 py-3 rounded-xl text-white text-xs glass-input select-all font-mono"
                    />
                    <button
                      onClick={() => copyToClipboard(generatedInviteLink)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-brand-600 hover:bg-brand-500 rounded-lg text-white transition-all cursor-pointer"
                      title="Copy Link"
                    >
                      <Copy className="w-4.5 h-4.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-accent-teal text-center font-medium">
                    ✔ Copy and share this link. Anyone opening it will instantly open a chat with you!
                  </p>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={handleCreateInviteLink}
                    disabled={inviteLoading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 text-white font-semibold shadow-md hover:from-brand-500 hover:to-brand-600 transition-all duration-200 cursor-pointer disabled:opacity-50"
                  >
                    {inviteLoading ? 'Generating...' : 'Generate Invite Link'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Settings Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in animate-duration-200">
          <div className="w-full max-w-lg glass-card rounded-2xl shadow-2xl p-6 relative overflow-hidden border border-white/5 flex flex-col max-h-[85vh]">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-brand-500 to-accent-blue"></div>
            
            <div className="flex justify-between items-start mb-4 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-white">Profile Settings</h3>
                <p className="text-xs text-dark-400 mt-1">
                  Customize your anonymous representation. Privacy remains username-only.
                </p>
              </div>
              <button
                onClick={() => setShowProfileModal(false)}
                className="p-1 rounded-lg text-dark-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {profileError && (
              <div className="p-3 bg-accent-rose/10 border border-accent-rose/20 text-accent-rose text-xs rounded-xl mb-4 shrink-0">
                {profileError}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Profile Preview Card */}
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center gap-4 shrink-0 justify-center">
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${profileColor} flex items-center justify-center text-3xl shadow-lg`}>
                  {profileEmoji}
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-white text-sm">Preview ({user.username})</span>
                  <span className="text-xs text-dark-400 mt-0.5">Status: "{profileStatus}"</span>
                </div>
              </div>

              {/* Status Input */}
              <div className="space-y-2 shrink-0">
                <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Status Message
                </label>
                <input
                  type="text"
                  maxLength={50}
                  placeholder="e.g. Coding MERN 🚀"
                  value={profileStatus}
                  onChange={(e) => setProfileStatus(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-white placeholder-dark-500 text-sm glass-input"
                />
              </div>

              {/* Gradient Color Selection */}
              <div className="space-y-2 shrink-0">
                <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider">
                  Avatar Background Gradient
                </label>
                <div className="flex flex-wrap gap-2 justify-center">
                  {[
                    'from-pink-500 to-rose-500',
                    'from-purple-500 to-indigo-500',
                    'from-blue-500 to-cyan-500',
                    'from-emerald-500 to-teal-500',
                    'from-amber-500 to-orange-500',
                    'from-red-500 to-orange-600',
                    'from-violet-600 to-fuchsia-600',
                    'from-lime-500 to-emerald-600',
                    'from-cyan-500 to-blue-500',
                    'from-rose-500 to-orange-500',
                    'from-yellow-400 to-orange-500',
                    'from-indigo-500 to-purple-600'
                  ].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setProfileColor(color)}
                      className={`w-8 h-8 rounded-lg bg-gradient-to-br ${color} transition-all duration-200 cursor-pointer ${
                        profileColor === color ? 'scale-110 ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-950' : 'hover:scale-105'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Emoji Selection Grid */}
              <div className="space-y-2 flex-1 flex flex-col min-h-0">
                <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider shrink-0">
                  Select Avatar Emoji
                </label>
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 overflow-y-auto p-2 bg-dark-950/40 rounded-2xl border border-white/5 max-h-[160px]">
                  {[
                    '🐱', '🦊', '🐨', '🦁', '🐯', '🐼', '🐸', '🐙', '🦄', '🦖', '🦉', '👾', '🚀', '⭐', '🌈', '👻',
                    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
                    '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '😎', '🥸', '🤩', '🥳', '🥶',
                    '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤',
                    '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '🤗', '🤔', '🫣', '🤭', '😴',
                    '🐶', '🐰', '🦁', '🐮', '🐵', '🐔', '🐧', '🦅', '🦉', '🦇', '🐝', '🦋', '💻', '🖥️', '🎮', '💡'
                  ].map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setProfileEmoji(emoji)}
                      className={`h-9 text-xl rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer ${
                        profileEmoji === emoji ? 'bg-brand-500/20 scale-110 border border-brand-500/50' : 'hover:bg-white/5 hover:scale-105'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-3 pt-3 border-t border-white/5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-dark-300 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={profileLoading}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md hover:from-brand-500 hover:to-brand-600 transition-all duration-200 cursor-pointer disabled:opacity-50"
                >
                  {profileLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
