import { chromium } from 'playwright';
import nodemailer from 'nodemailer';

const URLS = [
  'https://icp.administracionelectronica.gob.es/icpplus/index.html',
  'https://icp.administracionelectronica.gob.es/icpplustiem/index.html'
];
const targetEmail = process.env.ALERT_EMAIL;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}
async function sendAlert(subject, text) {
  const transporter = nodemailer.createTransport({
    host: requireEnv('SMTP_HOST'), port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user: requireEnv('SMTP_USER'), pass: requireEnv('SMTP_PASS') },
  });
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: targetEmail, subject, text });
}

const browser = await chromium.launch({ headless: true });
let ok = false;
let workingUrl = '';

try {
  const page = await browser.newPage({ locale: 'es-ES' });
  for (const url of URLS) {
    try {
      console.log('TEST:', url);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      console.log('HTTP:', response?.status(), 'FINAL URL:', page.url(), 'TITLE:', await page.title());
      await page.waitForTimeout(1500);

      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      console.log('BODY:', body.slice(0, 3000));

      const selects = page.locator('select');
      for (let i = 0; i < await selects.count(); i++) {
        const opts = await selects.nth(i).locator('option').allTextContents().catch(() => []);
        console.log('OPTIONS:', opts.join(' | ').slice(0, 5000));
        if (opts.some(x => /madrid/i.test(x))) {
          ok = true;
          workingUrl = page.url();
          break;
        }
      }
      if (ok) break;
    } catch (e) {
      console.log('URL FAILED:', e?.message || String(e));
    }
  }

  console.log(ok ? 'OK: Madrid est sélectionnable.' : 'KO: Madrid non détecté / ICP+ indisponible.');
} finally {
  await browser.close();
}

if (ok && process.env.SEND_EMAIL === 'true') {
  if (!targetEmail) throw new Error('Missing required secret: ALERT_EMAIL');
  await sendAlert(
    '🟢 ICP+ fonctionne — Madrid est accessible',
    `Madrid est actuellement disponible dans le sélecteur ICP+.\n\nOuvrir : ${workingUrl}\n`
  );
}

// Important: an unavailable ICP+ site is a normal monitoring result, not a workflow failure.
// Exit successfully so GitHub does not generate "workflow failed" notifications.
process.exit(0);
