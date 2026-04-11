const router = require('express').Router();
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

// Javna ruta — ostavi recenziju putem tokena
router.get('/token/:token', async (req, res, next) => {
  try {
    const review = await db.queryOne(
      `SELECT r.*, b.name AS business_name 
       FROM reviews r
       JOIN businesses b ON b.id = r.business_id
       WHERE r.review_token = $1`,
      [req.params.token]
    );
    if (!review) return res.status(404).json({ error: 'Recenzija nije pronađena.' });
    res.json({ review });
  } catch (err) { next(err); }
});

router.post('/token/:token', async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Ocjena mora biti između 1 i 5.' });
    }
    const review = await db.queryOne(
      `UPDATE reviews SET rating = $1, comment = $2
       WHERE review_token = $3 AND rating IS NULL
       RETURNING *`,
      [rating, comment || null, req.params.token]
    );
    if (!review) return res.status(400).json({ error: 'Recenzija je već ostavljena ili nije pronađena.' });
    res.json({ message: 'Hvala na recenziji!', review });
  } catch (err) { next(err); }
});

// Javna ruta — dohvati recenzije za salon
router.get('/business/:slug', async (req, res, next) => {
  try {
    const business = await db.queryOne(
      'SELECT id FROM businesses WHERE slug = $1',
      [req.params.slug]
    );
    if (!business) return res.status(404).json({ error: 'Salon nije pronađen.' });
    const reviews = await db.queryAll(
      `SELECT client_name, rating, comment, created_at
       FROM reviews
       WHERE business_id = $1 AND rating IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
      [business.id]
    );
    const avg = await db.queryOne(
      `SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS total
       FROM reviews WHERE business_id = $1 AND rating IS NOT NULL`,
      [business.id]
    );
    res.json({ reviews, avg_rating: avg.avg_rating, total: avg.total });
  } catch (err) { next(err); }
});

module.exports = router;
