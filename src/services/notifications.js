const db = require('../db');

async function sendConfirmationSMS(client, appointment, service) {
  console.log(`[SMS] Potvrda za ${client.name} — ${service.name}`);
}

async function sendDailyReminders() {
  console.log('[CRON] Provjera podsjetnika...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().split('T')[0];

  const appointments = await db.queryAll(
    `SELECT a.id, a.starts_at, c.name AS client_name, c.phone AS client_phone,
            s.name AS service_name, b.name AS business_name
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     JOIN services s ON s.id = a.service_id
     JOIN businesses b ON b.id = a.business_id
     WHERE DATE(a.starts_at) = $1
       AND a.status = 'confirmed'
       AND a.reminder_sent = FALSE
       AND c.phone IS NOT NULL`,
    [date]
  );

  console.log(`[CRON] ${appointments.length} podsjetnika za sutra.`);

  for (const appt of appointments) {
    console.log(`[SMS] Podsjetnik za ${appt.client_name} — ${appt.service_name}`);
    await db.query(
      'UPDATE appointments SET reminder_sent = TRUE WHERE id = $1',
      [appt.id]
    );
  }
}

async function sendReactivationMessages() {
  console.log('[CRON] Provjera neaktivnih klijenata...');
}

module.exports = {
  sendConfirmationSMS,
  sendDailyReminders,
  sendReactivationMessages
};