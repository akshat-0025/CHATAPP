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
import auth from './middleware/auth.js';

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

// Get Contacts (All Registered Users)
app.get('/api/users', auth, async (req, res) => {
  try {
    // Return all users except the requester
    const users = await User.find({ _id: { $ne: req.user.id } })
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
  
  // Set user to online and broadcast
  try {
    await User.findByIdAndUpdate(userId, { online: true });
    socket.broadcast.emit('user_status', {
      userId,
      online: true
    });
  } catch (err) {
    console.error('Error updating status on connect:', err);
  }

  // Join self-room for easy 1-on-1 routing
  socket.join(userId);

  // Handle incoming private message
  socket.on('private_message', async ({ recipientId, text }, callback) => {
    try {
      if (!text || !text.trim()) {
        if (callback) callback({ success: false, error: 'Message content is empty' });
        return;
      }

      const message = new Message({
        sender: userId,
        recipient: recipientId,
        text: text.trim()
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
      // Mark all messages from senderId to current user as read
      await Message.updateMany(
        { sender: senderId, recipient: userId, read: false },
        { $set: { read: true } }
      );

      // Notify the original sender that their messages were read
      socket.to(senderId).emit('messages_read', {
        readerId: userId
      });
    } catch (err) {
      console.error('Error updating read receipts:', err);
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

        // Broadcast offline status to all clients
        socket.broadcast.emit('user_status', {
          userId,
          online: false,
          lastSeen: lastSeenTime
        });
      } catch (err) {
        console.error('Error updating status on disconnect:', err);
      }
    }
  });
});

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
