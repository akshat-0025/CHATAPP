import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { MongoMemoryServer } from 'mongodb-memory-server';
import path from 'path';
import { fileURLToPath } from 'url';

import User from './models/User.js';
import Message from './models/Message.js';
import ChatLink from './models/ChatLink.js';
import auth from './middleware/auth.js';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Use helmet for standard security headers (disable contentSecurityPolicy check locally to avoid issues)
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Apply rate limiting to REST API endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: { message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', limiter);

// Database Connection
let mongoServer;
const connectDatabase = async () => {
  let mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.log('No MONGODB_URI provided. Starting in-memory MongoDB server...');
    mongoServer = await MongoMemoryServer.create();
    mongoUri = mongoServer.getUri();
  }

  try {
    await mongoose.connect(mongoUri);
    console.log(`Successfully connected to MongoDB at ${mongoUri}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const AVATAR_COLORS = [
  'from-pink-500 to-rose-500',
  'from-purple-500 to-indigo-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-red-500 to-orange-600',
  'from-violet-600 to-fuchsia-600',
  'from-lime-500 to-emerald-600'
];

const AVATAR_EMOJIS = ['🐱', '🦊', '🐨', '🦁', '🐯', '🐼', '🐸', '🐙', '🦄', '🦖', '🦉', '👾', '🚀', '⭐', '🌈', '👻'];

// REST API Routes

// User Registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    if (username.length < 3) {
      return res.status(400).json({ message: 'Username must be at least 3 characters long.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (existingUser) {
      return res.status(400).json({ message: 'Username is already taken.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Choose random avatar configurations
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const avatarEmoji = AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];

    const user = new User({
      username,
      password: hashedPassword,
      avatarColor,
      avatarEmoji
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'supersecret_duochat_key_129847129',
      { expiresIn: '30d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        avatarColor: user.avatarColor,
        avatarEmoji: user.avatarEmoji,
        online: user.online
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error during registration.' });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid username or password.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'supersecret_duochat_key_129847129',
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        avatarColor: user.avatarColor,
        avatarEmoji: user.avatarEmoji,
        online: user.online
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error during login.' });
  }
});

// Get Current User
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.json({
      id: user._id,
      username: user.username,
      avatarColor: user.avatarColor,
      avatarEmoji: user.avatarEmoji,
      online: user.online
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Helper to get active chat partner IDs for a user
const getActiveChatPartners = async (userId) => {
  try {
    const uId = new mongoose.Types.ObjectId(userId);
    const partners = await Message.aggregate([
      { $match: { $or: [{ sender: uId }, { recipient: uId }] } },
      {
        $project: {
          partner: {
            $cond: {
              if: { $eq: ['$sender', uId] },
              then: '$recipient',
              else: '$sender'
            }
          }
        }
      },
      { $group: { _id: '$partner' } }
    ]);
    return partners.map(p => p._id);
  } catch (err) {
    console.error('Error getting active partners:', err);
    return [];
  }
};

// Get Contacts (Only users with active chat history)
app.get('/api/users', auth, async (req, res) => {
  try {
    const partnerIds = await getActiveChatPartners(req.user.id);

    // Return users that are active chat partners
    const users = await User.find({ _id: { $in: partnerIds } })
      .select('-password')
      .sort({ online: -1, username: 1 });

    // Fetch the last message for each user to show excerpts in sidebar
    const usersWithLastMessage = await Promise.all(users.map(async (u) => {
      const lastMessage = await Message.findOne({
        $or: [
          { sender: req.user.id, recipient: u._id },
          { sender: u._id, recipient: req.user.id }
        ]
      }).sort({ createdAt: -1 });

      const unreadCount = await Message.countDocuments({
        sender: u._id,
        recipient: req.user.id,
        read: false
      });

      return {
        id: u._id,
        username: u.username,
        avatarColor: u.avatarColor,
        avatarEmoji: u.avatarEmoji,
        online: u.online,
        lastSeen: u.lastSeen,
        lastMessage: lastMessage ? {
          text: lastMessage.text,
          sender: lastMessage.sender,
          createdAt: lastMessage.createdAt
        } : null,
        unreadCount
      };
    }));

    res.json(usersWithLastMessage);
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Search a user by exact username (private lookup for starting a new conversation)
app.post('/api/users/search', auth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const targetUsername = username.trim();
    if (targetUsername.toLowerCase() === req.user.username.toLowerCase()) {
      return res.status(400).json({ message: 'You cannot chat with yourself.' });
    }

    // Find user by exact match (case-insensitive)
    const user = await User.findOne({ username: { $regex: new RegExp(`^${targetUsername}$`, 'i') } }).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found. Please verify the exact spelling.' });
    }

    const lastMessage = await Message.findOne({
      $or: [
        { sender: req.user.id, recipient: user._id },
        { sender: user._id, recipient: req.user.id }
      ]
    }).sort({ createdAt: -1 });

    const unreadCount = await Message.countDocuments({
      sender: user._id,
      recipient: req.user.id,
      read: false
    });

    res.json({
      id: user._id,
      username: user.username,
      avatarColor: user.avatarColor,
      avatarEmoji: user.avatarEmoji,
      online: user.online,
      lastSeen: user.lastSeen,
      lastMessage: lastMessage ? {
        text: lastMessage.text,
        sender: lastMessage.sender,
        createdAt: lastMessage.createdAt
      } : null,
      unreadCount
    });
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Get Chat Messages History with a Specific User
app.get('/api/messages/:userId', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user.id, recipient: req.params.userId },
        { sender: req.params.userId, recipient: req.user.id }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    console.error('Fetch messages error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Create a new shareable invite link
app.post('/api/chat-links', auth, async (req, res) => {
  try {
    const { expiresType } = req.body;
    if (!expiresType || !['1h', '24h', '7d', 'never'].includes(expiresType)) {
      return res.status(400).json({ message: 'Invalid or missing expiration type.' });
    }

    // Generate a unique 8-character uppercase alpha-numeric code
    let code;
    let exists = true;
    while (exists) {
      code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const existing = await ChatLink.findOne({ code });
      if (!existing) exists = false;
    }

    let expiresAt = null;
    if (expiresType === '1h') {
      expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    } else if (expiresType === '24h') {
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else if (expiresType === '7d') {
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    const newLink = new ChatLink({
      code,
      creator: req.user.id,
      expiresAt,
      expiresType
    });

    await newLink.save();
    res.status(201).json({ code, expiresAt });
  } catch (error) {
    console.error('Create chat link error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Accept a shareable invite link
app.post('/api/chat-links/:code/accept', auth, async (req, res) => {
  try {
    const { code } = req.params;
    const link = await ChatLink.findOne({ code }).populate('creator', '-password');

    if (!link) {
      return res.status(404).json({ message: 'Invalid or expired chat link.' });
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      await ChatLink.deleteOne({ _id: link._id });
      return res.status(400).json({ message: 'This chat link has expired.' });
    }

    if (link.creator._id.toString() === req.user.id) {
      return res.status(400).json({ message: 'You cannot use your own chat link.' });
    }

    // Connect them instantly by creating a system message if no prior messages exist
    const existingMessage = await Message.findOne({
      $or: [
        { sender: req.user.id, recipient: link.creator._id },
        { sender: link.creator._id, recipient: req.user.id }
      ]
    });

    if (!existingMessage) {
      const systemMessage = new Message({
        sender: link.creator._id, // from creator
        recipient: req.user.id, // to visitor
        text: 'System: Secure duo chat session established via private link.'
      });
      await systemMessage.save();
    }

    res.json({
      creator: {
        id: link.creator._id,
        username: link.creator.username,
        avatarColor: link.creator.avatarColor,
        avatarEmoji: link.creator.avatarEmoji,
        statusMessage: link.creator.statusMessage || 'Available',
        online: link.creator.online,
        lastSeen: link.creator.lastSeen
      }
    });
  } catch (error) {
    console.error('Accept chat link error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Socket.IO Real-time Logic
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error. Token required.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecret_duochat_key_129847129');
    socket.user = decoded;
    next();
  } catch (error) {
    return next(new Error('Authentication error. Invalid token.'));
  }
});

// Track online socket ID mapping (userId -> socketId)
const userSockets = new Map();

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  console.log(`Socket connected: user ${socket.user.username} (${userId})`);

  // Map user ID to socket
  userSockets.set(userId, socket.id);
  
  // Set user to online and broadcast to active chat partners only
  try {
    await User.findByIdAndUpdate(userId, { online: true });
    const partners = await getActiveChatPartners(userId);
    partners.forEach(partnerId => {
      io.to(partnerId.toString()).emit('user_status', {
        userId,
        online: true
      });
    });
  } catch (err) {
    console.error('Error updating status on connect:', err);
  }

  // Join self-room for easy 1-on-1 routing
  socket.join(userId);

  // Handle incoming private message
  socket.on('private_message', async ({ recipientId, text, selfDestructType }, callback) => {
    try {
      if (!text || !text.trim()) {
        if (callback) callback({ success: false, error: 'Message content is empty' });
        return;
      }

      let destructAt = null;
      if (selfDestructType === '1h') {
        destructAt = new Date(Date.now() + 60 * 60 * 1000);
      } else if (selfDestructType === '24h') {
        destructAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      const message = new Message({
        sender: userId,
        recipient: recipientId,
        text: text.trim(),
        selfDestructType: selfDestructType || 'forever',
        destructAt
      });

      await message.save();

      // Emit to recipient's room
      io.to(recipientId).emit('private_message', message);
      // Emit back to sender
      socket.emit('private_message', message);

      if (callback) callback({ success: true, message });
    } catch (error) {
      console.error('Error saving private message:', error);
      if (callback) callback({ success: false, error: 'Failed to send message' });
    }
  });

  // Handle typing notifications
  socket.on('typing', ({ recipientId, isTyping }) => {
    socket.to(recipientId).emit('typing', {
      senderId: userId,
      isTyping
    });
  });

  // Handle message read receipts
  socket.on('read_receipt', async ({ senderId }) => {
    try {
      // Find all unread messages from senderId to current user
      const unreadMsgs = await Message.find({
        sender: senderId,
        recipient: userId,
        read: false
      });

      // Mark messages as read in DB
      await Message.updateMany(
        { sender: senderId, recipient: userId, read: false },
        { $set: { read: true } }
      );

      // Trigger self-destruct timers for 'after_read' messages
      const afterReadMsgs = unreadMsgs.filter(m => m.selfDestructType === 'after_read');
      for (const msg of afterReadMsgs) {
        const destructTime = new Date(Date.now() + 10000); // 10s countdown
        await Message.findByIdAndUpdate(msg._id, { 
          destructAt: destructTime,
          read: true
        });

        // Notify both clients that destruct countdown has started
        io.to(senderId).emit('message_destruct_timer_started', {
          messageId: msg._id,
          destructAt: destructTime
        });
        io.to(userId).emit('message_destruct_timer_started', {
          messageId: msg._id,
          destructAt: destructTime
        });
      }

      // Notify the original sender that their messages were read
      socket.to(senderId).emit('messages_read', {
        readerId: userId
      });
    } catch (err) {
      console.error('Error updating read receipts:', err);
    }
  });

  // Handle message editing
  socket.on('edit_message', async ({ messageId, text }, callback) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        if (callback) callback({ success: false, error: 'Message not found' });
        return;
      }
      if (message.sender.toString() !== userId) {
        if (callback) callback({ success: false, error: 'Unauthorized' });
        return;
      }
      if (message.isDeleted) {
        if (callback) callback({ success: false, error: 'Cannot edit deleted message' });
        return;
      }

      message.text = text.trim();
      message.isEdited = true;
      await message.save();

      // Emit update to both parties
      io.to(message.recipient.toString()).emit('message_edited', {
        messageId,
        text: message.text,
        isEdited: true
      });
      socket.emit('message_edited', {
        messageId,
        text: message.text,
        isEdited: true
      });

      if (callback) callback({ success: true, message });
    } catch (err) {
      console.error('Edit message error:', err);
      if (callback) callback({ success: false, error: 'Failed to edit message' });
    }
  });

  // Handle message deletion
  socket.on('delete_message', async ({ messageId }, callback) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        if (callback) callback({ success: false, error: 'Message not found' });
        return;
      }
      if (message.sender.toString() !== userId) {
        if (callback) callback({ success: false, error: 'Unauthorized' });
        return;
      }

      message.text = 'This message was deleted';
      message.isDeleted = true;
      message.isEdited = false;
      await message.save();

      // Emit update to both parties
      io.to(message.recipient.toString()).emit('message_deleted', {
        messageId,
        text: message.text,
        isDeleted: true
      });
      socket.emit('message_deleted', {
        messageId,
        text: message.text,
        isDeleted: true
      });

      if (callback) callback({ success: true, message });
    } catch (err) {
      console.error('Delete message error:', err);
      if (callback) callback({ success: false, error: 'Failed to delete message' });
    }
  });

  // Handle message reactions
  socket.on('react_message', async ({ messageId, emoji }, callback) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        if (callback) callback({ success: false, error: 'Message not found' });
        return;
      }

      if (message.sender.toString() !== userId && message.recipient.toString() !== userId) {
        if (callback) callback({ success: false, error: 'Unauthorized' });
        return;
      }

      const existingIndex = message.reactions.findIndex(
        r => r.userId === userId && r.emoji === emoji
      );

      if (existingIndex > -1) {
        // Toggle off
        message.reactions.splice(existingIndex, 1);
      } else {
        // Toggle on
        message.reactions.push({
          userId,
          username: socket.user.username,
          emoji
        });
      }

      await message.save();

      io.to(message.recipient.toString()).emit('message_reacted', {
        messageId,
        reactions: message.reactions
      });
      socket.emit('message_reacted', {
        messageId,
        reactions: message.reactions
      });

      if (callback) callback({ success: true, reactions: message.reactions });
    } catch (err) {
      console.error('Reaction message error:', err);
      if (callback) callback({ success: false, error: 'Failed to react to message' });
    }
  });

  // Handle anonymous profile updates
  socket.on('update_profile', async ({ avatarEmoji, avatarColor, statusMessage }, callback) => {
    try {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { avatarEmoji, avatarColor, statusMessage },
        { new: true }
      ).select('-password');

      if (!updatedUser) {
        if (callback) callback({ success: false, error: 'User not found' });
        return;
      }

      // Broadcast update to all active chat partners
      const partners = await getActiveChatPartners(userId);
      partners.forEach(partnerId => {
        io.to(partnerId.toString()).emit('user_profile_updated', {
          userId,
          avatarEmoji: updatedUser.avatarEmoji,
          avatarColor: updatedUser.avatarColor,
          statusMessage: updatedUser.statusMessage
        });
      });

      const formattedUser = {
        id: updatedUser._id,
        username: updatedUser.username,
        avatarColor: updatedUser.avatarColor,
        avatarEmoji: updatedUser.avatarEmoji,
        statusMessage: updatedUser.statusMessage,
        online: updatedUser.online
      };
      if (callback) callback({ success: true, user: formattedUser });
    } catch (err) {
      console.error('Update profile error:', err);
      if (callback) callback({ success: false, error: 'Failed to update profile' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`Socket disconnected: user ${socket.user.username}`);
    
    // Remove connection from mapping only if it corresponds to this socket
    if (userSockets.get(userId) === socket.id) {
      userSockets.delete(userId);
      
      const lastSeenTime = new Date();
      try {
        await User.findByIdAndUpdate(userId, { 
          online: false, 
          lastSeen: lastSeenTime 
        });

        // Broadcast status ONLY to active chat partners
        const partners = await getActiveChatPartners(userId);
        partners.forEach(partnerId => {
          io.to(partnerId.toString()).emit('user_status', {
            userId,
            online: false,
            lastSeen: lastSeenTime
          });
        });
      } catch (err) {
        console.error('Error updating status on disconnect:', err);
      }
    }
  });
});

// Start Database Sweeper for Self-Destruct Messages and Expired Chat Links
setInterval(async () => {
  try {
    const now = new Date();
    
    // Sweep expired self-destruct messages
    const expiredMessages = await Message.find({
      destructAt: { $lte: now }
    });

    for (const msg of expiredMessages) {
      await Message.deleteOne({ _id: msg._id });
      
      // Emit real-time removal events to active rooms
      io.to(msg.sender.toString()).emit('message_destructed', { messageId: msg._id });
      io.to(msg.recipient.toString()).emit('message_destructed', { messageId: msg._id });
    }

    // Sweep expired chat links
    await ChatLink.deleteMany({
      expiresAt: { $lte: now }
    });
  } catch (err) {
    console.error('Sweeper execution error:', err);
  }
}, 3000);

// Serve static assets in production
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// For client-side routing, serve index.html for all other routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 5000;
connectDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Private Duo Chat server running on port ${PORT}`);
  });
});
