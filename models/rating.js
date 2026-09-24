const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
    help: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Help',
        required: true
    },

    rater: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    ratedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    score: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    }
}, {
    timestamps: true
});

// One person can rate another person only once for one help interaction
ratingSchema.index(
    { help: 1, rater: 1, ratedUser: 1 },
    { unique: true }
);

module.exports =
    mongoose.models.Rating ||
    mongoose.model('Rating', ratingSchema);