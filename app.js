require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const { Server } = require('socket.io');
const User = require('./models/user');
const Post = require('./models/post');
const Help = require('./models/help');
const Rating = require('./models/rating');
const Notification = require('./models/notification');
const Conversation = require('./models/conversation');
const Message = require('./models/message');
const app = express();
const server = http.createServer(app); const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
app.set('io', io);
app.use(express.urlencoded({ extended: true })); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const sessionMiddleware = session({ secret: process.env.SESSION_SECRET || 'unihelp-dev-secret', resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } });
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.use(async (req, res, next) => { res.locals.user = req.session.user || null; next(); });
app.use(require('./routes/user'));
app.use(require('./routes/posts'));
app.use(require('./routes/chat'));
app.use(require('./routes/notifications'));
app.use(require('./routes/admin'));
app.get('/', (req, res) => res.redirect(req.session.userId ? '/home' : '/login'));
app.get('/home', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const posts = await Post.find()
        .populate('user', 'name department year avatar')
        .sort({ createdAt: -1 });

    const postIds = posts.map(p => p._id);

    const helps = await Help.find({
        post: { $in: postIds }
    }).populate('helper', 'name avatar');

    const ratings = await Rating.find({
        rater: req.session.userId,
        help: { $in: helps.map(h => h._id) }
    });

    res.render('home', {
        posts,
        helps,
        ratings,
        currentUserId: req.session.userId
    });
});
app.get('/profile', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const user = await User.findById(req.session.userId); if (!user) return res.redirect('/login'); const posts = await Post.find({ user: user._id }).sort({ createdAt: -1 }); res.render('profile', { profileUser: user, posts, readonly: false }); });
app.get('/profile/:id', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const user = await User.findById(req.params.id); if (!user) return res.status(404).send('User not found'); const posts = await Post.find({ user: user._id }).sort({ createdAt: -1 }); res.render('profile', { profileUser: user, posts, readonly: true }); });
app.get('/settings', (req, res) => { if (!req.session.userId) return res.redirect('/login'); res.render('settings'); });
app.post('/profile/update', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const u = await User.findById(req.session.userId); if (!u) return res.redirect('/login'); u.bio = (req.body.bio || '').trim().slice(0, 500); await u.save(); res.redirect('/profile'); });
app.get('/api/me', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); const u = await User.findById(req.session.userId).select('-password -otp -resetOtp'); res.json(u); });
app.get('/api/unread', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); const [n, c] = await Promise.all([Notification.countDocuments({ user: req.session.userId, read: false }), Conversation.countDocuments({ participants: req.session.userId, unreadFor: req.session.userId })]); res.json({ notifications: n, chats: c }); });
app.get('/chat/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login'); const c = await Conversation.findById(req.params.id).populate('participants', 'name avatar'); if (!c || !c.participants.some(x => x._id.toString() === req.session.userId)) return res.status(403).send('Not allowed'); const other = c.participants.find(
        x => x && x._id.toString() !== req.session.userId
    ) || null; const messages = await Message.find({ conversation: c._id }).populate('sender', 'name').sort({ createdAt: 1 }); c.unreadFor = (c.unreadFor || []).filter(x => x.toString() !== req.session.userId); await c.save(); res.render('chat', { conversation: c, other, messages });
});
app.get('/chats', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const cs = await Conversation.find({ participants: req.session.userId }).populate('participants', 'name avatar').sort({ updatedAt: -1 }); res.render('chats', { conversations: cs }); });
app.get('/notifications', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const ns = await Notification.find({ user: req.session.userId }).populate('actor', 'name avatar').sort({ createdAt: -1 }).limit(100).lean(); const helpIds = ns.filter(n => n.helpId).map(n => n.helpId); const hs = helpIds.length ? await require('./models/help').find({ _id: { $in: helpIds } }).select('_id status').lean() : []; const map = new Map(hs.map(h => [String(h._id), h.status])); ns.forEach(n => { if (n.helpId) n.helpStatus = map.get(String(n.helpId)) || 'Requested'; }); await Notification.updateMany({ user: req.session.userId }, { $set: { read: true } }); res.render('notifications', { notifications: ns }); });
app.get('/api/search', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); const q = (req.query.q || '').trim(); const posts = await Post.find({ $or: [{ content: { $regex: q, $options: 'i' } }, { type: { $regex: q, $options: 'i' } }] }).populate('user', 'name department year avatar').sort({ createdAt: -1 }).limit(50); res.json(posts); });
app.get('/ai', async (req, res) => res.json({ enabled: !!process.env.AI_API_KEY }));
app.post('/api/ai', async (req, res) => { try { const q = (req.body.message || '').trim(); if (!q) return res.json({ reply: 'Ask me anything about UniHelp or student life.' }); if (!process.env.AI_API_KEY) { const ql = q.toLowerCase(); let reply = 'I can help with UniHelp features, posts, help requests, chats, profiles and account questions.'; if (/password|forgot|reset/.test(ql)) reply = 'For a password issue, use Forgot password on the login page. Your new password must be at least 8 characters and include uppercase, lowercase, a number and a special character.'; else if (/help request|offer help|accept help/.test(ql)) reply = 'Open a post and choose Help. The post owner receives a real-time notification and can accept your offer from Notifications. Multiple students can offer help until the request is completed.'; else if (/chat|message/.test(ql)) reply = 'UniHelp chat is real time. Open Chats and messages appear instantly without refreshing.'; else if (/post|question|borrow|sell|lend/.test(ql)) reply = 'Use the + button on Home to create a Help Request, Question, Borrow, Sell or Lend/Give Away post.'; return res.json({ reply }); } const r = await fetch((process.env.AI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.AI_API_KEY }, body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: 'You are UniHelp AI, a concise friendly university community assistant. Help students with campus/community questions. Do not invent official university policies.' }, { role: 'user', content: q }], temperature: .4 }) }); const j = await r.json(); res.json({ reply: j.choices?.[0]?.message?.content || 'I could not answer that right now.' }); } catch (e) { console.error(e); res.status(500).json({ reply: 'AI assistant is temporarily unavailable.' }); } });
io.on('connection', socket => {
    const s = socket.request.session; if (!s?.userId) return; socket.join('user:' + s.userId); socket.on('joinChat', id => socket.join('chat:' + id)); socket.on('typing', data => socket.to('chat:' + data.conversationId).emit('typing', { name: s.user?.name || 'Student' }));

    socket.on('sendMessage', async data => {
        try {
            if (!data || !mongoose.isValidObjectId(data.conversationId)) {
                return;
            }

            const text = String(data.text || '').trim();

            if (!text || text.length > 2000) return;

            const c = await Conversation.findById(data.conversationId);

            if (!c) return;

            const senderId = String(s.userId);

            if (!c.participants.some(
                id => String(id) === senderId
            )) return;

            // Check whether the sender's account exists.
            const sender = await User.findById(senderId);
            if (!sender) return;

            const otherId = c.participants.find(
                id => String(id) !== senderId
            );

            if (!otherId) return;

            // Prevent messages to deleted accounts.
            const otherUser = await User.findById(otherId);

            if (!otherUser) {
                socket.emit('chatError', {
                    message: 'This account has been deleted.'
                });
                return;
            }

            const m = await Message.create({
                conversation: c._id,
                sender: senderId,
                text
            });

            c.lastMessage = text;
            c.lastMessageAt = new Date();

            c.unreadFor = Array.from(
                new Set([
                    ...(c.unreadFor || []).map(String),
                    String(otherId)
                ])
            );

            await c.save();

            const payload = {
                _id: m._id,
                text: m.text,
                sender: senderId,
                createdAt: m.createdAt
            };

            io.to('chat:' + c._id).emit('newMessage', payload);

            io.to('user:' + otherId).emit('chatPing', {
                conversationId: c._id
            });

        } catch (error) {
            console.error('SEND MESSAGE ERROR:', error);
        }
    });

}); // Closes io.on('connection')

// START SERVER

async function start() {
    try {
        await mongoose.connect(
            process.env.MONGODB_URI ||
            'mongodb://127.0.0.1:27017/UniHelp_Final'
        );

        console.log('MongoDB connected');

        server.listen(PORT, () => {
            console.log(`UniHelp running at http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error(
            'MongoDB connection failed:',
            error.message
        );

        process.exit(1);
    }
}

start();
