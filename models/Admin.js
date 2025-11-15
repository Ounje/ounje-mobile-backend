const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true,},
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    select: false
  },
  role: {
    type: String,
    enum: ['super-admin', 'support', 'manager', 'content-moderator'],
    default: 'support'
  },
  permissions: [{
    type: String,
    enum: [
      'manage_users', 
      'manage_vendors', 
      'view_financials', 
      'handle_support', 
      'manage_settings'
    ]
  }],
  isActive: {
    type: Boolean,
    default: true 
  },
  lastLogin: {
    type: Date,
    default: null
  },
  
  mfaEnabled: {
    type: Boolean,
    default: false
  },
  mfaSecret: {
    type: String,
    select: false 
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,

}, {
  timestamps: true
});

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});


adminSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};


adminSchema.methods.hasPermission = function(permission) {
  if (this.role === 'super-admin') return true;
  return this.permissions.includes(permission);
};

const Admin = mongoose.model('Admin', adminSchema);
module.exports = Admin;