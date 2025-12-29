const mongoose = require('mongoose');
const { Schema } = mongoose;


const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'messages.senderModel' 
  },
  senderModel: {
    type: String,
    required: true,
    enum: ['User', 'Admin']
  },
  message: {
    type: String,
    required: true
  }
}, { timestamps: true }); 

const supportTicketSchema = new mongoose.Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Open', 'In-Progress', 'Pending-Reply', 'Resolved', 'Closed'],
    default: 'Open'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  assignee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  category: {
    type: String,
    enum: ['Order', 'Payment', 'Account', 'Technical', 'General'],
    required: true
  },
  relatedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },
  relatedVendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    default: null
  },
  messages: [messageSchema] 

}, { timestamps: true }); 



module.exports  = mongoose.model('SupportTicket', supportTicketSchema);
