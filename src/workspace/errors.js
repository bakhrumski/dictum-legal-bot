'use strict';

class WorkspaceError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendWorkspaceError(res, error) {
  if (error instanceof WorkspaceError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  console.error('[WORKSPACE] Unhandled error:', error);
  return res.status(500).json({
    error: 'Workspace so‘rovini bajarishda xatolik yuz berdi',
    code: 'workspace_internal_error',
  });
}

module.exports = { WorkspaceError, sendWorkspaceError };
