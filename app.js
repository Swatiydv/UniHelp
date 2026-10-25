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
const SupportQuery = require('./models/supportQuery');
const nodemailer = require('nodemailer');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app); const io = new Server(server);
const PORT = process.env.PORT || 3000;
const chatUploadsDir = path.join(__dirname, 'private_uploads', 'chat');

fs.mkdirSync(chatUploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, chatUploadsDir);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, crypto.randomUUID() + ext);
    }
});

const allowedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const uploadChatFile = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            return cb(new Error('File type not allowed.'));
        }

        cb(null, true);
    }
});

app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
app.set('io', io);
app.use(express.urlencoded({ extended: true })); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const sessionMiddleware = session({ secret: process.env.SESSION_SECRET || 'unihelp-dev-secret', resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } });
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
// Upload media to a chat conversation
app.post(
    '/api/conversations/:id/attachments',
    (req, res, next) => {
        if (!req.session.userId) {
            return res.status(401).json({
                error: 'Please log in first.'
            });
        }

        next();
    },
    uploadChatFile.single('attachment'),
    async (req, res) => {
        let uploadedPath = req.file?.path;

        try {
            const conversationId = req.params.id;
            const userId = String(req.session.userId);

            if (!mongoose.isValidObjectId(conversationId)) {
                if (uploadedPath) fs.unlinkSync(uploadedPath);

                return res.status(400).json({
                    error: 'Invalid conversation.'
                });
            }

            const conversation = await Conversation.findById(conversationId);

            if (
                !conversation ||
                !conversation.participants.some(
                    id => String(id) === userId
                )
            ) {
                if (uploadedPath) fs.unlinkSync(uploadedPath);

                return res.status(403).json({
                    error: 'You cannot access this conversation.'
                });
            }

            const sender = await User.findById(userId);

            if (!sender) {
                if (uploadedPath) fs.unlinkSync(uploadedPath);

                return res.status(401).json({
                    error: 'User account not found.'
                });
            }

            const otherId = conversation.participants.find(
                id => String(id) !== userId
            );

            if (!otherId || !(await User.findById(otherId))) {
                if (uploadedPath) fs.unlinkSync(uploadedPath);

                return res.status(400).json({
                    error: 'The other account is unavailable.'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    error: 'Please select a file.'
                });
            }
            const text = String(req.body.text || '').trim();

            if (text.length > 2000) {
                if (uploadedPath) fs.unlinkSync(uploadedPath);
                return res.status(400).json({
                    error: 'Message text cannot exceed 2000 characters.'
                });
            }

            const message = await Message.create({
                conversation: conversation._id,
                sender: userId,
                text: text,
                attachment: {
                    filename: req.file.filename,
                    originalName: path.basename(req.file.originalname),
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                    path: req.file.filename
                }
            });

            uploadedPath = null; // The file now belongs to the saved message.

            conversation.lastMessage = text || `📎 ${message.attachment.originalName}`;
            conversation.lastMessageAt = new Date();

            conversation.unreadFor = Array.from(
                new Set([
                    ...(conversation.unreadFor || []).map(String),
                    String(otherId)
                ])
            );

            await conversation.save();

            const payload = {
                _id: String(message._id),
                text: message.text,
                sender: userId,
                createdAt: message.createdAt,
                attachment: {
                    originalName: message.attachment.originalName,
                    mimetype: message.attachment.mimetype,
                    size: message.attachment.size,
                    url: `/api/attachments/${message._id}`
                }
            };

            io.to('chat:' + conversation._id).emit('newMessage', payload);

            io.to('user:' + otherId).emit('chatPing', {
                conversationId: conversation._id
            });

            return res.json({ message: payload });
        } catch (error) {
            if (uploadedPath && fs.existsSync(uploadedPath)) {
                fs.unlinkSync(uploadedPath);
            }

            console.error('CHAT ATTACHMENT ERROR:', error);

            return res.status(500).json({
                error: 'Could not upload the attachment.'
            });
        }
    },
    (error, req, res, next) => {
        if (error instanceof multer.MulterError) {
            return res.status(400).json({
                error: error.code === 'LIMIT_FILE_SIZE'
                    ? 'Files must be 10 MB or smaller.'
                    : 'The upload could not be completed.'
            });
        }

        if (error) {
            return res.status(400).json({
                error: error.message || 'Invalid file.'
            });
        }

        next();
    }
);
// Securely access chat attachments
app.get('/api/attachments/:messageId', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).send('Please log in first.');
        }

        const { messageId } = req.params;

        if (!mongoose.isValidObjectId(messageId)) {
            return res.status(400).send('Invalid attachment.');
        }

        const message = await Message.findById(messageId);

        if (!message || !message.attachment) {
            return res.status(404).send('Attachment not found.');
        }

        const conversation = await Conversation.findById(
            message.conversation
        );

        const userId = String(req.session.userId);

        if (
            !conversation ||
            !conversation.participants.some(
                id => String(id) === userId
            )
        ) {
            return res.status(403).send('Access denied.');
        }

        const filePath = path.join(
            chatUploadsDir,
            message.attachment.filename
        );

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found.');
        }

        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'private, no-store');

        const isImage = message.attachment.mimetype.startsWith('image/');

        if (isImage) {
            res.type(message.attachment.mimetype);
            return res.sendFile(filePath);
        }

        return res.download(
            filePath,
            path.basename(message.attachment.originalName)
        );

    } catch (error) {
        console.error('ATTACHMENT DOWNLOAD ERROR:', error);
        return res.status(500).send('Could not retrieve attachment.');
    }
});
app.use(async (req, res, next) => { res.locals.user = req.session.user || null; next(); });
app.use(require('./routes/user'));
app.use(require('./routes/posts'));
app.use(require('./routes/chat'));
app.use(require('./routes/notifications'));
app.use(require('./routes/admin'));
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/home');
    }

    res.render('index');
});
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
    ) || null;
    const messages = await Message.find({ conversation: c._id })
        .populate('sender', 'name')
        .sort({ createdAt: 1 })
        .lean();

    messages.forEach(m => {
        if (m.attachment) {
            m.attachment.url = `/api/attachments/${m._id}`;
        }
    });
    c.unreadFor = (c.unreadFor || []).filter(x => x.toString() !== req.session.userId); await c.save();
    res.render('chat', { conversation: c, other, messages });
});
app.get('/chats', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const cs = await Conversation.find({ participants: req.session.userId }).populate('participants', 'name avatar').sort({ updatedAt: -1 }); res.render('chats', { conversations: cs }); });
app.get('/notifications', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const ns = await Notification.find({ user: req.session.userId }).populate('actor', 'name avatar').sort({ createdAt: -1 }).limit(100).lean(); const helpIds = ns.filter(n => n.helpId).map(n => n.helpId); const hs = helpIds.length ? await require('./models/help').find({ _id: { $in: helpIds } }).select('_id status').lean() : []; const map = new Map(hs.map(h => [String(h._id), h.status])); ns.forEach(n => { if (n.helpId) n.helpStatus = map.get(String(n.helpId)) || 'Requested'; }); await Notification.updateMany({ user: req.session.userId }, { $set: { read: true } }); res.render('notifications', { notifications: ns }); });
app.get('/api/search', async (req, res) => { if (!req.session.userId) return res.status(401).json({}); const q = (req.query.q || '').trim(); const posts = await Post.find({ $or: [{ content: { $regex: q, $options: 'i' } }, { type: { $regex: q, $options: 'i' } }] }).populate('user', 'name department year avatar').sort({ createdAt: -1 }).limit(50); res.json(posts); });
app.get('/ai', async (req, res) => res.json({ enabled: !!process.env.AI_API_KEY }));

const unihelpAnswers = [
    {
        keywords: /forgot password|reset password|password/i,
        reply: 'For password problems, use Forgot Password on the login page. If you still cannot access your account, type "report issue" to submit a support request.'
    },
    {
        keywords: /help request|offer help|accept help|complete help/i,
        reply: 'Create a Help Request post from Home. Other students can offer help, and you can accept an offer from Notifications. Once the help is finished, mark it as completed.'
    },
    {
        keywords: /chat|message/i,
        reply: 'Open Chats to communicate with other students. Messages are delivered in real time.'
    },
    {
        keywords: /help points|trust score|rating|stars/i,
        reply: 'After a help interaction is completed, the students involved can rate each other. Ratings affect Trust Score, and helpers earn Help Points.'
    },
    {
        keywords: /post|question|borrow|sell|lend/i,
        reply: 'Use the + button on Home to create a Help Request, Question, Borrow, Sell or Lend post.'
    },
    {
        keywords: /profile|edit account|change password/i,
        reply: 'Open your profile to update your account information. You can also change your password in account settings.'
    }
];

const seriousIssuePattern =
    /\b(harass(?:ment|ed|ing)?|threat(?:s|ened|ening)?|bully(?:ing|ied)?|stalk(?:ing|ed)?|assault|unsafe|hacked|account compromised|data breach|fraud|scam|emergency)\b/i;

async function sendAdminAlert(query, student) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_EMAIL,
        subject: 'UniHelp: Serious student support report',
        text: [
            'A serious issue has been reported through UniHelp.',
            '',
            `Student: ${student.name}`,
            `Email: ${student.email}`,
            `Category: ${query.category}`,
            `Report ID: ${query._id}`,
            '',
            'Student report:',
            query.message,
            '',
            'Please review and follow up.'
        ].join('\n')
    });
}


async function askGroq(message, history = []) {
    const safeHistory = Array.isArray(history)
        ? history
            .filter(item =>
                item &&
                ['user', 'assistant'].includes(item.role) &&
                typeof item.content === 'string'
            )
            .slice(-10)
            .map(item => ({
                role: item.role,
                content: item.content.slice(0, 2000)
            }))
        : [];

    const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                temperature: 0.4,
                max_completion_tokens: 1500,
                messages: [
                    {
                        role: 'system',
                        content: `
You are UniHelp AI, the support assistant for UniHelp,
a university community platform.

ONLY answer questions related to UniHelp.

UniHelp features:
- Students can create Help Request, Question,
  Borrow, Sell and Lend posts.
- Students can offer help on posts.
- Post owners can accept offers and mark help
  interactions as completed.
- Students can chat in real time.
- Completed help interactions allow mutual
  ratings from 1 to 5 stars.
- Ratings affect Trust Score.
- Helpers earn Help Points based on ratings.
- Students can manage their profiles and passwords.
- Students can report problems to the UniHelp team.

Have natural conversations and answer follow-up questions
using the previous messages.

If a student asks something unrelated to UniHelp,
politely explain that you only assist with UniHelp.

If a student reports a problem you cannot resolve,
ask them to use the Report an Issue button.

For harassment, threats, account compromise or
other serious concerns, direct them to the
Report a Serious Issue button.

Never claim a report has been submitted or an email
has been sent unless the application confirms it.

Never invent university policies or claim to have
accessed student accounts, messages or records.

Keep responses friendly, clear and reasonably short.
`
                    },
                    ...safeHistory,
                    {
                        role: 'user',
                        content: message
                    }
                ]
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error('GROQ API ERROR:', response.status, error);
        throw new Error('Groq request failed');
    }
    const data = await response.json();

    const choice = data.choices?.[0];
    const reply = choice?.message?.content?.trim();

    if (!reply) {
        console.error('GROQ EMPTY RESPONSE:', {
            finishReason: choice?.finish_reason,
            usage: data.usage
        });

        throw new Error('Groq returned an empty response');
    }

    return reply;
}

app.post('/api/ai', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                reply: 'Please log in to use UniHelp support.'
            });
        }

        const message = String(req.body.message || '').trim();

        if (!message || message.length > 2000) {
            return res.status(400).json({
                reply: 'Please enter a message of up to 2000 characters.'
            });
        }

        const student = await User.findById(req.session.userId)
            .select('name email');

        if (!student) {
            return res.status(401).json({
                reply: 'Your session has expired. Please log in again.'
            });
        }

        // A student can explicitly submit a report using:
        // report issue: description of the problem
        const reportMatch = message.match(
            /^report (?:a )?(?:serious )?issue\s*:\s*([\s\S]+)/i
        );

        if (reportMatch) {
            const description = reportMatch[1].trim();

            if (description.length < 10) {
                return res.json({
                    reply: 'Please describe your issue in at least 10 characters.'
                });
            }

            const isSerious =
                /^report (?:a )?serious issue/i.test(message) ||
                seriousIssuePattern.test(description);

            const query = await SupportQuery.create({
                user: student._id,
                message: description,
                category: isSerious ? 'Serious' : 'General'
            });

            if (isSerious) {
                try {
                    if (!process.env.ADMIN_EMAIL) {
                        throw new Error('ADMIN_EMAIL is not configured.');
                    }

                    await sendAdminAlert(query, student);

                    query.emailSent = true;
                    await query.save();
                } catch (emailError) {
                    console.error(
                        'SUPPORT ALERT EMAIL FAILED:',
                        emailError
                    );
                }
            }

            return res.json({
                reply: isSerious
                    ? 'Your serious report has been saved. Our team will review it. If you are in immediate danger, contact campus security or local emergency services directly.'
                    : 'Your support query has been saved. Our team can review it.'
            });
        }

        if (/^report (?:a )?(?:serious )?issue$/i.test(message)) {
            return res.json({
                reply: 'To submit a report, type "report issue: " followed by a description. For an urgent concern, type "report serious issue: " followed by the details.'
            });
        }

        // Automatically flag potentially serious messages.
        // Ask for confirmation before saving a report.
        if (seriousIssuePattern.test(message)) {
            return res.json({
                reply: 'This sounds like an issue that may need attention. To submit it to the UniHelp team, type "report serious issue: " followed by your description. If you are in immediate danger, contact campus security or local emergency services.'
            });
        }

        const reply = await askGroq(
            message,
            req.body.history
        );

        return res.json({ reply });

    } catch (error) {
        console.error('UNIHELP SUPPORT ERROR:', error);

        return res.status(500).json({
            reply: 'UniHelp support is temporarily unavailable. Please try again.'
        });
    }
});
// Track active Socket.IO connections for each user.
const onlineUsers = new Map();

function setUserOnline(userId, socketId) {
    const id = String(userId);

    if (!onlineUsers.has(id)) {
        onlineUsers.set(id, new Set());
    }

    onlineUsers.get(id).add(socketId);
}

function setUserOffline(userId, socketId) {
    const id = String(userId);
    const sockets = onlineUsers.get(id);

    if (!sockets) return false;

    sockets.delete(socketId);

    if (sockets.size === 0) {
        onlineUsers.delete(id);
        return true;
    }

    return false;
}
io.on('connection', socket => {
    const s = socket.request.session;

    if (!s?.userId) return;

    const userId = String(s.userId);

    socket.join('user:' + userId);

    // Mark user online
    const wasOffline = !onlineUsers.has(userId);

    setUserOnline(userId, socket.id);



    // Notify other users when this user comes online
    if (wasOffline) {
        socket.broadcast.emit('userStatus', {
            userId,
            online: true
        });
    }

    // Mark user offline after their last connection closes
    socket.on('disconnect', () => {
        const wentOffline = setUserOffline(userId, socket.id);

        if (wentOffline) {
            socket.broadcast.emit('userStatus', {
                userId,
                online: false
            });
        }
    });
    socket.on('checkUserStatus', async targetUserId => {
        try {
            if (!mongoose.isValidObjectId(targetUserId)) return;

            const conversation = await Conversation.findOne({
                participants: { $all: [userId, targetUserId], $size: 2 }
            });

            if (!conversation) return;
            socket.emit('userStatus', {
                userId: String(targetUserId),
                online: onlineUsers.has(String(targetUserId))
            });
        } catch (error) {
            console.error('PRESENCE CHECK ERROR:', error);
        }
    });
    socket.on('joinChat', id => socket.join('chat:' + id)); socket.on('typing', data => socket.to('chat:' + data.conversationId).emit('typing', { name: s.user?.name || 'Student' }));

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
