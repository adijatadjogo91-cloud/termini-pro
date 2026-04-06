const db = require('../db');
const twilio = require('twilio');

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

async function posaljiSMS(telefon, poruka) {
  if (!client || !FROM_NUMBER) {
    console.log(`[SMS - TEST] ${telefon}: ${poruka}`);
    return;
  }
  try {
    await client.messages.create({
      body: poruka,
      from: FROM_NUMBER,
      to: telefon
    });
    console.log(`[SMS] Poslano na ${telefon}`);
  } catch (err) {
    console.error(`[SMS] Greška: ${err.message}`);
  }
}

async function sendConfirmationSMS(client, appointment, service) {
  if (!client?.phone) return;
  const vrijeme = new Date(appointment.starts_at).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
  const datum = new Date(appointment.starts_at).toLocaleDateString('hr-HR', { day: 'numeric', month: 'long' });
  const poruka = `Potvrda termina: ${service.name} u ${client.business_name} — ${datum} u ${vrijeme}. Za otkazivanje nas kontaktirajte.`;
  await posaljiSMS(client.phone, poruka);
}

async function sendDailyReminders() {
  console.log('[CRON] Provjera podsjetnika...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().split('T')[0];
  const appointments = await db.queryAll(
    `SELECT a.id, a.starts_at, c.name AS client_name, c.phone AS client_phone,
            s.name AS service_name, b.name AS business_name, b.phone AS business_phone
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
    const vrijeme = new Date(appt.starts_at).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
    const poruka = `Podsjetnik: Vaš termin u ${appt.business_name} je sutra u ${vrijeme} (${appt.service_name}). Za otkazivanje pozovite ${appt.business_phone || 'salon'}.`;
    await posaljiSMS(appt.client_phone, poruka);
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
