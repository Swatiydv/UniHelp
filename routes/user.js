const Post = require('../models/post');
const Help = require('../models/help');
const Rating = require('../models/rating');
const Notification = require('../models/notification');
const Conversation = require('../models/conversation');
const express = require('express'), bcrypt = require('bcrypt'), crypto = require('crypto'); const User = require('../models/user'); const router = express.Router();
const mail = async (to, subject, text) => {
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            text
        });

        console.log("EMAIL SENT SUCCESSFULLY:", info.messageId);
    } catch (error) {
        console.error("EMAIL SENDING FAILED:");
        console.error(error);
        throw error;
    }
};
const validPassword = p => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(p);
router.get('/signup', (req, res) => res.render('signup', { error: null, form: { name: '', email: '', department: '', year: '' } }));
router.post('/signup', async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            confirmPassword,
            department,
            year
        } = req.body;

        const cleanEmail = (email || '').toLowerCase().trim();
        // Check whether passwords match
        if (password !== confirmPassword) {
            return res.status(400).render('signup', {
                error: 'Passwords do not match. Please try again.',
                form: {
                    name: name || '',
                    email: email || '',
                    department: department || '',
                    year: year || ''
                }
            });
        }
        const form = {
            name: name || '',
            email: email || '',
            department: department || '',
            year: year || ''
        };

        // Check password requirements
        if (!validPassword(password || '')) {
            return res.render('signup', {
                error: 'Password must be at least 8 characters and include uppercase, lowercase, number and special character.',
                form
            });
        }

        // Check whether account already exists
        const existingUser = await User.findOne({
            email: cleanEmail
        });

        if (existingUser) {
            return res.render('signup', {
                error: 'An account with this email already exists.',
                form
            });
        }

        // Generate OTP
        const otp = String(
            crypto.randomInt(100000, 1000000)
        );

        // Store signup information temporarily in the session.
        // The User is NOT created yet.
        req.session.signupData = {
            name,
            email: cleanEmail,
            password,
            department,
            year,
            otp,
            otpExpires: Date.now() + 10 * 60 * 1000
        };

        // Send OTP
        await mail(
            cleanEmail,
            'UniHelp Email Verification',
            `Your UniHelp verification code is ${otp}. It expires in 10 minutes.`
        );

        // Go to OTP verification page
        res.render('verify-email', {
            email: cleanEmail,
            error: null
        });

    } catch (e) {
        console.error('SIGNUP ERROR:', e);

        const form = {
            name: req.body.name || '',
            email: req.body.email || '',
            department: req.body.department || '',
            year: req.body.year || ''
        };

        res.render('signup', {
            error: 'Could not start account verification.',
            form
        });
    }
});

router.post('/verify-email', async (req, res) => {
    try {
        const signupData = req.session.signupData;

        if (!signupData) {
            return res.redirect('/signup');
        }

        const enteredOtp = String(
            req.body.otp || ''
        ).trim();

        // Check OTP expiration
        if (Date.now() > signupData.otpExpires) {
            delete req.session.signupData;

            return res.render('signup', {
                error: 'Your OTP has expired. Please sign up again.',
                form: {
                    name: signupData.name || '',
                    email: signupData.email || '',
                    department: signupData.department || '',
                    year: signupData.year || ''
                }
            });
        }

        // Check OTP
        if (enteredOtp !== signupData.otp) {
            return res.render('verify-email', {
                email: signupData.email,
                error: 'Incorrect verification code. Please try again.'
            });
        }

        // Double-check email wasn't registered while verification was happening
        const existingUser = await User.findOne({
            email: signupData.email
        });

        if (existingUser) {
            delete req.session.signupData;

            return res.render('login', {
                error: 'An account with this email already exists. Please log in.',
                email: signupData.email
            });
        }

        // NOW create the actual account
        const hash = await bcrypt.hash(
            signupData.password,
            12
        );

        const u = await User.create({
            name: signupData.name,
            email: signupData.email,
            password: hash,
            department: signupData.department,
            year: signupData.year,
            emailVerified: true,
            role:
                (process.env.ADMIN_EMAIL || '').toLowerCase() ===
                    signupData.email.toLowerCase()
                    ? 'admin'
                    : 'student'
        });

        // Remove temporary signup information
        delete req.session.signupData;

        // Automatically log the new user in
        req.session.userId = u._id.toString();

        req.session.user = {
            id: u._id.toString(),
            name: u.name,
            email: u.email,
            role: u.role,
            avatar: u.avatar
        };

        // Send them directly to Home
        res.redirect('/home');

    } catch (error) {
        console.error('OTP VERIFICATION ERROR:', error);

        res.status(500).send(
            'Unable to verify your email.'
        );
    }
});
router.get('/login', (req, res) => req.session.userId ? res.redirect('/home') : res.render('login', { error: null, email: '' }));

router.post('/login', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    const u = await User.findOne({ email });

    // Email is not registered.
    if (!u) {
        return res.render('login', {
            error: 'No account found with this email. Please.',
            email,
            showSignup: true
        });
    }

    // Email exists, but password is incorrect.
    const passwordMatches = await bcrypt.compare(
        password,
        u.password
    );

    if (!passwordMatches) {
        return res.render('login', {
            error: 'Incorrect password. Please try again.',
            email,
            showSignup: false
        });
    }

    // Successful login.
    req.session.userId = u._id.toString();

    req.session.user = {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
        avatar: u.avatar
    };

    res.redirect('/home');
});
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
router.get('/forgot-password', (req, res) => res.render('forgot', { error: null, message: null }));
router.post('/forgot-password', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();

        const user = await User.findOne({ email });

        const message =
            'If this email is registered, a reset code has been sent.';

        if (!user) {
            return res.render('forgot', {
                error: null,
                message,
                email
            });
        }

        const code = String(
            crypto.randomInt(100000, 1000000)
        );

        user.resetOtp = await bcrypt.hash(code, 12);
        user.resetOtpExpires = new Date(
            Date.now() + 15 * 60 * 1000
        );

        await user.save();

        await mail(
            user.email,
            'UniHelp Password Reset',
            `Your password reset code is ${code}. It expires in 15 minutes.`
        );

        return res.render('reset', {
            email: user.email,
            code: '',
            error: null
        });

    } catch (error) {
        console.error('FORGOT PASSWORD ERROR:', error);

        return res.status(500).render('forgot', {
            error: 'Unable to process your request. Please try again.',
            message: null,
            email: req.body.email || ''
        });
    }
});

router.post('/reset-password', async (req, res) => {
    const email = (req.body.email || '').toLowerCase().trim();
    const code = String(req.body.code || '').trim();

    const showError = message => res.render('reset', {
        email,
        code: '',
        error: message
    });

    try {
        const user = await User.findOne({ email });

        if (
            !user ||
            !user.resetOtp ||
            !user.resetOtpExpires ||
            new Date(user.resetOtpExpires).getTime() <= Date.now()
        ) {
            return showError('Invalid or expired reset code.');
        }

        const validCode = await bcrypt.compare(
            code,
            user.resetOtp
        );

        if (!validCode) {
            return showError('Invalid or expired reset code.');
        }

        const password = req.body.password || '';
        const confirmPassword = req.body.confirmPassword || '';

        if (!validPassword(password)) {
            return showError(
                'Password must have at least 8 characters, uppercase, lowercase, a number and a special character.'
            );
        }

        if (password !== confirmPassword) {
            return showError('Passwords do not match.');
        }

        user.password = await bcrypt.hash(password, 12);
        user.resetOtp = undefined;
        user.resetOtpExpires = undefined;

        await user.save();

        return res.redirect('/login');

    } catch (error) {
        console.error('RESET PASSWORD ERROR:', error);

        return res.status(500).render('reset', {
            email,
            code: '',
            error: 'Unable to reset your password. Please try again.'
        });
    }
});
router.post('/resend-otp', async (req, res) => {
    try {
        const signup = req.session.signupData;

        if (!signup) {
            return res.redirect('/signup');
        }

        const otp = String(crypto.randomInt(100000, 1000000));

        signup.otp = otp;
        signup.otpExpires = Date.now() + 10 * 60 * 1000;

        req.session.signupData = signup;

        await mail(
            signup.email,
            'UniHelp verification code',
            `Your UniHelp verification code is ${otp}. It expires in 10 minutes.`
        );

        res.render('verify-email', {
            email: signup.email,
            error: null,
            success: 'A new OTP has been sent to your email.'
        });

    } catch (error) {
        console.error('RESEND OTP ERROR:', error);

        const signup = req.session.signupData;

        res.render('verify-email', {
            email: signup ? signup.email : '',
            error: 'Could not resend OTP. Please try again.',
            success: null
        });
    }
});

router.post('/change-password', async (req, res) => {
    try {
        // Check whether the user is logged in
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        const {
            currentPassword,
            newPassword,
            confirmPassword
        } = req.body;

        const user = await User.findById(req.session.userId);

        if (!user) {
            return res.redirect('/login');
        }

        // Verify current password
        const isMatch = await bcrypt.compare(
            currentPassword || '',
            user.password
        );

        if (!isMatch) {
            return res.render('settings', {
                error: 'Your current password is incorrect.',
                success: null
            });
        }

        // Check that the new passwords match
        if (newPassword !== confirmPassword) {
            return res.render('settings', {
                error: 'New passwords do not match.',
                success: null
            });
        }

        // Validate password strength
        if (!validPassword(newPassword || '')) {
            return res.render('settings', {
                error: 'Password must contain at least 8 characters, uppercase, lowercase, a number and a special character.',
                success: null
            });
        }

        // Prevent reusing the current password
        const samePassword = await bcrypt.compare(
            newPassword,
            user.password
        );

        if (samePassword) {
            return res.render('settings', {
                error: 'Your new password must be different from your current password.',
                success: null
            });
        }

        // Hash and save the new password
        user.password = await bcrypt.hash(newPassword, 12);

        await user.save();

        return res.render('settings', {
            error: null,
            success: 'Your password has been changed successfully!'
        });

    } catch (error) {
        console.error('CHANGE PASSWORD ERROR:', error);

        return res.status(500).render('settings', {
            error: 'Something went wrong. Please try again.',
            success: null
        });
    }
});


router.post('/delete-account', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    const userId = req.session.userId;

    const showDeleteError = (message, status = 400) => {
        return res.status(status).render('settings', {
            error: null,
            success: null,
            deleteError: message
        });
    };

    try {
        const user = await User.findById(userId);

        if (!user) {
            return res.redirect('/login');
        }

        // 1. Verify the current password.
        const password = req.body.password || '';

        const correctPassword = await bcrypt.compare(
            password,
            user.password
        );

        if (!correctPassword) {
            return showDeleteError(
                'Incorrect password. Please try again.'
            );
        }

        // 2. Find posts created by this user.
        const userPosts = await Post.find({
            user: userId
        }).select('_id');

        const postIds = userPosts.map(post => post._id);

        // 3. Find help records related to the user's
        // posts OR where the user was the helper.
        const relatedHelps = await Help.find({
            $or: [
                { post: { $in: postIds } },
                { helper: userId }
            ]
        }).select('_id');

        const helpIds = relatedHelps.map(help => help._id);

        // 4. Remove ratings involving this user
        // or help interactions that are being deleted.
        await Rating.deleteMany({
            $or: [
                { rater: userId },
                { ratedUser: userId },
                { help: { $in: helpIds } }
            ]
        });

        // 5. Remove notifications belonging to this user,
        // created by this user, or referring to deleted help.
        await Notification.deleteMany({
            $or: [
                { user: userId },
                { actor: userId },
                { helpId: { $in: helpIds } }
            ]
        });

        // 6. Delete related help records.
        await Help.deleteMany({
            _id: { $in: helpIds }
        });

        // 7. Delete posts created by the user.
        await Post.deleteMany({
            user: userId
        });

        // 8. Preserve shared chat history.
        // Keep the user's ID in participants so the
        // remaining participant can still open the chat.
        // Remove only their unread notification status.
        await Conversation.updateMany(
            { unreadFor: userId },
            { $pull: { unreadFor: userId } }
        );

        // 9. Delete the user LAST.
        // Existing messages will now display a missing
        // sender, which chat.ejs handles as Deleted User.
        await User.deleteOne({
            _id: userId
        });

        // 10. Log out and clear the session.
        req.session.destroy(error => {
            if (error) {
                console.error(
                    'SESSION DESTROY ERROR:',
                    error
                );

                return res.status(500).send(
                    'Your account was deleted, but your session could not be cleared. Please close your browser.'
                );
            }

            res.clearCookie('connect.sid');

            return res.redirect('/login');
        });

    } catch (error) {
        console.error(
            'DELETE ACCOUNT ERROR:',
            error
        );

        return showDeleteError(
            'Something went wrong while deleting your account. Please contact an administrator before trying again.',
            500
        );
    }
});

module.exports = router;
