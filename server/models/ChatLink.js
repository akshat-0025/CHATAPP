import mongoose from 'mongoose';

const chatLinkSchema = new mongoose.Schema({
  code: { 
    type: String, 
    unique: true, 
    required: true,
    index: true
  },
  creator: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  expiresAt: { 
    type: Date 
  },
  expiresType: { 
    type: String, 
    required: true,
    enum: ['1h', '24h', '7d', 'never']
  }
}, { timestamps: true });

export default mongoose.model('ChatLink', chatLinkSchema);
