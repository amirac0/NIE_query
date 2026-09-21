import { chromium } from 'playwright';
import nodemailer from 'nodemailer';

const TARGET = 'https://icp.administracionelectronica.gob.es/icpplus/index.html';
const targetEmail = process.env.ALERT_EMAIL;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

async function sendAlert(subject, text) {
  const transporter = nodemailer.createTransport({
    host: requireEnv('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user: requireEnv('SMTP_USER'), pass: requireEnv('SMTP_PASS') },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: targetEmail,
    subject,
    text,
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ['--lang=es-ES'],
});

let accessible = false;
let finalUrl = '';

try {
  const context = await browser.newContext({
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1365, height: 768 },
    extraHTTPHeaders: {
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
  });

  const page = await context.newPage();
  console.log('TEST:', TARGET);

  try {
    const response = await page.goto(TARGET, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    const status = response?.status() ?? 0;
    finalUrl = page.url();
    const title = await page.title().catch(() => '');
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');

    console.log('HTTP:', status, 'FINAL URL:', finalUrl, 'TITLE:', title);
    console.log('BODY:', body.slice(0, 1200));

    const blocked =
      status === 403 ||
      /intrusion prevention|fortigate|access denied|forbidden/i.test(`${title} ${body}`);

    // For this phase, success means the real ICP+ page itself is reachable.
    accessible = status >= 200 && status < 400 && !blocked;

    console.log(accessible
      ? 'OK: la vraie page ICP+ est accessible.'
      : 'KO: ICP+ est bloqué ou indisponible.');
  } catch (e) {
    console.log('ICP+ FAILED:', e?.message || String(e));
  }

  await context.close();
} finally {
  await browser.close();
}

if (accessible && process.env.SEND_EMAIL === 'true') {
  if (!targetEmail) throw new Error('Missing required secret: ALERT_EMAIL');
  await sendAlert(
    '🟢 ICP+ est accessible',
    `La page ICP+ est accessible depuis le contrôle automatique.\n\nPage : ${finalUrl || TARGET}\n`
  );
  console.log('EMAIL: alerte envoyée.');
} else {
  console.log('EMAIL: aucune alerte envoyée.');
}

// A blocked/unavailable site is a monitoring result, not a workflow failure.
process.exit(0);
