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
    auth: { user: requireEnv('SMTP_USER'), pass: requireEnv('SMTP_PASS') },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: targetEmail, subject, text,
  });
}

const browser = await chromium.launch({ headless: true });
let ok = false;

try {
  const page = await browser.newPage({ locale: 'es-ES' });
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  for (let i = 0; i < 5; i++) {
    console.log(`PAGE ${i + 1} URL: ${page.url()}`);
    console.log(`TITLE: ${await page.title()}`);

    const selects = page.locator('select');
    console.log(`SELECTS: ${await selects.count()}`);
    for (let s = 0; s < await selects.count(); s++) {
      const opts = await selects.nth(s).locator('option').allTextContents().catch(() => []);
      console.log(`SELECT ${s} OPTIONS: ${opts.join(' | ').slice(0, 5000)}`);
      if (opts.some(x => /madrid/i.test(x))) {
        ok = true;
        break;
      }
    }
    if (ok) break;

    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 8000);
    console.log(`BODY: ${body}`);

    const candidates = page.getByRole('link', { name: /cita previa|acceder al procedimiento|acceder|entrar|continuar|extranjer|icp\+/i });
    const count = await candidates.count();
    console.log(`NAV CANDIDATES: ${count}`);
    if (!count) break;

    const href = await candidates.first().getAttribute('href').catch(() => null);
    console.log(`CLICKING: ${(await candidates.first().innerText().catch(() => ''))} href=${href}`);
    await candidates.first().click();
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: 'icp-debug.png', fullPage: true }).catch(() => {});
  console.log(ok ? 'OK: Madrid disponible dans le sélecteur.' : 'KO: Madrid non détecté.');
  if (!ok) process.exitCode = 1;
} catch (err) {
  console.error(err?.stack || String(err));
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
