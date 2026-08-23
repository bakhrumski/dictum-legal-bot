'use strict';

const { WorkspaceError } = require('./errors');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredString(value, field, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string') {
    throw new WorkspaceError(400, 'invalid_input', `${field} matn bo‘lishi kerak`);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new WorkspaceError(
      400,
      'invalid_input',
      `${field} uzunligi ${min}–${max} belgi oralig‘ida bo‘lishi kerak`
    );
  }
  return normalized;
}

function optionalString(value, field, { max = 1000 } = {}) {
  if (value == null || value === '') return null;
  return requiredString(value, field, { min: 1, max });
}

function uuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new WorkspaceError(400, 'invalid_input', `${field} noto‘g‘ri formatda`);
  }
  return value.toLowerCase();
}

function integer(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new WorkspaceError(400, 'invalid_input', `${field} butun son bo‘lishi kerak`);
  }
  return parsed;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new WorkspaceError(400, 'invalid_input', `${field} uchun ruxsat etilmagan qiymat`);
  }
  return value;
}

function isoDate(value, field, { optional = true } = {}) {
  if ((value == null || value === '') && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WorkspaceError(400, 'invalid_input', `${field} YYYY-MM-DD formatida bo‘lishi kerak`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new WorkspaceError(400, 'invalid_input', `${field} haqiqiy sana bo‘lishi kerak`);
  }
  return value;
}

function booleanValue(value, field, defaultValue = false) {
  if (value == null) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new WorkspaceError(400, 'invalid_input', `${field} true yoki false bo‘lishi kerak`);
  }
  return value;
}

function uniqueIntegerArray(value, field, maxLength = 200) {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new WorkspaceError(400, 'invalid_input', `${field} ro‘yxat bo‘lishi kerak`);
  }
  return [...new Set(value.map((item) => integer(item, field, { min: 1 })))];
}

function slug(value) {
  const normalized = requiredString(value, 'slug', { min: 3, max: 64 }).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(normalized)) {
    throw new WorkspaceError(
      400,
      'invalid_input',
      'slug faqat lotin harflari, raqamlar va o‘rtadagi defislardan iborat bo‘lishi kerak'
    );
  }
  return normalized;
}

module.exports = {
  UUID_PATTERN,
  booleanValue,
  integer,
  isoDate,
  oneOf,
  optionalString,
  requiredString,
  slug,
  uniqueIntegerArray,
  uuid,
};
