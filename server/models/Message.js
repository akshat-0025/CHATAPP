import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  recipient: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  text: { 
    type: String, 
    required: true,
    trim: true
  },
  read: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

// Index for query performance on chat history between two users
messageSchema.index({ sender: 1, recipient: 1, createdAt: 1 });
messageSchema.index({ recipient: 1, sender: 1, createdAt: 1 });

export default mongoose.model('Message', messageSchema);
