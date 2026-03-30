require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
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

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Interna greška servera.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const { sendDailyReminders, sendReactivationMessages } = require('./services/notifications');

cron.schedule('0 9 * * *', () => {
  console.log('[CRON] Slanje dnevnih podsjetnika...');
  sendDailyReminders();
});

cron.schedule('0 10 * * 1', () => {
  console.log('[CRON] Sedmična reaktivacija neaktivnih klijenata...');
  sendReactivationMessages();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Termini.pro server pokrenut na portu ${PORT}`);
  console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;