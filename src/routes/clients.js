const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use(authenticate);

router.get('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const { search, sort = 'newest', limit = 50, offset = 0 } = req.query;
    let where = 'WHERE c.business_id = $1';
    const params = [req.params.businessId];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
    }
    const orderMap = {
      newest: 'c.created_at DESC',
      visits: 'visit_count DESC',
      spent:  'total_spent DESC',
      name:   'c.name ASC',
    };
    const clients = await db.queryAll(
      `SELECT c.*,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'completed') AS visit_count,
        COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'completed'), 0) AS total_spent,
        MAX(a.starts_at) AS last_visit
       FROM clients c
       LEFT JOIN appointments a ON a.client_id = c.id
       LEFT JOIN transactions t ON t.client_id = c.id
       ${where}
       GROUP BY c.id
       ORDER BY ${orderMap[sort] || orderMap.newest}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = await db.queryOne(
      `SELECT COUNT(*) FROM clients c ${where}`,
      params
    );
    res.json({ clients, total: parseInt(total.count) });
  } catch (err) { next(err); }
});

router.post('/:businessId', requireBusiness, [
  body('name').trim().notEmpty().withMessage('Ime je obavezno.'),
  body('phone').optional().isMobilePhone('any'),
  body('email').optional().isEmail(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, phone, email, birthday, notes, tags } = req.body;
    const client = await db.queryOne(
      `INSERT INTO clients (business_id, name, phone, email, birthday, notes, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.params.businessId, name, phone || null, email || null,
       birthday || null, notes || null, tags || []]
    );
    res.status(201).json({ client });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Klijent s tim brojem već postoji.' });
    next(err);
  }
});

router.patch('/:businessId/:id', requireBusiness, async (req, res, next) => {
  try {
    const { name, phone, email, birthday, notes, tags, is_vip } = req.body;
    const client = await db.queryOne(
      `UPDATE clients SET
        name     = COALESCE($1, name),
        phone    = COALESCE($2, phone),
        email    = COALESCE($3, email),
        birthday = COALESCE($4, birthday),
        notes    = COALESCE($5, notes),
        tags     = COALESCE($6, tags),
        is_vip   = COALESCE($7, is_vip)
       WHERE id = $8 AND business_id = $9
       RETURNING *`,
      [name, phone, email, birthday, notes, tags, is_vip,
       req.params.id, req.params.businessId]
    );
    if (!client) return res.status(404).json({ error: 'Klijent nije pronađen.' });
    res.json({ client });
  } catch (err) { next(err); }
});

router.get('/:businessId/:id/history', requireBusiness, async (req, res, next) => {
  try {
    const appointments = await db.queryAll(
      `SELECT a.*, s.name AS service_name, s.price AS service_price
       FROM appointments a
       LEFT JOIN services s ON s.id = a.service_id
       WHERE a.client_id = $1 AND a.business_id = $2
       ORDER BY a.starts_at DESC
       LIMIT 30`,
      [req.params.id, req.params.businessId]
    );
    const stats = await db.queryOne(
      `SELECT
        COUNT(CASE WHEN status='completed' THEN 1 END) AS total_visits,
        COALESCE(SUM(t.amount) FILTER (WHERE t.status='completed'), 0) AS total_spent,
        MAX(a.starts_at) AS last_visit,
        MIN(a.starts_at) AS first_visit
       FROM appointments a
       LEFT JOIN transactions t ON t.appointment_id = a.id
       WHERE a.client_id = $1 AND a.business_id = $2`,
      [req.params.id, req.params.businessId]
    );
    res.json({ appointments, stats });
  } catch (err) { next(err); }
});
// Blokiraj / odblokiraj klijenta
router.patch('/:businessId/:id/block', requireBusiness, async (req, res, next) => {
  try {
    const { is_blocked } = req.body;
    const client = await db.queryOne(
      `UPDATE clients SET is_blocked = $1
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [is_blocked, req.params.id, req.params.businessId]
    );
    if (!client) return res.status(404).json({ error: 'Klijent nije pronađen.' });
    res.json({ client });
  } catch (err) { next(err); }
});
module.exports = router;
