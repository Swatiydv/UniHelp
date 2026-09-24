const express = require('express'), multer = require('multer');
const Post = require('../models/post'),
    Help = require('../models/help'),
    User = require('../models/user'),
    Rating = require('../models/rating'),
    Notification = require('../models/notification'),
    Conversation = require('../models/conversation');
const router = express.Router(); const upload = multer({ dest: 'public/uploads/', limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/posts', async (req, res) => { if (!req.session.userId) return res.status(401).json({ error: 'Login required' }); const p = await Post.create({ user: req.session.userId, content: req.body.content, type: req.body.type, itemName: req.body.itemName || '', itemCondition: req.body.itemCondition || '' }); const full = await Post.findById(p._id).populate('user', 'name department year avatar'); req.app.get('io').emit('newPost', full); res.json(full); });
router.put('/posts/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Login required' });
    }

    const post = await Post.findById(req.params.id);

    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user.toString() !== req.session.userId.toString()) {
        return res.status(403).json({
            error: 'You can only edit your own post'
        });
    }

    const acceptedHelp = await Help.findOne({
        post: post._id,
        status: 'Accepted'
    });

    if (acceptedHelp) {
        return res.status(400).json({
            error: 'This post cannot be edited after help has been accepted.'
        });
    }

    const content = String(req.body.content || '').trim();

    if (!content) {
        return res.status(400).json({
            error: 'Post content cannot be empty'
        });
    }

    if (content.length > 1000) {
        return res.status(400).json({
            error: 'Post content cannot exceed 1000 characters'
        });
    }

    post.content = content;
    await post.save();

    res.json({
        ok: true,
        content: post.content
    });
});


router.delete('/posts/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Login required' });
    }

    const post = await Post.findById(req.params.id);

    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user.toString() !== req.session.userId.toString()) {
        return res.status(403).json({
            error: 'You can only delete your own post'
        });
    }

    const acceptedHelp = await Help.findOne({
        post: post._id,
        status: 'Accepted'
    });

    if (acceptedHelp) {
        return res.status(400).json({
            error: 'This post cannot be deleted after help has been accepted.'
        });
    }

    await Post.findByIdAndDelete(post._id);

    await Help.deleteMany({
        post: post._id,
        status: 'Requested'
    });

    res.json({
        ok: true
    });
});
router.post('/profile/avatar', upload.single('avatar'), async (req, res) => { if (!req.session.userId) return res.redirect('/login'); if (!req.file) return res.redirect('/profile'); const u = await User.findById(req.session.userId); u.avatar = '/uploads/' + req.file.filename; await u.save(); req.session.user.avatar = u.avatar; res.redirect('/profile'); });
router.post('/help/:postId', async (req, res) => { if (!req.session.userId) return res.status(401).json({ error: 'Login required' }); const p = await Post.findById(req.params.postId); if (!p || p.user.toString() === req.session.userId) return res.status(400).json({ error: 'Cannot help your own post' }); if (p.status !== 'Open') return res.status(400).json({ error: 'This post is no longer open for help.' }); const existing = await Help.findOne({ post: p._id, helper: req.session.userId, status: { $in: ['Requested', 'Accepted'] } }); if (existing) return res.status(400).json({ error: 'You have already offered to help with this post.' }); const h = await Help.create({ post: p._id, helper: req.session.userId }); await Notification.create({ user: p.user, actor: req.session.userId, type: 'help', helpId: h._id, message: `${req.session.user.name} offered to help with your post.`, link: '/home#post-' + p._id }); req.app.get('io').to('user:' + p.user).emit('helpNotification', { helpId: h._id }); res.json({ ok: true }); });
router.post('/help/:id/accept', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); const h = await Help.findById(req.params.id).populate('post'); if (!h || h.post.user.toString() !== req.session.userId) return res.status(403).json({}); if (h.status !== 'Requested') return res.status(400).json({ error: 'This help offer is no longer waiting for acceptance.' }); h.status = 'Accepted'; await h.save(); await Notification.create({ user: h.helper, actor: req.session.userId, type: 'helpAccepted', message: 'Your help offer was accepted.', link: '/home#post-' + h.post._id }); req.app.get('io').to('user:' + h.helper).emit('helpNotification'); req.app.get('io').to('user:' + h.post.user).emit('helpUpdate', { postId: h.post._id, helpId: h._id, status: 'Accepted' }); let c = await Conversation.findOne({ participants: { $all: [h.post.user, h.helper], $size: 2 } }); if (!c) c = await Conversation.create({ participants: [h.post.user, h.helper] }); res.json({ ok: true, conversation: c._id }); });
router.post('/help/:id/cancel', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({});

    const h = await Help.findById(req.params.id).populate('post');

    if (!h || h.post.user.toString() !== req.session.userId) {
        return res.status(403).json({});
    }

    if (h.status !== 'Accepted') {
        return res.status(400).json({
            error: 'This help offer is not currently accepted.'
        });
    }

    h.status = 'Cancelled';
    await h.save();

    await Notification.create({
        user: h.helper,
        actor: req.session.userId,
        type: 'helpCancelled',
        message: 'Your accepted help offer was cancelled by the post owner.',
        link: '/home#post-' + h.post._id
    });

    req.app.get('io').to('user:' + h.helper).emit('helpNotification');

    req.app.get('io').to('user:' + h.post.user).emit('helpUpdate', {
        postId: h.post._id,
        helpId: h._id,
        status: 'Cancelled'
    });

    res.json({ ok: true });
});
router.post('/help/:id/complete', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({});
    }

    const h = await Help.findById(req.params.id).populate('post');

    if (
        !h ||
        h.post.user.toString() !== req.session.userId ||
        h.status !== 'Accepted'
    ) {
        return res.status(403).json({});
    }

    // Mark help as completed
    h.status = 'Completed';

    // Award initial 100 points only once
    if (!h.pointsAwarded) {
        h.helperPoints = 100;
        h.pointsAwarded = true;
        await h.save();

        // Add 100 points to the helper's total
        await User.findByIdAndUpdate(
            h.helper,
            {
                $inc: {
                    helpPoints: 100
                }
            }
        );
    } else {
        await h.save();
    }

    // Cancel other pending help offers
    await Help.updateMany(
        {
            post: h.post._id,
            _id: { $ne: h._id },
            status: { $in: ['Requested', 'Accepted'] }
        },
        {
            $set: {
                status: 'Cancelled'
            }
        }
    );

    // Resolve the post
    h.post.status = 'Resolved';
    await h.post.save();

    // Notify helper
    await Notification.create({
        user: h.helper,
        actor: req.session.userId,
        type: 'helpComplete',
        message: 'Your help was marked completed. +100 Help Points!',
        link: '/home#post-' + h.post._id
    });

    req.app.get('io')
        .to('user:' + h.helper)
        .emit('helpNotification');

    req.app.get('io')
        .to('user:' + h.post.user)
        .emit('helpUpdate', {
            postId: h.post._id,
            helpId: h._id,
            status: 'Completed'
        });

    res.json({
        ok: true,
        helpPoints: 100
    });
});
router.get('/api/helps', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); const posts = await Post.find({ user: req.session.userId }).select('_id'); const hs = await Help.find({ $or: [{ helper: req.session.userId }, { post: { $in: posts.map(p => p._id) } }] }).populate('post').populate('helper', 'name avatar'); res.json(hs); });
router.post('/help/:id/rate', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                error: 'Login required'
            });
        }

        const h = await Help.findById(req.params.id).populate('post');

        if (!h) {
            return res.status(404).json({
                error: 'Help interaction not found.'
            });
        }

        if (h.status !== 'Completed') {
            return res.status(400).json({
                error: 'You can only rate after the help is completed.'
            });
        }

        const currentUserId = req.session.userId.toString();
        const ownerId = h.post.user.toString();
        const helperId = h.helper.toString();

        // Only the two people involved can rate each other
        if (currentUserId !== ownerId && currentUserId !== helperId) {
            return res.status(403).json({
                error: 'You were not part of this help interaction.'
            });
        }

        // The person rating is rating the OTHER person
        const ratedUser = currentUserId === ownerId
            ? helperId
            : ownerId;

        const score = Number(req.body.score);

        if (![1, 2, 3, 4, 5].includes(score)) {
            return res.status(400).json({
                error: 'Rating must be between 1 and 5.'
            });
        }

        // One rating per person for one help interaction
        const existingRating = await Rating.findOne({
            help: h._id,
            rater: currentUserId,
            ratedUser
        });

        if (existingRating) {
            return res.status(400).json({
                error: 'You have already rated this person.'
            });
        }

        // Save rating
        await Rating.create({
            help: h._id,
            rater: currentUserId,
            ratedUser,
            score
        });

        // Recalculate Trust Score
        const ratings = await Rating.find({
            ratedUser
        }).select('score');

        const total = ratings.reduce(
            (sum, rating) => sum + rating.score,
            0
        );

        const average = ratings.length
            ? total / ratings.length
            : 0;

        await User.findByIdAndUpdate(
            ratedUser,
            {
                trustScore: Number(average.toFixed(2))
            }
        );

        // Only the HELPER receives Help Points.
        // The person receiving help gets NO points.
        if (ratedUser === helperId) {

            const pointsByRating = {
                1: 20,
                2: 40,
                3: 60,
                4: 80,
                5: 100
            };

            const newPoints = pointsByRating[score];

            /*
             * The interaction started with 100 points.
             * We do NOT subtract points from the user's total.
             *
             * Instead, calculate the helper's total points
             * again from all completed help interactions.
             */

            h.helperPoints = newPoints;
            await h.save();

            const completedHelps = await Help.find({
                helper: helperId,
                status: 'Completed'
            }).select('helperPoints');

            const totalHelpPoints = completedHelps.reduce(
                (sum, help) => sum + (help.helperPoints || 100),
                0
            );

            await User.findByIdAndUpdate(
                helperId,
                {
                    helpPoints: totalHelpPoints
                }
            );
        }

        res.json({
            ok: true,
            trustScore: Number(average.toFixed(2))
        });

    } catch (error) {
        console.error('RATE HELP ERROR:', error);

        res.status(500).json({
            error: 'Could not submit rating.'
        });
    }
});
module.exports = router;
