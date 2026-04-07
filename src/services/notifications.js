const db = require('../db');
const twilio = require('twilio');
const { Resend } = require('resend');

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// ─── SMS ───────────────────────────────────────────────
async function posaljiSMS(telefon, poruka) {
  if (!client || !FROM_NUMBER) {
    console.log(`[SMS - TEST] ${telefon}: ${poruka}`);
    return;
  }
  try {
    await client.messages.create({ body: poruka, from: FROM_NUMBER, to: telefon });
    console.log(`[SMS] Poslano na ${telefon}`);
  } catch (err) {
    console.error(`[SMS] Greška: ${err.message}`);
  }
}

// ─── EMAIL ─────────────────────────────────────────────
async function posaljiEmail(email, naslov, poruka) {
  if (!resend) {
    console.log(`[EMAIL - TEST] ${email}: ${poruka}`);
    return;
  }
  try {
    await resend.emails.send({
      from: 'termini.pro <podsjetnici@termini.pro>',
      to: email,
      subject: naslov,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #1a7a4a;">termini.pro</h2>
          <p style="font-size: 16px; line-height: 1.6;">${poruka}</p>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #888;">termini.pro — Vaš digitalni asistent za zakazivanje</p>
        </div>
      `
    });
    console.log(`[EMAIL] Poslano na ${email}`);
  } catch (err) {
    console.error(`[EMAIL] Greška: ${err.message}`);
  }
}

// ─── POTVRDA TERMINA ───────────────────────────────────
async function sendConfirmationSMS(klijent, appointment, service) {
  const vrijeme = new Date(appointment.starts_at).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
  const datum = new Date(appointment.starts_at).toLocaleDateString('hr-HR', { day: 'numeric', month: 'long' });

  if (klijent?.phone) {
    const poruka = `Potvrda termina: ${service.name} u ${klijent.business_name} — ${datum} u ${vrijeme}. Za otkazivanje nas kontaktirajte.`;
    await posaljiSMS(klijent.phone, poruka);
  }

  if (klijent?.email) {
    const poruka = `Poštovani/a <strong>${klijent.name}</strong>,<br><br>
    Vaš termin je potvrđen! 🎉<br><br>
    📋 <strong>Usluga:</strong> ${service.name}<br>
    📅 <strong>Datum:</strong> ${datum}<br>
    🕐 <strong>Vrijeme:</strong> ${vrijeme}<br><br>
    Za otkazivanje kontaktirajte salon.`;
    await posaljiEmail(klijent.email, `Potvrda termina — ${datum}`, poruka);
  }
}

// ─── DNEVNI PODSJETNICI ────────────────────────────────
async function sendDailyReminders() {
  console.log('[CRON] Provjera podsjetnika...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().split('T')[0];

  const appointments = await db.queryAll(
    `SELECT a.id, a.starts_at, 
            c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
            s.name AS service_name, 
            b.name AS business_name, b.phone AS business_phone
     FROM appointments a
     JOIN clients c ON c.id = a.client_id
     JOIN services s ON s.id = a.service_id
     JOIN businesses b ON b.id = a.business_id
     WHERE DATE(a.starts_at) = $1
       AND a.status = 'confirmed'
       AND a.reminder_sent = FALSE
       AND (c.phone IS NOT NULL OR c.email IS NOT NULL)`,
    [date]
  );

  console.log(`[CRON] ${appointments.length} podsjetnika za sutra.`);

  for (const appt of appointments) {
    const vrijeme = new Date(appt.starts_at).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });

    // SMS — ako ima telefon
    if (appt.client_phone) {
      const poruka = `Podsjetnik: Vaš termin u ${appt.business_name} je sutra u ${vrijeme} (${appt.service_name}). Za otkazivanje pozovite ${appt.business_phone || 'salon'}.`;
      await posaljiSMS(appt.client_phone, poruka);
    }

    // EMAIL — ako ima email
    if (appt.client_email) {
      const poruka = `Poštovani/a <strong>${appt.client_name}</strong>,<br><br>
      Podsjećamo vas na sutrašnji termin! 📅<br><br>
      📋 <strong>Usluga:</strong> ${appt.service_name}<br>
      🏪 <strong>Salon:</strong> ${appt.business_name}<br>
      🕐 <strong>Vrijeme:</strong> ${vrijeme}<br><br>
      Za otkazivanje kontaktirajte salon na <strong>${appt.business_phone || 'broj salona'}</strong>.`;
      await posaljiEmail(appt.client_email, `Podsjetnik: Vaš termin sutra u ${vrijeme}`, poruka);
    }

    await db.query('UPDATE appointments SET reminder_sent = TRUE WHERE id = $1', [appt.id]);
  }
}

// ─── REAKTIVACIJA ──────────────────────────────────────
async function sendReactivationMessages() {
  console.log('[CRON] Provjera neaktivnih klijenata...');
}

module.exports = { sendConfirmationSMS, sendDailyReminders, sendReactivationMessages };
