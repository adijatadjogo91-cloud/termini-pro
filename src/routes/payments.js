const router = require('express').Router();
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use(authenticate);

router.get('/:businessId/transactions', requireBusiness, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const transactions = await db.queryAll(
      `SELECT t.*, c.name AS client_name, a.starts_at AS appointment_time
       FROM transactions t
       LEFT JOIN clients      c ON c.id = t.client_id
       LEFT JOIN appointments a ON a.id = t.appointment_id
       WHERE t.business_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.businessId, limit, offset]
    );
    const summary = await db.queryOne(
      `SELECT
        COALESCE(SUM(CASE WHEN status='completed' THEN amount END), 0) AS total,
        COUNT(CASE WHEN status='completed' THEN 1 END) AS count_paid,
        COUNT(CASE WHEN status='refunded'  THEN 1 END) AS count_refunded
       FROM transactions
       WHERE business_id = $1`,
      [req.params.businessId]
    );
    res.json({ transactions, summary });
  } catch (err) { next(err); }
});

router.post('/:businessId/charge', requireBusiness, async (req, res, next) => {
  try {
    const { amount, method, appointmentId, clientId, notes } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Iznos mora biti veći od 0.' });
    }
    const transaction = await db.queryOne(
      `INSERT INTO transactions
        (business_id, appointment_id, client_id, amount, method, status, notes)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6)
       RETURNING *`,
      [req.params.businessId, appointmentId || null, clientId || null,
       amount, method || 'cash', notes || null]
    );
    if (appointmentId) {
      await db.query(
        `UPDATE appointments SET status = 'completed' WHERE id = $1 AND business_id = $2`,
        [appointmentId, req.params.businessId]
      );
    }
    res.status(201).json({ transaction });
  } catch (err) { next(err); }
});

router.get('/:businessId/stats', requireBusiness, async (req, res, next) => {
  try {
    const stats = await db.queryAll(
      `SELECT
        DATE(created_at) AS date,
        SUM(amount) AS revenue,
        COUNT(*) AS transactions
       FROM transactions
       WHERE business_id = $1
         AND status = 'completed'
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [req.params.businessId]
    );
    res.json({ daily: stats });
  } catch (err) { next(err); }
});

module.exports = router;