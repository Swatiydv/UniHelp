const mongoose = require('mongoose');

const helpSchema = new mongoose.Schema({
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        required: true
    },

    helper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    status: {
        type: String,
        enum: ['Requested', 'Accepted', 'Completed', 'Cancelled'],
        default: 'Requested'
    },

    // Help points earned by the person who helped
    helperPoints: {
        type: Number,
        default: 0
    },

    // Whether the helper has received their points for this help
    pointsAwarded: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports =
    mongoose.models.Help ||
    mongoose.model('Help', helpSchema);