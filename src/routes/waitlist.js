const router = require('express').Router();
const db = require('../db');

// Dodaj na waitlist
router.post('/b/:slug', async (req, res, next) => {
  try {
    const { name, email, phone, serviceId, date, time } = req.body;
    if (!name || (!email && !phone) || !serviceId || !date || !time) {
      return res.status(400).json({ error: 'Sva polja su obavezna.' });
    }
    const business = await db.queryOne(
      `SELECT b.id FROM businesses b
       JOIN subscriptions s ON s.business_id = b.id
       WHERE b.slug = $1 AND s.status IN ('trialing', 'active')`,
      [req.params.slug]
    );
    if (!business) return res.status(404).json({ error: 'Salon nije pronađen.' });

    const entry = await db.queryOne(
      `INSERT INTO waitlist (business_id, service_id, date, time, name, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [business.id, serviceId, date, time, name, email || null, phone || null]
    );
    res.status(201).json({ message: 'Dodani ste na listu čekanja!', entry });
  } catch (err) { next(err); }
});

// Obavijesti waitlist kada termin otpadne
router.post('/notify/:businessId/:serviceId/:date/:time', async (req, res, next) => {
  try {
    const { businessId, serviceId, date, time } = req.params;
    const waiting = await db.queryAll(
      `SELECT * FROM waitlist 
       WHERE business_id = $1 AND service_id = $2 
       AND date = $3 AND time = $4`,
      [businessId, serviceId, date, time]
    );
    const { sendWaitlistNotification } = require('../services/notifications');
    for (const entry of waiting) {
      await sendWaitlistNotification(entry, req.params.slug);
    }
    res.json({ message: `${waiting.length} klijenata obavješteno.` });
  } catch (err) { next(err); }
});

module.exports = router;
