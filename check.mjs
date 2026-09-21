import { chromium } from 'playwright';
import nodemailer from 'nodemailer';

const START_URL = 'https://sede.administracionespublicas.gob.es/pagina/index/directorio/icpplus';
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
    auth: {
      user: requireEnv('SMTP_USER'),
      pass: requireEnv('SMTP_PASS'),
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: targetEmail,
    subject,
    text,
  });
}

const browser = await chromium.launch({ headless: true });
let ok = false;
let details = '';

try {
  const page = await browser.newPage({ locale: 'es-ES' });
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Follow the official ICP+ appointment entry if present.
  const entry = page.getByRole('link', { name: /cita previa|acceder al procedimiento|icp\+|extranjer/i }).first();
  if (await entry.count()) {
    await entry.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
  }

  // Some versions redirect through intermediate pages. Follow likely appointment buttons/links.
  for (let i = 0; i < 3; i++) {
    const madrid = page.getByRole('option', { name: /madrid/i }).first();
    if (await madrid.count()) {
      ok = true;
      details = 'La liste des provinces est chargée et Madrid est sélectionnable.';
      break;
    }

    const select = page.locator('select').filter({ has: page.locator('option') }).first();
    if (await select.count()) {
      const options = await select.locator('option').allTextContents();
      if (options.some(x => /madrid/i.test(x))) {
        ok = true;
        details = 'La liste des provinces est chargée et Madrid est sélectionnable.';
        break;
      }
    }

    const next = page.getByRole('link', { name: /entrar|continuar|acceder|cita previa/i }).first();
    if (await next.count()) {
      await next.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      continue;
    }

    const body = (await page.locator('body').innerText()).slice(0, 3000);
    details = body;
    break;
  }

  console.log(ok ? 'OK: Madrid disponible dans le sélecteur.' : 'KO: Madrid non détecté.');
  if (!ok) {
    console.log(details);
    process.exitCode = 1;
  }
} catch (err) {
  details = err?.stack || String(err);
  console.error(details);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (ok && process.env.SEND_EMAIL === 'true') {
  if (!targetEmail) throw new Error('Missing required secret: ALERT_EMAIL');
  await sendAlert(
    '🟢 ICP+ fonctionne — Madrid est accessible',
    `Le site ICP+ s’affiche correctement et Madrid est sélectionnable.\n\n${START_URL}\n`
  );
}
