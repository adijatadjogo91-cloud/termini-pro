const router = require('express').Router();
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use(authenticate);

// Dohvati sve akcije
router.get('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const promotions = await db.queryAll(
      `SELECT p.*, s.name AS service_name
       FROM promotions p
       LEFT JOIN services s ON s.id = p.service_id
       WHERE p.business_id = $1
       ORDER BY p.created_at DESC`,
      [req.params.businessId]
    );
    res.json({ promotions });
  } catch (err) { next(err); }
});

// Kreiraj akciju
router.post('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const { title, description, service_id, discount_percent, discount_amount, valid_from, valid_to } = req.body;
    if (!title || !valid_from || !valid_to) {
      return res.status(400).json({ error: 'Naziv, datum početka i kraja su obavezni.' });
    }
    if (!discount_percent && !discount_amount) {
      return res.status(400).json({ error: 'Unesite popust u % ili KM.' });
    }
    const promotion = await db.queryOne(
      `INSERT INTO promotions (business_id, service_id, title, description, discount_percent, discount_amount, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.businessId, service_id || null, title, description || null,
       discount_percent || null, discount_amount || null, valid_from, valid_to]
    );
    res.status(201).json({ promotion });
  } catch (err) { next(err); }
});

// Aktiviraj/deaktiviraj akciju
router.patch('/:businessId/:id', requireBusiness, async (req, res, next) => {
  try {
    const { is_active } = req.body;
    const promotion = await db.queryOne(
      `UPDATE promotions SET is_active = $1 WHERE id = $2 AND business_id = $3 RETURNING *`,
      [is_active, req.params.id, req.params.businessId]
    );
    if (!promotion) return res.status(404).json({ error: 'Akcija nije pronađena.' });
    res.json({ promotion });
  } catch (err) { next(err); }
});

// Obriši akciju
router.delete('/:businessId/:id', requireBusiness, async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM promotions WHERE id = $1 AND business_id = $2',
      [req.params.id, req.params.businessId]
    );
    res.json({ message: 'Akcija obrisana.' });
  } catch (err) { next(err); }
});

module.exports = router;
