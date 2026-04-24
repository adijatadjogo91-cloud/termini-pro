const router = require('express').Router();
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use(authenticate);

router.get('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const services = await db.queryAll(
      `SELECT s.*,
        COUNT(a.id) FILTER (WHERE a.status NOT IN ('cancelled','no_show')) AS booking_count
       FROM services s
       LEFT JOIN appointments a ON a.service_id = s.id
         AND a.starts_at >= NOW() - INTERVAL '30 days'
       WHERE s.business_id = $1
       GROUP BY s.id
       ORDER BY s.sort_order ASC, s.name ASC`,
      [req.params.businessId]
    );
    res.json({ services });
  } catch (err) { next(err); }
});

router.post('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const { name, description, price, duration, color, break_after, break_duration } = req.body;
    if (!name || !price || !duration) {
      return res.status(400).json({ error: 'Naziv, cijena i trajanje su obavezni.' });
    }
    const service = await db.queryOne(
      `INSERT INTO services (business_id, name, description, price, duration, color, break_after, break_duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.businessId, name, description || null,
       price, duration, color || '#4a7c59', break_after || null, break_duration || null]
    );
    res.status(201).json({ service });
  } catch (err) { next(err); }
});

router.patch('/:businessId/:id', requireBusiness, async (req, res, next) => {
  try {
   const { name, description, price, duration, color, is_active, break_after, break_duration } = req.body;
    const service = await db.queryOne(
      `UPDATE services SET
        name          = COALESCE($1, name),
        description   = COALESCE($2, description),
        price         = COALESCE($3, price),
        duration      = COALESCE($4, duration),
        color         = COALESCE($5, color),
        is_active     = COALESCE($6, is_active),
        break_after   = $7,
        break_duration = $8
       WHERE id = $9 AND business_id = $10 RETURNING *`,
      [name, description, price, duration, color, is_active,
       break_after || null, break_duration || null,
       req.params.id, req.params.businessId]
    );
    if (!service) return res.status(404).json({ error: 'Usluga nije pronađena.' });
    res.json({ service });
  } catch (err) { next(err); }
});

router.delete('/:businessId/:id', requireBusiness, async (req, res, next) => {
  try {
    await db.query(
      'UPDATE services SET is_active = FALSE WHERE id = $1 AND business_id = $2',
      [req.params.id, req.params.businessId]
    );
    res.json({ message: 'Usluga je deaktivirana.' });
  } catch (err) { next(err); }
});

module.exports = router;
