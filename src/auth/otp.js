'use strict';

/**
 * One-time codes and throwaway passwords from the CSPRNG. Math.random is not
 * a secure source: its output can be predicted from earlier values, which
 * matters for login, recovery and 2FA codes (audit L4).
 */

const crypto = require('crypto');

/** A numeric code of exactly `digits` digits, e.g. digitCode(4) -> "4821". */
function digitCode(digits = 4) {
  const min = 10 ** (digits - 1);
  return String(crypto.randomInt(min, 10 ** digits));
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** A password from an alphabet without look-alike characters. */
function randomPassword(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

module.exports = { digitCode, randomPassword };
