const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const dayjs = require('dayjs');
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use((req, res, next) => {
  if (req.path.startsWith('/cancel/')) return next();
  authenticate(req, res, next);
});

router.get('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const { from, to, status } = req.query;
    const dateFrom = from ? dayjs(from).toISOString() : dayjs().startOf('day').toISOString();
    const dateTo = to ? dayjs(to).endOf('day').toISOString() : dayjs().endOf('day').toISOString();
    let whereClause = 'WHERE a.business_id = $1 AND a.starts_at >= $2 AND a.starts_at <= $3';
    const params = [req.params.businessId, dateFrom, dateTo];
    if (status) {
      params.push(status);
      whereClause += ` AND a.status = $${params.length}`;
    }
    const appointments = await db.queryAll(
      `SELECT a.*,
        c.name AS client_name, c.phone AS client_phone,
        s.name AS service_name, s.color AS service_color,
        st.name AS staff_name
       FROM appointments a
       LEFT JOIN clients  c  ON c.id  = a.client_id
       LEFT JOIN services s  ON s.id  = a.service_id
       LEFT JOIN staff    st ON st.id = a.staff_id
       ${whereClause}
       ORDER BY a.starts_at ASC`,
      params
    );
    res.json({ appointments });
  } catch (err) { next(err); }
});

router.get('/:businessId/availability', requireBusiness, async (req, res, next) => {
  try {
    const { date, serviceId } = req.query;
    if (!date || !serviceId) {
      return res.status(400).json({ error: 'Datum i usluga su obavezni.' });
    }
    const service = await db.queryOne(
      'SELECT duration FROM services WHERE id = $1 AND business_id = $2',
      [serviceId, req.params.businessId]
    );
    if (!service) return res.status(404).json({ error: 'Usluga ne postoji.' });
    const business = req.business;
    const dayOfWeek = dayjs(date).format('ddd').toLowerCase();
    const hours = business.working_hours?.[dayOfWeek];
    if (!hours) return res.json({ slots: [], message: 'Ne radimo taj dan.' });
    const slotDuration = business.slot_duration || 30;
    const startTime = dayjs(`${date} ${hours.from}`);
    const endTime = dayjs(`${date} ${hours.to}`);
    const allSlots = [];
    let current = startTime;
    while (current.add(service.duration, 'minute').isBefore(endTime) ||
           current.add(service.duration, 'minute').isSame(endTime)) {
      allSlots.push(current.format('HH:mm'));
      current = current.add(slotDuration, 'minute');
    }
    const takenSlots = await db.queryAll(
      `SELECT starts_at, ends_at FROM appointments
       WHERE business_id = $1
         AND DATE(starts_at) = $2
         AND status NOT IN ('cancelled', 'no_show')`,
      [req.params.businessId, date]
    );
    const freeSlots = allSlots.filter(slot => {
      const slotStart = dayjs(`${date} ${slot}`);
      const slotEnd = slotStart.add(service.duration, 'minute');
      return !takenSlots.some(taken => {
        const tStart = dayjs(taken.starts_at);
        const tEnd = dayjs(taken.ends_at);
        return slotStart.isBefore(tEnd) && slotEnd.isAfter(tStart);
      });
    });
    res.json({ slots: freeSlots, date, service_duration: service.duration });
  } catch (err) { next(err); }
});

router.post('/:businessId', requireBusiness, [
  body('serviceId').isUUID().withMessage('Usluga je obavezna.'),
  body('startsAt').isISO8601().withMessage('Datum i vrijeme su obavezni.'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { clientId, serviceId, staffId, startsAt, price, notes, source } = req.body;
    const service = await db.queryOne(
      'SELECT * FROM services WHERE id = $1 AND business_id = $2 AND is_active = TRUE',
      [serviceId, req.params.businessId]
    );
    if (!service) return res.status(404).json({ error: 'Usluga nije pronađena.' });
    const endsAt = dayjs(startsAt).add(service.duration, 'minute').toISOString();
    const appointment = await db.queryOne(
      `INSERT INTO appointments
        (business_id, client_id, service_id, staff_id, starts_at, ends_at, price, notes, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed')
       RETURNING *`,
      [req.params.businessId, clientId || null, serviceId, staffId || null,
       startsAt, endsAt, price || service.price, notes || null, source || 'manual']
    );
    res.status(201).json({ appointment });
  } catch (err) { next(err); }
});

router.patch('/:businessId/:id/status', requireBusiness, async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Nevažeći status.' });
    }
    const appointment = await db.queryOne(
      `UPDATE appointments SET status = $1 WHERE id = $2 AND business_id = $3 RETURNING *`,
      [status, req.params.id, req.params.businessId]
    );
    if (!appointment) return res.status(404).json({ error: 'Termin nije pronađen.' });
    res.json({ appointment });
  } catch (err) { next(err); }
});

router.delete('/:businessId/:id', requireBusiness, async (req, res, next) => {
  try {
    await db.query(
      `UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.params.businessId]
    );
    res.json({ message: 'Termin je otkazan.' });
  } catch (err) { next(err); }
});
// Otkazivanje putem tokena (za klijente)
router.get('/cancel/:token', async (req, res, next) => {
  try {
    const appointment = await db.queryOne(
      `SELECT a.*, b.name AS business_name, b.email AS business_email,
              c.name AS client_name, s.name AS service_name
       FROM appointments a
       JOIN businesses b ON b.id = a.business_id
       JOIN clients c ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       WHERE a.cancel_token = $1`,
      [req.params.token]
    );
    if (!appointment) return res.status(404).json({ error: 'Termin nije pronađen.' });
    if (appointment.status === 'cancelled') return res.status(400).json({ error: 'Termin je već otkazan.' });
    res.json({ appointment });
  } catch (err) { next(err); }
});

router.post('/cancel/:token', async (req, res, next) => {
  try {
    const appointment = await db.queryOne(
      `UPDATE appointments SET status = 'cancelled'
       WHERE cancel_token = $1 AND status NOT IN ('cancelled', 'completed')
       RETURNING *`,
      [req.params.token]
    );
    if (!appointment) return res.status(404).json({ error: 'Termin nije pronađen ili je već otkazan.' });

    // Obavijest salonu
    const full = await db.queryOne(
      `SELECT a.starts_at, b.name AS business_name, b.email AS business_email,
              c.name AS client_name, s.name AS service_name
       FROM appointments a
       JOIN businesses b ON b.id = a.business_id
       JOIN clients c ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       WHERE a.id = $1`,
      [appointment.id]
    );
    if (full?.business_email) {
      const { posaljiEmail } = require('../services/notifications');
      const datum = new Date(full.starts_at).toLocaleDateString('hr-HR', { day: 'numeric', month: 'long' });
      const vrijeme = new Date(full.starts_at).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
      // koristimo direktno resend
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'termini.pro <podsjetnici@termini.pro>',
        to: full.business_email,
        subject: `Otkazan termin — ${full.client_name} — ${datum}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #e24b4a;">termini.pro — Otkazan termin</h2>
            <p>Klijent je otkazao termin:</p>
            <p>👤 <strong>${full.client_name}</strong></p>
            <p>📋 <strong>${full.service_name}</strong></p>
            <p>📅 <strong>${datum} u ${vrijeme}</strong></p>
          </div>
        `
      });
    }
    res.json({ message: 'Termin je uspješno otkazan.' });
  } catch (err) { next(err); }
});
module.exports = router;
