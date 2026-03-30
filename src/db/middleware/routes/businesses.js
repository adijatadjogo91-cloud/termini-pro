const router = require('express').Router();
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authenticate, async (req, res, next) => {
  try {
    const businesses = await db.queryAll(
      `SELECT b.*, s.plan, s.status AS sub_status,
              s.trial_ends_at, s.ai_queries_used, s.ai_queries_limit
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       WHERE b.owner_id = $1
       ORDER BY b.created_at ASC`,
      [req.user.id]
    );
    res.json({ businesses });
  } catch (err) { next(err); }
});

router.get('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    res.json({ business: req.business });
  } catch (err) { next(err); }
});

router.patch('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const { name, type, address, city, phone, email, description, working_hours, slot_duration } = req.body;
    const business = await db.queryOne(
      `UPDATE businesses SET
        name          = COALESCE($1, name),
        type          = COALESCE($2, type),
        address       = COALESCE($3, address),
        city          = COALESCE($4, city),
        phone         = COALESCE($5, phone),
        email         = COALESCE($6, email),
        description   = COALESCE($7, description),
        working_hours = COALESCE($8, working_hours),
        slot_duration = COALESCE($9, slot_duration)
       WHERE id = $10 AND owner_id = $11
       RETURNING *`,
      [name, type, address, city, phone, email, description,
       working_hours ? JSON.stringify(working_hours) : null,
       slot_duration, req.params.businessId, req.user.id]
    );
    res.json({ business });
  } catch (err) { next(err); }
});

router.get('/:businessId/dashboard', requireBusiness, async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [todayStats, monthStats, weekChart, topServices, recentApts] = await Promise.all([
      db.queryOne(
        `SELECT COUNT(a.id) AS appointments,
                COALESCE(SUM(t.amount), 0) AS revenue
         FROM appointments a
         LEFT JOIN transactions t ON t.appointment_id = a.id AND t.status = 'completed'
         WHERE a.business_id = $1 AND DATE(a.starts_at) = $2
           AND a.status NOT IN ('cancelled','no_show')`,
        [req.params.businessId, today]
      ),
      db.queryOne(
        `SELECT COUNT(a.id) AS appointments,
                COALESCE(SUM(t.amount), 0) AS revenue
         FROM appointments a
         LEFT JOIN transactions t ON t.appointment_id = a.id AND t.status = 'completed'
         WHERE a.business_id = $1
           AND date_trunc('month', a.starts_at) = date_trunc('month', NOW())
           AND a.status NOT IN ('cancelled','no_show')`,
        [req.params.businessId]
      ),
      db.queryAll(
        `SELECT DATE(starts_at) AS date, COUNT(*) AS count
         FROM appointments
         WHERE business_id = $1
           AND starts_at >= NOW() - INTERVAL '7 days'
           AND status NOT IN ('cancelled','no_show')
         GROUP BY DATE(starts_at)
         ORDER BY date ASC`,
        [req.params.businessId]
      ),
      db.queryAll(
        `SELECT s.name, s.price, COUNT(a.id) AS count
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         WHERE a.business_id = $1
           AND a.status NOT IN ('cancelled','no_show')
           AND a.starts_at >= NOW() - INTERVAL '30 days'
         GROUP BY s.id, s.name, s.price
         ORDER BY count DESC LIMIT 5`,
        [req.params.businessId]
      ),
      db.queryAll(
        `SELECT a.*, c.name AS client_name, c.phone AS client_phone,
                s.name AS service_name, st.name AS staff_name
         FROM appointments a
         LEFT JOIN clients  c  ON c.id  = a.client_id
         LEFT JOIN services s  ON s.id  = a.service_id
         LEFT JOIN staff    st ON st.id = a.staff_id
         WHERE a.business_id = $1 AND DATE(a.starts_at) = $2
         ORDER BY a.starts_at ASC`,
        [req.params.businessId, today]
      ),
    ]);
    const totalClients = await db.queryOne(
      'SELECT COUNT(*) FROM clients WHERE business_id = $1',
      [req.params.businessId]
    );
    res.json({
      today: todayStats,
      month: monthStats,
      week_chart: weekChart,
      top_services: topServices,
      appointments: recentApts,
      total_clients: parseInt(totalClients.count),
    });
  } catch (err) { next(err); }
});

module.exports = router;