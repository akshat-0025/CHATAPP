import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true,
    trim: true,
    minlength: 3
  },
  password: { 
    type: String, 
    required: true 
  },
  avatarColor: { 
    type: String, 
    default: 'from-purple-500 to-indigo-500' 
  },
  avatarEmoji: { 
    type: String, 
    default: '💬' 
  },
  statusMessage: {
    type: String,
    default: 'Available'
  },
  online: { 
    type: Boolean, 
    default: false 
  },
  lastSeen: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
