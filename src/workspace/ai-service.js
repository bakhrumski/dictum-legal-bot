'use strict';

const crypto = require('crypto');
const { getLegalPolicyVersions } = require('../rag/legal-prompt-policy');
const { WorkspaceError } = require('./errors');
const {
  requireTask,
  requireWorkspaceAccess,
  withWorkspaceTransaction,
} = require('./authz');

const AUTHORITATIVE_MEMORY_KINDS = ['research', 'document_summary', 'decision', 'note'];
const MAX_CONTEXT_CHARS = 30000;
const STALE_RUN_MINUTES = 10;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeQuestion(question) {
  return String(question || '')
    .normalize('NFKC')
    .toLocaleLowerCase('uz-UZ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function appendWithinLimit(parts, value, limit = MAX_CONTEXT_CHARS) {
  const currentLength = parts.reduce((sum, part) => sum + part.length, 0);
  if (currentLength >= limit) return;
  parts.push(String(value).slice(0, limit - currentLength));
}

async function loadContext(db, workspaceId, taskId, question) {
  const task = taskId ? await requireTask(db, workspaceId, taskId) : null;
  const questionHash = sha256(normalizeQuestion(question));

  const corpusState = (await db.query(
    `SELECT revision, updated_at
       FROM juristai_private.legal_corpus_state
      WHERE singleton = true`
  )).rows[0] || { revision: 0, updated_at: null };

  const documents = (await db.query(
    `SELECT d.id,
            d.title,
            v.id AS version_id,
            v.version_number,
            COALESCE(v.content_text, '') AS content_text
       FROM workspace_documents d
       JOIN LATERAL (
         SELECT id, version_number, content_text
           FROM workspace_document_versions
          WHERE workspace_id = d.workspace_id AND document_id = d.id
          ORDER BY version_number DESC
          LIMIT 1
       ) v ON true
      WHERE d.workspace_id = $1
        AND d.archived_at IS NULL
        AND (
          $2::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM workspace_task_documents td
             WHERE td.workspace_id = d.workspace_id
               AND td.document_id = d.id
               AND td.task_id = $2
          )
        )
      ORDER BY d.updated_at DESC
      LIMIT 30`,
    [workspaceId, taskId]
  )).rows;

  const authoritativeMemory = (await db.query(
    `SELECT mi.id, mi.kind, mi.title
       FROM workspace_memory_items mi
      WHERE mi.workspace_id = $1
        AND mi.superseded_at IS NULL
        AND mi.kind = ANY($3::text[])
        AND (
          $2::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM workspace_task_memory_items tm
             WHERE tm.workspace_id = mi.workspace_id
               AND tm.memory_item_id = mi.id
               AND tm.task_id = $2
          )
        )
      ORDER BY mi.created_at DESC
      LIMIT 100`,
    [workspaceId, taskId, AUTHORITATIVE_MEMORY_KINDS]
  )).rows;

  const relevantMemory = (await db.query(
    `WITH query AS (SELECT websearch_to_tsquery('simple', $3) AS value)
     SELECT DISTINCT mi.id,
            mi.kind,
            mi.title,
            mi.content_markdown,
            mi.citations,
            mi.created_at,
            CASE WHEN tm.task_id IS NULL THEN 0 ELSE 1 END AS task_linked,
            ts_rank(mi.search_vector, query.value) AS rank
       FROM workspace_memory_items mi
       CROSS JOIN query
       LEFT JOIN workspace_task_memory_items tm
         ON tm.workspace_id = mi.workspace_id
        AND tm.memory_item_id = mi.id
        AND tm.task_id = $2
      WHERE mi.workspace_id = $1
        AND mi.superseded_at IS NULL
        AND NOT (
          mi.kind = 'answer'
          AND mi.content_json ->> 'questionHash' = $4
        )
        AND (
          ($2::uuid IS NOT NULL AND tm.task_id IS NOT NULL)
          OR mi.search_vector @@ query.value
        )
      ORDER BY task_linked DESC, rank DESC, mi.created_at DESC
      LIMIT 12`,
    [workspaceId, taskId, question, questionHash]
  )).rows;

  const policyVersions = getLegalPolicyVersions();
  const fingerprintInput = {
    scope: task ? { taskId: task.id, revision: task.revision } : { workspaceId },
    legalCorpus: {
      revision: String(corpusState.revision || 0),
      updatedAt: corpusState.updated_at || null,
    },
    documentVersions: documents.map((document) => document.version_id).sort(),
    authoritativeMemory: authoritativeMemory.map((item) => item.id).sort(),
    relevantMemory: relevantMemory.map((item) => item.id).sort(),
    policyVersions,
  };
  const contextFingerprint = sha256(stableJson(fingerprintInput));
  const reuseKey = sha256([
    task ? `task:${task.id}` : `workspace:${workspaceId}`,
    normalizeQuestion(question),
    contextFingerprint,
    sha256(stableJson(policyVersions)),
  ].join('|'));

  const contextParts = [];
  if (task) {
    appendWithinLimit(
      contextParts,
      `VAZIFA\nSarlavha: ${task.title}\nHolat: ${task.status}\nMuhimlik: ${task.priority}`
      + `\nTavsif: ${task.description || '—'}\nMuddat: ${task.due_date || '—'}\n\n`
    );
  }
  for (const document of documents) {
    appendWithinLimit(
      contextParts,
      `HUJJAT: ${document.title} (v${document.version_number})\n`
      + `${document.content_text || '[Fayl matni indekslanmagan]'}\n\n`
    );
  }
  for (const memory of relevantMemory) {
    appendWithinLimit(
      contextParts,
      `JAMOA XOTIRASI — ${memory.kind}: ${memory.title}\n${memory.content_markdown}\n\n`
    );
  }

  return {
    task,
    documents,
    relevantMemory,
    contextFingerprint,
    reuseKey,
    policyVersion: stableJson(policyVersions),
    contextSnapshot: fingerprintInput,
    workspaceContext: contextParts.join('').trim(),
  };
}

async function ensureThread(db, workspaceId, taskId, threadId, userId, question) {
  if (threadId) {
    const result = await db.query(
      `SELECT * FROM workspace_ai_threads
        WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL`,
      [workspaceId, threadId]
    );
    const thread = result.rows[0];
    if (!thread) throw new WorkspaceError(404, 'thread_not_found', 'AI suhbati topilmadi');
    if ((thread.task_id || null) !== (taskId || null)) {
      throw new WorkspaceError(409, 'thread_task_mismatch', 'AI suhbati boshqa vazifaga tegishli');
    }
    return thread;
  }

  const title = question.slice(0, 120);
  const result = await db.query(
    `INSERT INTO workspace_ai_threads (workspace_id, task_id, title, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [workspaceId, taskId, title, userId]
  );
  return result.rows[0];
}

async function loadThreadHistory(db, workspaceId, threadId) {
  const result = await db.query(
    `SELECT role, content
       FROM workspace_ai_messages
      WHERE workspace_id = $1 AND thread_id = $2
      ORDER BY created_at DESC
      LIMIT 12`,
    [workspaceId, threadId]
  );
  return result.rows.reverse();
}

function memoryResponse(memory, run, threadId) {
  const content = jsonValue(memory.content_json, {});
  return {
    status: 'succeeded',
    reused: true,
    runId: run.id,
    threadId,
    memoryItemId: memory.id,
    reply: memory.content_markdown,
    provider: 'workspace-memory',
    model: content.model || null,
    topic: content.topic || null,
    rag: content.rag || null,
    ragUsed: Boolean(content.ragUsed),
    databases: content.databases || ['Workspace xotirasi', 'Korpus', 'Lex.uz'],
    qaBank: content.qaBank || null,
    citations: jsonValue(memory.citations, []),
    policyVersions: content.policyVersions || null,
    nextActions: content.nextActions || [],
    usage: { inTokens: 0, outTokens: 0, costUsd: 0 },
  };
}

function createWorkspaceAiService({ pool, generateAnswer }) {
  if (!pool || typeof generateAnswer !== 'function') {
    throw new TypeError('Workspace AI service requires pool and generateAnswer');
  }

  async function ask({ workspaceId, taskId = null, threadId = null, question, topic = null, userId }) {
    const prepared = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, {
        minimumRole: 'member',
        requireActive: true,
      });
      const context = await loadContext(db, workspaceId, taskId, question);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [context.reuseKey]);

      const existingMemory = (await db.query(
        `SELECT * FROM workspace_memory_items
          WHERE workspace_id = $1
            AND reuse_key = $2
            AND superseded_at IS NULL
          LIMIT 1`,
        [workspaceId, context.reuseKey]
      )).rows[0];

      if (existingMemory) {
        const thread = await ensureThread(db, workspaceId, taskId, threadId, userId, question);
        const run = (await db.query(
          `INSERT INTO workspace_ai_runs (
             workspace_id, task_id, thread_id, requested_by, request_text,
             reuse_key, context_fingerprint, prompt_policy_version, status,
             provider, input_tokens, output_tokens, estimated_cost_usd,
             context_snapshot, reused_memory_item_id, started_at, completed_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,'reused','workspace-memory',0,0,0,$9,$10,now(),now()
           ) RETURNING *`,
          [workspaceId, taskId, thread.id, userId, question, context.reuseKey,
            context.contextFingerprint, context.policyVersion,
            JSON.stringify(context.contextSnapshot), existingMemory.id]
        )).rows[0];

        if (taskId) {
          await db.query(
            `INSERT INTO workspace_task_memory_items
               (workspace_id, task_id, memory_item_id, linked_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`,
            [workspaceId, taskId, existingMemory.id, userId]
          );
        }
        await db.query(
          `INSERT INTO workspace_ai_messages
             (workspace_id, thread_id, role, content, created_by, ai_run_id, memory_item_id)
           VALUES ($1,$2,'user',$3,$4,$5),
                  ($1,$2,'assistant',$6,$4,$5,$7)`,
          [workspaceId, thread.id, question, userId, run.id,
            existingMemory.content_markdown, existingMemory.id]
        );
        await db.query('UPDATE workspace_ai_threads SET updated_at = now() WHERE id = $1', [thread.id]);
        return { type: 'reused', response: memoryResponse(existingMemory, run, thread.id) };
      }

      await db.query(
        `UPDATE workspace_ai_runs
            SET status = 'failed', completed_at = now(), error_code = 'stale_run',
                error_message = 'Generation did not complete before the recovery window'
          WHERE workspace_id = $1
            AND reuse_key = $2
            AND status IN ('queued', 'running')
            AND created_at < now() - ($3::text || ' minutes')::interval`,
        [workspaceId, context.reuseKey, STALE_RUN_MINUTES]
      );

      const activeRun = (await db.query(
        `SELECT id, thread_id, status, created_at
           FROM workspace_ai_runs
          WHERE workspace_id = $1
            AND reuse_key = $2
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1`,
        [workspaceId, context.reuseKey]
      )).rows[0];
      if (activeRun) {
        return {
          type: 'in_progress',
          response: {
            status: 'in_progress',
            reused: false,
            runId: activeRun.id,
            threadId: activeRun.thread_id,
          },
        };
      }

      const thread = await ensureThread(db, workspaceId, taskId, threadId, userId, question);
      const run = (await db.query(
        `INSERT INTO workspace_ai_runs (
           workspace_id, task_id, thread_id, requested_by, request_text,
           reuse_key, context_fingerprint, prompt_policy_version, status,
           context_snapshot, started_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',$9,now())
         RETURNING *`,
        [workspaceId, taskId, thread.id, userId, question, context.reuseKey,
          context.contextFingerprint, context.policyVersion,
          JSON.stringify(context.contextSnapshot)]
      )).rows[0];
      const history = await loadThreadHistory(db, workspaceId, thread.id);
      await db.query(
        `INSERT INTO workspace_ai_messages
           (workspace_id, thread_id, role, content, created_by, ai_run_id)
         VALUES ($1,$2,'user',$3,$4,$5)`,
        [workspaceId, thread.id, question, userId, run.id]
      );
      return { type: 'generate', run, thread, context, history };
    });

    if (prepared.type !== 'generate') return prepared.response;

    let generated;
    try {
      generated = await generateAnswer({
        question,
        topic,
        history: prepared.history,
        workspaceContext: prepared.context.workspaceContext,
        userId,
      });
    } catch (error) {
      await withWorkspaceTransaction(pool, userId, async (db) => {
        await db.query(
          `UPDATE workspace_ai_runs
              SET status = 'failed', completed_at = now(),
                  error_code = 'generation_failed', error_message = $2
            WHERE id = $1 AND status = 'running'`,
          [prepared.run.id, String(error.message || error).slice(0, 2000)]
        );
      });
      throw new WorkspaceError(502, 'workspace_ai_failed', 'AI javobini yaratib bo‘lmadi');
    }

    try {
      return await withWorkspaceTransaction(pool, userId, async (db) => {
        await requireWorkspaceAccess(db, workspaceId, userId, {
          minimumRole: 'member',
          requireActive: true,
        });
        const usage = generated.usage || {};
        const questionHash = sha256(normalizeQuestion(question));
        const memoryResult = await db.query(
          `INSERT INTO workspace_memory_items (
             workspace_id, origin_task_id, kind, title, content_markdown,
             content_json, citations, reuse_key, context_fingerprint,
             prompt_policy_version, source_ai_run_id, created_by
           ) VALUES ($1,$2,'answer',$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [workspaceId, taskId, question.slice(0, 240), generated.reply,
            JSON.stringify({
              provider: generated.provider,
              model: generated.model || null,
              topic: generated.topic,
              rag: generated.rag,
              ragUsed: Boolean(generated.ragUsed),
              databases: generated.databases || ['Workspace xotirasi', 'Korpus', 'Lex.uz'],
              qaBank: generated.qaBank || null,
              nextActions: generated.nextActions,
              policyVersions: generated.policyVersions,
              questionHash,
              scope: taskId ? `task:${taskId}` : `workspace:${workspaceId}`,
            }),
            JSON.stringify(generated.citations || []),
            prepared.context.reuseKey, prepared.context.contextFingerprint,
            prepared.context.policyVersion, prepared.run.id, userId]
        );
        const memory = memoryResult.rows[0] || (await db.query(
          `SELECT * FROM workspace_memory_items
            WHERE workspace_id = $1 AND reuse_key = $2 AND superseded_at IS NULL
            LIMIT 1`,
          [workspaceId, prepared.context.reuseKey]
        )).rows[0];

        if (!memory) {
          throw new WorkspaceError(409, 'workspace_memory_conflict', 'AI natijasini Workspace xotirasiga saqlab bo‘lmadi');
        }

        const wonGeneration = memory.source_ai_run_id === prepared.run.id;
        if (wonGeneration) {
          await db.query(
            `UPDATE workspace_memory_items
                SET superseded_at = now(), superseded_by = $3
              WHERE workspace_id = $1
                AND id <> $3
                AND kind = 'answer'
                AND superseded_at IS NULL
                AND origin_task_id IS NOT DISTINCT FROM $2::uuid
                AND content_json ->> 'questionHash' = $4`,
            [workspaceId, taskId, memory.id, questionHash]
          );
        }
        await db.query(
          `UPDATE workspace_ai_runs
              SET status = $2,
                  provider = $3,
                  model = $4,
                  input_tokens = $5,
                  output_tokens = $6,
                  estimated_cost_usd = $7,
                  reused_memory_item_id = CASE WHEN $2 = 'reused' THEN $8 ELSE NULL END,
                  completed_at = now()
            WHERE id = $1 AND status = 'running'`,
          [prepared.run.id, wonGeneration ? 'succeeded' : 'reused',
            wonGeneration ? generated.provider : 'workspace-memory',
            wonGeneration ? (generated.model || generated.provider) : null,
            wonGeneration ? Number(usage.inTokens || 0) : 0,
            wonGeneration ? Number(usage.outTokens || 0) : 0,
            wonGeneration ? Number(usage.costUsd || 0) : 0,
            memory.id]
        );
        await db.query(
          `INSERT INTO workspace_ai_messages
             (workspace_id, thread_id, role, content, created_by, ai_run_id, memory_item_id)
           VALUES ($1,$2,'assistant',$3,$4,$5,$6)`,
          [workspaceId, prepared.thread.id, memory.content_markdown, userId, prepared.run.id, memory.id]
        );
        await db.query('UPDATE workspace_ai_threads SET updated_at = now() WHERE id = $1', [prepared.thread.id]);

        const content = jsonValue(memory.content_json, {});
        return {
          status: 'succeeded',
          reused: !wonGeneration,
          runId: prepared.run.id,
          threadId: prepared.thread.id,
          memoryItemId: memory.id,
          reply: memory.content_markdown,
          provider: wonGeneration ? generated.provider : 'workspace-memory',
          model: wonGeneration ? (generated.model || generated.provider) : (content.model || null),
          topic: content.topic || generated.topic || null,
          rag: content.rag || generated.rag || null,
          ragUsed: content.ragUsed !== undefined ? Boolean(content.ragUsed) : Boolean(generated.ragUsed),
          databases: content.databases || generated.databases || ['Workspace xotirasi', 'Korpus', 'Lex.uz'],
          qaBank: content.qaBank || generated.qaBank || null,
          citations: jsonValue(memory.citations, generated.citations || []),
          policyVersions: content.policyVersions || generated.policyVersions || null,
          nextActions: content.nextActions || generated.nextActions || [],
          usage: wonGeneration
            ? {
              inTokens: Number(usage.inTokens || 0),
              outTokens: Number(usage.outTokens || 0),
              costUsd: Number(usage.costUsd || 0),
            }
            : { inTokens: 0, outTokens: 0, costUsd: 0 },
        };
      });
    } catch (error) {
      await withWorkspaceTransaction(pool, userId, async (db) => {
        await db.query(
          `UPDATE workspace_ai_runs
              SET status = 'failed', completed_at = now(),
                  error_code = 'finalization_failed', error_message = $2
            WHERE id = $1 AND status = 'running'`,
          [prepared.run.id, String(error.message || error).slice(0, 2000)]
        );
      }).catch((updateError) => {
        console.error('[WORKSPACE AI] Failed to record finalization error:', updateError.message);
      });
      throw error;
    }
  }

  async function recoverStaleRuns() {
    const result = await pool.query(
      `UPDATE workspace_ai_runs
          SET status = 'failed', completed_at = now(), error_code = 'server_restarted',
              error_message = 'Generation was interrupted and can be retried safely'
        WHERE status IN ('queued', 'running')
          AND created_at < now() - ($1::text || ' minutes')::interval`,
      [STALE_RUN_MINUTES]
    );
    if (result.rowCount > 0) {
      console.warn(`[WORKSPACE AI] Recovered ${result.rowCount} stale run(s)`);
    }
    return result.rowCount;
  }

  return { ask, recoverStaleRuns };
}

module.exports = {
  AUTHORITATIVE_MEMORY_KINDS,
  MAX_CONTEXT_CHARS,
  STALE_RUN_MINUTES,
  createWorkspaceAiService,
  loadContext,
  normalizeQuestion,
  sha256,
  stableJson,
};
