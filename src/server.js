require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const db = require('./db');
 
const app = express();
 
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://termini.pro',
    'https://www.termini.pro',
    'https://cozy-kulfi-a439e1.netlify.app',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
}));
 
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
 
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Previše pokušaja prijave.' });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Previše AI upita.' });
 
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);
app.use('/api/ai/', aiLimiter);
 
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/businesses',   require('./routes/businesses'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/clients',      require('./routes/clients'));
app.use('/api/services',     require('./routes/services'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/ai',           require('./routes/ai'));
app.use('/api/webhooks',     require('./routes/webhooks'));
app.use('/api/public',       require('./routes/public'));
app.use('/api/gallery',      require('./routes/gallery'));
app.use('/api/reviews',      require('./routes/reviews'));
app.use('/api/waitlist',     require('./routes/waitlist'));
app.get('/test-email', async (req, res) => {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: 'termini.pro <podsjetnici@termini.pro>',
      to: 'adijatadjogo91@gmail.com',
      subject: 'Test email — termini.pro',
      html: '<h2 style="color:#1a7a4a">termini.pro</h2><p>Email podsjetnici rade! 🎉</p>'
    });
    res.json({ status: 'Email poslan!' });
  } catch (err) {
    res.json({ error: err.message });
  }
});
 
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
 
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Interna greška servera.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});
 
const { sendDailyReminders, sendReactivationMessages, sendReviewRequest } = require('./services/notifications');
 
async function sendReviewRequests() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split('T')[0];
  try {
    const appointments = await db.queryAll(
      `SELECT a.id, a.starts_at, r.review_token,
              c.name AS client_name, c.email AS client_email,
              b.name AS business_name
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       JOIN businesses b ON b.id = a.business_id
       LEFT JOIN reviews r ON r.appointment_id = a.id
       WHERE DATE(a.starts_at) = $1
         AND a.status = 'confirmed'
         AND c.email IS NOT NULL
         AND r.id IS NOT NULL
         AND r.rating IS NULL`,
      [date]
    );
    console.log(`[CRON] ${appointments.length} zahtjeva za recenzije.`);
    for (const appt of appointments) {
      await sendReviewRequest(appt);
    }
  } catch (err) {
    console.error('[CRON] Greška pri slanju recenzija:', err.message);
  }
}
 
cron.schedule('0 9 * * *', () => {
  console.log('[CRON] Slanje dnevnih podsjetnika...');
  sendDailyReminders();
});
 
cron.schedule('0 10 * * 1', () => {
  console.log('[CRON] Sedmična reaktivacija neaktivnih klijenata...');
  sendReactivationMessages();
});
 
cron.schedule('0 11 * * *', () => {
  console.log('[CRON] Slanje zahtjeva za recenzije...');
  sendReviewRequests();
});
 
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Termini.pro server pokrenut na portu ${PORT}`);
  console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
});
 
module.exports = app;
