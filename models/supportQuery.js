const mongoose = require('mongoose');

const supportQuerySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    message: {
        type: String,
        required: true,
        maxlength: 2000
    },

    category: {
        type: String,
        enum: ['General', 'Technical', 'Account', 'Serious'],
        default: 'General'
    },

    status: {
        type: String,
        enum: ['Open', 'In Progress', 'Resolved'],
        default: 'Open'
    },

    emailSent: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('SupportQuery', supportQuerySchema);