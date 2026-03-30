const router = require('express').Router();
const dayjs = require('dayjs');
const db = require('../db');

router.get('/b/:slug', async (req, res, next) => {
  try {
    const business = await db.queryOne(
      `SELECT b.id, b.name, b.type, b.slug, b.description,
              b.address, b.city, b.phone, b.logo_url, b.working_hours
       FROM businesses b
       JOIN subscriptions s ON s.business_id = b.id
       WHERE b.slug = $1 AND s.status IN ('trialing', 'active')`,
      [req.params.slug]
    );
    if (!business) return res.status(404).json({ error: 'Salon nije pronađen.' });
    const services = await db.queryAll(
      `SELECT id, name, description, price, duration, color
       FROM services WHERE business_id = $1 AND is_active = TRUE
       ORDER BY sort_order ASC, name ASC`,
      [business.id]
    );
    const staff = await db.queryAll(
      `SELECT id, name, color FROM staff WHERE business_id = $1 AND is_active = TRUE`,
      [business.id]
    );
    res.json({ business, services, staff });
  } catch (err) { next(err); }
});

router.get('/b/:slug/slots', async (req, res, next) => {
  try {
    const { date, serviceId } = req.query;
    if (!date || !serviceId) {
      return res.status(400).json({ error: 'Datum i usluga su obavezni.' });
    }
    const business = await db.queryOne(
      `SELECT b.id, b.working_hours, b.slot_duration
       FROM businesses b
       JOIN subscriptions s ON s.business_id = b.id
       WHERE b.slug = $1 AND s.status IN ('trialing', 'active')`,
      [req.params.slug]
    );
    if (!business) return res.status(404).json({ error: 'Salon nije pronađen.' });
    const service = await db.queryOne(
      'SELECT duration FROM services WHERE id = $1 AND business_id = $2 AND is_active = TRUE',
      [serviceId, business.id]
    );
    if (!service) return res.status(404).json({ error: 'Usluga nije pronađena.' });
    const dayMap = { 0:'sun', 1:'mon', 2:'tue', 3:'wed', 4:'thu', 5:'fri', 6:'sat' };
    const dayKey = dayMap[dayjs(date).day()];
    const hours = business.working_hours?.[dayKey];
    if (!hours) return res.json({ slots: [], closed: true });
    const slotDuration = business.slot_duration || 30;
    const start = dayjs(`${date} ${hours.from}`);
    const end = dayjs(`${date} ${hours.to}`);
    const allSlots = [];
    let cur = start;
    while (cur.add(service.duration, 'minute').isBefore(end) ||
           cur.add(service.duration, 'minute').isSame(end)) {
      allSlots.push(cur.format('HH:mm'));
      cur = cur.add(slotDuration, 'minute');
    }
    const taken = await db.queryAll(
      `SELECT starts_at, ends_at FROM appointments
       WHERE business_id = $1 AND DATE(starts_at) = $2
         AND status NOT IN ('cancelled','no_show')`,
      [business.id, date]
    );
    const freeSlots = allSlots.filter(slot => {
      const sStart = dayjs(`${date} ${slot}`);
      const sEnd = sStart.add(service.duration, 'minute');
      return !taken.some(t =>
        sStart.isBefore(dayjs(t.ends_at)) && sEnd.isAfter(dayjs(t.starts_at))
      );
    });
    res.json({ slots: freeSlots });
  } catch (err) { next(err); }
});

router.post('/b/:slug/book', async (req, res, next) => {
  try {
    const { name, phone, email, serviceId, startsAt } = req.body;
    if (!name || !phone || !serviceId || !startsAt) {
      return res.status(400).json({ error: 'Ime, telefon, usluga i termin su obavezni.' });
    }
    const business = await db.queryOne(
      `SELECT b.id FROM businesses b
       JOIN subscriptions s ON s.business_id = b.id
       WHERE b.slug = $1 AND s.status IN ('trialing', 'active')`,
      [req.params.slug]
    );
    if (!business) return res.status(404).json({ error: 'Salon nije pronađen.' });
    const service = await db.queryOne(
      'SELECT * FROM services WHERE id = $1 AND business_id = $2 AND is_active = TRUE',
      [serviceId, business.id]
    );
    if (!service) return res.status(404).json({ error: 'Usluga nije dostupna.' });
    const endsAt = dayjs(startsAt).add(service.duration, 'minute').toISOString();
    const conflict = await db.queryOne(
      `SELECT id FROM appointments
       WHERE business_id = $1 AND status NOT IN ('cancelled','no_show')
         AND starts_at < $2 AND ends_at > $3`,
      [business.id, endsAt, startsAt]
    );
    if (conflict) return res.status(409).json({ error: 'Termin je već zauzet.' });
    let clientRow = await db.queryOne(
      'SELECT id FROM clients WHERE business_id = $1 AND phone = $2',
      [business.id, phone]
    );
    if (!clientRow) {
      clientRow = await db.queryOne(
        'INSERT INTO clients (business_id, name, phone, email) VALUES ($1, $2, $3, $4) RETURNING id',
        [business.id, name, phone, email || null]
      );
    }
    const appointment = await db.queryOne(
      `INSERT INTO appointments
        (business_id, client_id, service_id, starts_at, ends_at, price, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'online')
       RETURNING id, starts_at, ends_at, status`,
      [business.id, clientRow.id, serviceId, startsAt, endsAt, service.price]
    );
    res.status(201).json({
      message: 'Termin je uspješno zakazan!',
      appointment: {
        id: appointment.id,
        service: service.name,
        starts_at: appointment.starts_at,
        price: service.price,
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;