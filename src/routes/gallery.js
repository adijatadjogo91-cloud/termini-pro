const router = require('express').Router();
const db = require('../db');
const { authenticate, requireBusiness } = require('../middleware/auth');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

router.use(authenticate);

// Dohvati galeriju
router.get('/:businessId', requireBusiness, async (req, res, next) => {
  try {
    const slike = await db.queryAll(
      `SELECT * FROM gallery WHERE business_id = $1 ORDER BY sort_order ASC, created_at DESC`,
      [req.params.businessId]
    );
    res.json({ gallery: slike });
  } catch (err) { next(err); }
});

// Upload slike
router.post('/:businessId', requireBusiness, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Slika je obavezna.' });
    
    const fileName = `${req.params.businessId}/${Date.now()}-${req.file.originalname}`;
    
    const { error } = await supabase.storage
      .from('gallery')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    
    if (error) return res.status(500).json({ error: 'Greška pri uploadu slike.' });
    
    const { data: urlData } = supabase.storage
      .from('gallery')
      .getPublicUrl(fileName);
    
    const slika = await db.queryOne(
      `INSERT INTO gallery (business_id, image_url, caption)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.businessId, urlData.publicUrl, req.body.caption || null]
    );
    
    res.status(201).json({ image: slika });
  } catch (err) { next(err); }
});

// Obriši sliku
router.delete('/:businessId/:imageId', requireBusiness, async (req, res, next) => {
  try {
    const slika = await db.queryOne(
      'SELECT * FROM gallery WHERE id = $1 AND business_id = $2',
      [req.params.imageId, req.params.businessId]
    );
    if (!slika) return res.status(404).json({ error: 'Slika nije pronađena.' });
    
    // Obriši iz Supabase Storage
    const fileName = slika.image_url.split('/gallery/')[1];
    await supabase.storage.from('gallery').remove([fileName]);
    
    // Obriši iz baze
    await db.query('DELETE FROM gallery WHERE id = $1', [req.params.imageId]);
    
    res.json({ message: 'Slika obrisana.' });
  } catch (err) { next(err); }
});

module.exports = router;
