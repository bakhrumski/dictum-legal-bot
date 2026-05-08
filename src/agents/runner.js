'use strict';

const { pool } = require('../database/db');

/**
 * Agent Runner — Core orchestrator for all AI agents.
 *
 * Wraps callAI() (injected at init), adds execution tracing,
 * saves traces to agent_traces table, handles errors gracefully.
 */

let _callAI = null;

/** Must be called once from server.js to inject the callAI function */
function initRunner(callAIFn) {
  _callAI = callAIFn;
}

/**
 * Run an AI agent with tracing and error handling.
 *
 * @param {string} agentType - e.g. 'triage', 'research', 'draft', 'verify'
 * @param {number|null} requestId - FK to requests table (null for standalone runs)
 * @param {object} input - { messages: [{role, text}], options: {} }
 * @param {object} meta - { inputSummary: string, sources: [] }
 * @returns {Promise<{ output: any, provider: string, traceId: number }>}
 */
async function runAgent(agentType, requestId, input, meta = {}) {
  if (!_callAI) throw new Error('Agent runner not initialized — call initRunner(callAI) first');

  const startTime = Date.now();
  let output = null;
  let provider = null;
  let error = null;

  try {
    const result = await _callAI(input.messages, input.options || {});
    provider = result.provider;

    // Try to parse as JSON if the response looks like JSON
    const text = result.text.trim();
    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        output = JSON.parse(jsonMatch[0]);
      } catch {
        output = { raw: text };
      }
    } else {
      output = { raw: text };
    }
  } catch (err) {
    error = err.message;
    output = { error: err.message };
    console.error(`[AGENT:${agentType}] Error:`, err.message);
  }

  const durationMs = Date.now() - startTime;

  // Save trace to DB (fire-and-forget, don't let trace failure break the agent)
  let traceId = null;
  try {
    const traceResult = await pool.query(
      `INSERT INTO agent_traces (request_id, agent_type, input_summary, output, sources, model_used, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        requestId,
        agentType,
        (meta.inputSummary || '').substring(0, 500),
        JSON.stringify(output),
        JSON.stringify(meta.sources || []),
        provider,
        durationMs,
        error
      ]
    );
    traceId = traceResult.rows[0].id;
  } catch (traceErr) {
    console.error(`[AGENT:${agentType}] Trace save failed:`, traceErr.message);
  }

  if (error) {
    console.log(`[AGENT:${agentType}] Failed in ${durationMs}ms — ${error}`);
  } else {
    console.log(`[AGENT:${agentType}] Completed in ${durationMs}ms via ${provider}`);
  }

  return { output, provider, traceId, error, durationMs };
}

/**
 * Get all traces for a request.
 */
async function getTraces(requestId) {
  const result = await pool.query(
    `SELECT id, agent_type, input_summary, output, sources, model_used, duration_ms, error, created_at
     FROM agent_traces WHERE request_id = $1 ORDER BY created_at DESC`,
    [requestId]
  );
  return result.rows;
}

/**
 * Get the latest trace of a specific type for a request.
 */
async function getLatestTrace(requestId, agentType) {
  const result = await pool.query(
    `SELECT id, output, sources, model_used, duration_ms, error, created_at
     FROM agent_traces WHERE request_id = $1 AND agent_type = $2 AND error IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [requestId, agentType]
  );
  return result.rows[0] || null;
}

module.exports = { initRunner, runAgent, getTraces, getLatestTrace };
