'use strict';

const WORKSPACE_BUCKET = 'workspace-documents';

function projectRefFromDatabaseUrl(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    const username = decodeURIComponent(parsed.username || '');
    const match = username.match(/^postgres\.([a-z0-9]+)$/i);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

function storageConfiguration(env = process.env) {
  const projectRef = projectRefFromDatabaseUrl(env.DATABASE_URL);
  const supabaseUrl = String(
    env.SUPABASE_URL
      || env.NEXT_PUBLIC_SUPABASE_URL
      || (projectRef ? `https://${projectRef}.supabase.co` : '')
  ).replace(/\/$/, '');
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    const error = new Error(`Workspace Storage sozlanmagan: ${missing.join(', ')}`);
    error.code = 'workspace_storage_not_configured';
    throw error;
  }
  return { supabaseUrl, serviceRoleKey };
}

function encodedObjectPath(objectPath) {
  return String(objectPath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function storageRequest(path, options = {}, env = process.env) {
  const { supabaseUrl, serviceRoleKey } = storageConfiguration(env);
  const response = await fetch(`${supabaseUrl}/storage/v1${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); } catch (_) { payload = { message: text }; }
  }
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Supabase Storage HTTP ${response.status}`);
    error.code = payload.errorCode || payload.code || 'workspace_storage_error';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function uploadWorkspaceObject(objectPath, buffer, mimeType, env = process.env) {
  return storageRequest(
    `/object/${WORKSPACE_BUCKET}/${encodedObjectPath(objectPath)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'x-upsert': 'false',
        'cache-control': '3600',
      },
      body: buffer,
    },
    env
  );
}

async function removeWorkspaceObject(objectPath, env = process.env) {
  return storageRequest(
    `/object/${WORKSPACE_BUCKET}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [objectPath] }),
    },
    env
  );
}

async function createWorkspaceDownloadUrl(objectPath, expiresIn = 120, env = process.env) {
  const config = storageConfiguration(env);
  const payload = await storageRequest(
    `/object/sign/${WORKSPACE_BUCKET}/${encodedObjectPath(objectPath)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    },
    env
  );
  const signedPath = payload.signedURL || payload.signedUrl;
  if (!signedPath) {
    const error = new Error('Supabase Storage yuklab olish havolasini qaytarmadi');
    error.code = 'workspace_storage_sign_failed';
    throw error;
  }
  return signedPath.startsWith('http') ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
}

module.exports = {
  WORKSPACE_BUCKET,
  createWorkspaceDownloadUrl,
  projectRefFromDatabaseUrl,
  removeWorkspaceObject,
  storageConfiguration,
  uploadWorkspaceObject,
};
