const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { authenticate, requireBusiness, requirePlan, checkAIQuota } = require('../middleware/auth');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Javna ruta za booking chatbot (bez autentifikacije) - mora biti PRIJE authenticate
router.post('/public/chat', async (req, res, next) => {
  try {
    const { message, history = [], salonInfo, usluge } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Poruka je obavezna.' });

    const uslugeText = usluge?.map(u => `- ${u.name}: ${u.price} KM, trajanje ${u.duration} min`).join('\n') || 'Nema podataka';

    const systemPrompt = `Ti si AI asistent za ${salonInfo?.name}. Odgovaraj kratko i prijateljski na bosanskom jeziku.

Informacije:
- Naziv: ${salonInfo?.name}
- Adresa: ${salonInfo?.address || 'nije navedeno'}, ${salonInfo?.city || ''}
- Telefon: ${salonInfo?.phone || 'nije naveden'}
- Opis: ${salonInfo?.description || 'nije naveden'}

Usluge:
${uslugeText}

Pomozi klijentu da odabere uslugu i zakaže termin. Ako pita za termin, reci mu da odabere uslugu na stranici.`;

    const messages = [
      ...history.slice(-10),
      { role: 'user', content: message }
    ];

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });

    const reply = response.content[0]?.text || 'Žao mi je, pokušajte ponovo.';
    res.json({ reply });
  } catch (err) { next(err); }
});

router.use(authenticate);

router.post('/:businessId/chat', requireBusiness, checkAIQuota, async (req, res, next) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Poruka je obavezna.' });

    const stats = await db.queryOne(
      `SELECT
        COUNT(DISTINCT c.id) AS total_clients,
        COUNT(DISTINCT a.id) FILTER (WHERE a.starts_at >= NOW() - INTERVAL '30 days') AS appointments_last_30d,
        COALESCE(SUM(t.amount) FILTER (WHERE t.created_at >= date_trunc('month', NOW())), 0) AS revenue_this_month
       FROM businesses b
       LEFT JOIN clients c ON c.business_id = b.id
       LEFT JOIN appointments a ON a.business_id = b.id AND a.status NOT IN ('cancelled','no_show')
       LEFT JOIN transactions t ON t.business_id = b.id AND t.status = 'completed'
       WHERE b.id = $1`,
      [req.params.businessId]
    );

    const topServices = await db.queryAll(
      `SELECT s.name, s.price, COUNT(a.id) AS booking_count
       FROM services s
       LEFT JOIN appointments a ON a.service_id = s.id
         AND a.status NOT IN ('cancelled','no_show')
         AND a.starts_at >= NOW() - INTERVAL '30 days'
       WHERE s.business_id = $1 AND s.is_active = TRUE
       GROUP BY s.id, s.name, s.price
       ORDER BY booking_count DESC LIMIT 5`,
      [req.params.businessId]
    );

    const systemPrompt = `Ti si AI asistent za ${salonInfo?.name}. 

Pravila odgovaranja:
- Odgovaraj kratko i profesionalno na bosanskom jeziku
- Bez emojija osim ako klijent koristi emoji
- Bez bold teksta (**tekst**)
- Jednostavne rečenice, bez lista sa crticama
- Maksimalno 3-4 rečenice po odgovoru
- Ako pitaju za termin, uputi ih da odaberu uslugu na stranici

Informacije:
- Naziv: ${salonInfo?.name}
- Adresa: ${salonInfo?.address || 'nije navedeno'}, ${salonInfo?.city || ''}
- Telefon: ${salonInfo?.phone || 'nije naveden'}

Usluge:
${uslugeText}`;

    const messages = [
      ...history.slice(-10),
      { role: 'user', content: message }
    ];

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages,
    });

    const reply = response.content[0]?.text || 'Žao mi je, ne mogu odgovoriti trenutno.';

    await db.query(
      'UPDATE subscriptions SET ai_queries_used = ai_queries_used + 1 WHERE business_id = $1',
      [req.params.businessId]
    );

    res.json({ reply });
 } catch (err) { 
    console.error('[AI PUBLIC CHAT]', err.message);
    next(err); 
  }
});
module.exports = router;
