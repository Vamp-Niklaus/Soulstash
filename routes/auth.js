const router = require('express').Router();
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { authenticateToken, upload, JWT_SECRET } = require('../middleware/auth');

// In-memory OTP store (keyed by email, expires after 10-15 min)
const otpStore = new Map();

function escapedRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Brevo email helper ────────────────────────────────────────────────────────
const sendBrevoEmail = async (recipientEmail, recipientName, subject, htmlContent) => {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('Brevo API key is not configured');
  }
  const emailData = {
    sender: { name: 'Soulstash', email: 'soulstash.onrender@gmail.com' },
    to: [{ email: recipientEmail, name: recipientName || 'User' }],
    subject,
    htmlContent
  };
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify(emailData)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Brevo error: ${data.message || data.code}`);
  console.log('✅ Email sent, messageId:', data.messageId);
  return data;
};

// ── Default collections for new users ────────────────────────────────────────
const defaultCollections = () => [
  { name: 'Watched',   isDeletable: true, isPublic: false, isPublished: false, banner: 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg', movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date() },
  { name: 'Watchlist', isDeletable: true, isPublic: false, isPublished: false, banner: 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg', movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date() }
];

function splitFullName(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    fullName: parts.join(' '),
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

// GET /api/auth/check-username
router.get('/check-username', async (req, res) => {
  try {
    const username = String(req.query.username || '').trim();
    if (username.length < 3 || username.length > 30)
      return res.json({ available: false, message: 'Username must be between 3 and 30 characters' });
    const existing = await getDb().collection('users').findOne({
      username: { $regex: new RegExp(`^${escapedRegex(username)}$`, 'i') }
    });
    res.json({ available: !existing, message: existing ? 'Username is already taken' : 'Username is available' });
  } catch (err) {
    console.error('Username check error:', err);
    res.status(500).json({ available: false, message: 'Server error' });
  }
});

router.get('/check-email', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ available: false, message: 'Please enter a valid email address' });
    }
    const existing = await getDb().collection('users').findOne({
      email: { $regex: new RegExp(`^${escapedRegex(email)}$`, 'i') }
    });
    res.json({ available: !existing, message: existing ? 'Email is already registered' : 'Email is available' });
  } catch (err) {
    console.error('Email check error:', err.message || err);
    res.status(500).json({ available: false, message: 'Unable to check email availability' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username: rawUsername, password, fullName } = req.body;
    const username = String(rawUsername || '').trim();
    if (!username || !password || !fullName)
      return res.status(400).json({ error: 'Name, username and password are required' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
    if (fullName.trim().length < 2)
      return res.status(400).json({ error: 'Please enter your full name' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await getDb().collection('users').findOne({
      username: { $regex: new RegExp(`^${escapedRegex(username)}$`, 'i') }
    });
    if (existing) return res.status(409).json({ error: 'Username is already taken' });

    const nameParts = splitFullName(fullName);
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const result = await getDb().collection('users').insertOne({
        username,
        password: hashedPassword,
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        collections: defaultCollections(),
        favoritePeople: [],
        followers: [],
        following: [],
        admin: false,
        showAdult: false,
        collectionVersion: 1,
        createdAt: new Date(), updatedAt: new Date()
      });
      const token = jwt.sign({ userId: result.insertedId, username }, JWT_SECRET, { expiresIn: '7d' });
      res.status(201).json({
        message: 'Account created successfully!',
        token,
        user: { id: result.insertedId, username, fullName: nameParts.fullName, admin: false, showAdult: false }
      });
    } catch (insertErr) {
      if (insertErr.code === 11000)
        return res.status(409).json({ error: 'Username already exists' });
      throw insertErr;
    }
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username: rawIdentifier, password } = req.body;
    const identifier = String(rawIdentifier || '').trim();
    if (!identifier || !password)
      return res.status(400).json({ error: 'Email/Username and password are required' });

    const col = getDb().collection('users');
    const isEmail = identifier.includes('@');
    const identifierRegex = { $regex: new RegExp(`^${escapedRegex(identifier)}$`, 'i') };
    let user = isEmail
      ? (await col.findOne({ email: identifierRegex })) || (await col.findOne({ username: identifierRegex }))
      : await col.findOne({ username: identifierRegex });

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    console.log('✅ User logged in:', user.username);
    res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        username: user.username,
        admin: Boolean(user.admin),
        showAdult: Boolean(user.showAdult)
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful!' });
});

// POST /api/auth/verify-token
// NOTE: This route does a DB lookup on every call.
// Frontend should cache the result and NOT call this on every page load.
router.post('/verify-token', authenticateToken, async (req, res) => {
  try {
    const user = await getDb().collection('users').findOne(
      { _id: new ObjectId(req.user.userId) },
      { projection: { password: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      success: true,
      username: user.username,
      admin: Boolean(user.admin),
      showAdult: Boolean(user.showAdult)
    });
  } catch (err) {
    console.error('Token verification error:', err);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await getDb().collection('users').findOne(
      { _id: req.user.userId },
      { projection: { password: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user._id,
      username: user.username,
      createdAt: user.createdAt,
      admin: Boolean(user.admin),
      showAdult: Boolean(user.showAdult)
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// GET /api/auth/profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await getDb().collection('users').findOne(
      { _id: new ObjectId(req.user.userId) },
      { projection: { password: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ...user, admin: Boolean(user.admin), showAdult: Boolean(user.showAdult) });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// POST /api/auth/update-profile
router.post('/update-profile', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const formData = req.body;
    const updateData = {
      firstName: formData.firstName || '',
      lastName: formData.lastName || '',
      dateOfBirth: formData.dateOfBirth || '',
      bio: formData.bio || '',
      instagramHandle: formData.instagramHandle || '',
      xHandle: formData.xHandle || '',
      youtubeHandle: formData.youtubeHandle || '',
      updatedAt: new Date()
    };
    if (req.file) {
      updateData.avatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (formData.avatarUrl || formData.avatar) {
      updateData.avatar = formData.avatarUrl || formData.avatar;
    }
    const result = await getDb().collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );
    if (result.matchedCount === 0)
      return res.status(404).json({ error: 'User not found' });
    const updated = await getDb().collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );
    res.json(updated);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email: rawEmail, username: rawUsername, fullName: rawFullName } = req.body;
    const email = String(rawEmail || '').trim().toLowerCase();
    const username = String(rawUsername || '').trim();
    const fullName = String(rawFullName || '').trim();
    if (!email || !username || !fullName)
      return res.status(400).json({ error: 'Name, email and username are required' });
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
      return res.status(400).json({ error: 'Please enter a valid email address' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
    if (fullName.trim().length < 2)
      return res.status(400).json({ error: 'Please enter your full name' });

    const users = getDb().collection('users');
    const existingUsername = await users.findOne({ username: { $regex: new RegExp(`^${escapedRegex(username)}$`, 'i') } });
    if (existingUsername) return res.status(409).json({ error: 'Username is already taken' });
    const existingEmail = await users.findOne({ email: { $regex: new RegExp(`^${escapedRegex(email)}$`, 'i') } });
    if (existingEmail) return res.status(409).json({ error: 'Email is already registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { email, username, fullName, otp, createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60 * 1000) });

    try {
      const html = `<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2>Welcome to Soulstash, ${fullName}!</h2>
        <p>Your registration OTP:</p>
        <div style="background:#f4f4f4;padding:20px;text-align:center;margin:20px 0;border-radius:5px">
          <h1 style="font-size:32px;letter-spacing:5px;color:#007bff;margin:0">${otp}</h1>
        </div>
        <p>Expires in 10 minutes. Do not share.</p>
      </body></html>`;
      await sendBrevoEmail(email, fullName, 'Verify Your Email - Soulstash', html);
    } catch (emailErr) {
      otpStore.delete(email);
      console.error('OTP email failed:', emailErr.message || emailErr);
      return res.status(502).json({ error: 'Failed to send verification email' });
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await getDb().collection('users').findOne({ email });
    if (!user) return res.status(404).json({ error: 'Email not found in our records' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await getDb().collection('password_resets').insertOne({
      email, otp, createdAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    try {
      const html = `<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2>Password Reset Request</h2>
        <p>Hi ${user.username}, your reset OTP:</p>
        <div style="background:#f4f4f4;padding:20px;text-align:center;margin:20px 0;border-radius:5px">
          <h1 style="font-size:32px;letter-spacing:5px;color:#dc3545;margin:0">${otp}</h1>
        </div>
        <p>Expires in 15 minutes. Do not share.</p>
      </body></html>`;
      await sendBrevoEmail(email, user.username, 'Reset Your Password - Soulstash', html);
    } catch (emailErr) {
      await getDb().collection('password_resets').deleteOne({ email, otp });
      console.error('Password reset email failed:', emailErr.message || emailErr);
      return res.status(502).json({ error: 'Failed to send password reset email' });
    }

    res.json({ message: 'OTP sent to your email!' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const record = await getDb().collection('password_resets').findOne({ email, otp, expiresAt: { $gt: new Date() } });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const user = await getDb().collection('users').findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await getDb().collection('users').updateOne({ _id: user._id }, { $set: { password: hashed } });
    await getDb().collection('password_resets').deleteOne({ _id: record._id });

    res.json({ message: 'Password reset successfully!' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /api/auth/verify-otp-and-register
router.post('/verify-otp-and-register', async (req, res) => {
  try {
    const { email: rawEmail, username: rawUsername, password, otp, fullName: rawFullName } = req.body;
    const email = String(rawEmail || '').trim().toLowerCase();
    const username = String(rawUsername || '').trim();
    const normalizedFullName = String(rawFullName || '').trim();
    if (!email || !username || !password || !otp || !normalizedFullName)
      return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
    if (normalizedFullName.length < 2)
      return res.status(400).json({ error: 'Please enter your full name' });

    const otpData = otpStore.get(email);
    if (!otpData) return res.status(400).json({ error: 'OTP not found or expired' });
    if (new Date() > otpData.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: 'OTP has expired' });
    }
    if (otpData.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    if (otpData.email !== email || otpData.username !== username || otpData.fullName !== normalizedFullName)
      return res.status(400).json({ error: 'Invalid request data' });

    const users = getDb().collection('users');
    const existingUsername = await users.findOne({ username: { $regex: new RegExp(`^${escapedRegex(username)}$`, 'i') } });
    if (existingUsername) {
      otpStore.delete(email);
      return res.status(409).json({ error: 'Username is already taken' });
    }
    const existingEmail = await users.findOne({ email: { $regex: new RegExp(`^${escapedRegex(email)}$`, 'i') } });
    if (existingEmail) {
      otpStore.delete(email);
      return res.status(409).json({ error: 'Email is already registered' });
    }

    const nameParts = splitFullName(normalizedFullName);
    const hashed = await bcrypt.hash(password, 10);
    let result;
    try {
      result = await users.insertOne({
        username, email, password: hashed,
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        collections: defaultCollections(),
        admin: false,
        showAdult: false,
        collectionVersion: 1,
        createdAt: new Date(), updatedAt: new Date()
      });
    } catch (insertErr) {
      if (insertErr.code === 11000) {
        otpStore.delete(email);
        if (insertErr.keyPattern?.email || insertErr.keyValue?.email) {
          return res.status(409).json({ error: 'Email is already registered' });
        }
        return res.status(409).json({ error: 'Username is already taken' });
      }
      throw insertErr;
    }
    otpStore.delete(email);

    const token = jwt.sign({ userId: result.insertedId, username }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      message: 'Account created successfully!',
      token,
      user: { id: result.insertedId, username, email, fullName: nameParts.fullName, admin: false, showAdult: false }
    });
  } catch (err) {
    console.error('OTP register error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

module.exports = router;
