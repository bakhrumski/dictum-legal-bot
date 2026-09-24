'use strict';

/**
 * Email verification codes for common-user registration.
 *
 * Mode A (stub, default): logs the code to console. Useful in dev — no SMTP needed.
 * Mode B (real SMTP):  auto-activates when SMTP_HOST + SMTP_USER + SMTP_PASS are set.
 *                      Uses nodemailer; install it before enabling.
 *
 * The codes themselves live in the shared verificationTokens map, just like the
 * Telegram flow, so /api/register/common can verify either delivery channel.
 */

const { verificationTokens } = require('../verification-store');
const crypto = require('crypto');

const SMTP_READY = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!SMTP_READY) return null;
  try {
    // Lazy require so the stub mode doesn't need nodemailer installed.
    const nodemailer = require('nodemailer');
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return _transporter;
  } catch (err) {
    console.warn('[EMAIL] nodemailer not installed — falling back to stub mode');
    return null;
  }
}

function genCode() {
  return require('./otp').digitCode(4);
}

/**
 * Send a 4-digit verification code to an email address.
 * Returns { token } — pass back to client; client submits { token, code } to register.
 */
async function sendEmailCode(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('invalid_email');
  }
  const code = genCode();
  const token = crypto.randomBytes(8).toString('hex');
  verificationTokens.set(token, {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
    channel: 'email',
    email: email.trim().toLowerCase(),
  });

  const transporter = getTransporter();
  if (transporter) {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    try {
      await transporter.sendMail({
        from: `JuristAI <${from}>`,
        to: email,
        subject: 'JuristAI tasdiqlash kodi',
        text: `Sizning JuristAI tasdiqlash kodingiz: ${code}\n\nKod 5 daqiqa amal qiladi.`,
        html: `<p>Sizning <b>JuristAI</b> tasdiqlash kodingiz:</p><h2 style="letter-spacing:6px">${code}</h2><p>Kod 5 daqiqa amal qiladi.</p>`,
      });
      console.log(`[EMAIL] code sent to ${email}`);
    } catch (err) {
      console.error('[EMAIL] send failed, keeping token alive for testing:', err.message);
    }
  } else {
    // No SMTP: the code is not sent anywhere. It used to be written to the
    // production log with its token; now only a local developer who asks
    // for it sees it.
    if (process.env.EMAIL_DEV_LOG_CODES === 'true') console.log(`[EMAIL STUB] code for ${email}: ${code}`);
    else console.warn('[EMAIL STUB] SMTP is not configured; the email code was not sent');
  }
  return { token };
}

module.exports = { sendEmailCode, SMTP_READY };
