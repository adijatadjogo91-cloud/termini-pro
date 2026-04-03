const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const generateTokens = (userId) => {
  const access = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const refresh = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { access, refresh };
};

router.post('/register', [
  body('name').trim().notEmpty().withMessage('Ime je obavezno.'),
  body('email').isEmail().normalizeEmail().withMessage('Neispravna email adresa.'),
  body('password').isLength({ min: 8 }).withMessage('Lozinka mora imati najmanje 8 karaktera.'),
  body('businessName').trim().notEmpty().withMessage('Naziv biznisa je obavezan.'),
  body('businessType').notEmpty().withMessage('Tip biznisa je obavezan.'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, email, password, businessName, businessType, phone } = req.body;
    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ error: 'Email je već registrovan.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const slug = businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 50) + '-' + Math.random().toString(36).substring(2, 6);
    const result = await db.transaction(async (client) => {
      const user = await client.query(
        `INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id, name, email`,
        [name, email, passwordHash, phone]
      );
      const business = await client.query(
        `INSERT INTO businesses (owner_id, name, type, slug) VALUES ($1, $2, $3, $4) RETURNING id, name, slug`,
        [user.rows[0].id, businessName, businessType, slug]
      );
      await client.query(
        `INSERT INTO subscriptions (business_id, plan, status) VALUES ($1, 'starter', 'trialing')`,
        [business.rows[0].id]
      );
     await client.query(
        `INSERT INTO subscriptions (business_id, plan, status, trial_ends_at) VALUES ($1, 'starter', 'trialing', NOW() + INTERVAL '14 days')`,
        [business.rows[0].id]
      );
      return { user: user.rows[0], business: business.rows[0] };
    });
    const { access, refresh } = generateTokens(result.user.id);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [result.user.id, refresh]
    );
    res.status(201).json({
      user: result.user,
      business: result.business,
      access_token: access,
      refresh_token: refresh,
    });
  } catch (err) { next(err); }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Neispravni podaci.' });
    const { email, password } = req.body;
    const user = await db.queryOne(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Pogrešan email ili lozinka.' });
    }
    const businesses = await db.queryAll(
      `SELECT b.id, b.name, b.slug, b.type, s.plan, s.status AS sub_status
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       WHERE b.owner_id = $1`,
      [user.id]
    );
    const { access, refresh } = generateTokens(user.id);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refresh]
    );
    const { password_hash, ...userSafe } = user;
    res.json({ user: userSafe, businesses, access_token: access, refresh_token: refresh });
  } catch (err) { next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'Nedostaje refresh token.' });
    const payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    const stored = await db.queryOne(
      'SELECT id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refresh_token]
    );
    if (!stored) return res.status(401).json({ error: 'Refresh token je nevažeći ili istekao.' });
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    const { access, refresh } = generateTokens(payload.userId);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [payload.userId, refresh]
    );
    res.json({ access_token: access, refresh_token: refresh });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Nevažeći token.' });
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    }
    res.json({ message: 'Uspješno ste se odjavili.' });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;