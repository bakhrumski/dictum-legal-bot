'use strict';

/**
 * Portal Database Models — Schema migrations for AI Portal
 *
 * Tables:
 *   portal_users          — registered clients/lawyers with subscription plans
 *   portal_conversations  — threaded chat conversations
 *   portal_messages       — individual messages within conversations
 *   portal_documents      — uploaded documents for analysis
 *   portal_agent_tasks    — agentic workflow tasks (NDA draft, compliance review)
 *   portal_subscriptions  — subscription history and billing
 */

const { pool } = require('../database/db');

const PLAN_LIMITS = {
  trial:    { queries: 70,   days: 7,   name: 'Sinov',    price: 0 },
  silver:   { queries: 300,  days: 30,  name: 'Silver',   price: 299000 },
  gold:     { queries: 750,  days: 30,  name: 'Gold',     price: 599000 },
  platinum: { queries: 1500, days: 30,  name: 'Platinum', price: 1199000 }
};

async function runPortalMigrations() {
  try {
    // ──── portal_users ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password_hash TEXT NOT NULL,
        firm_name VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'lawyer', 'client')),
        plan VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'silver', 'gold', 'platinum')),
        plan_started_at TIMESTAMPTZ DEFAULT NOW(),
        queries_used INTEGER DEFAULT 0,
        queries_limit INTEGER DEFAULT 70,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_users_role ON portal_users(role)`);

    // ──── portal_conversations ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        title TEXT,
        topic VARCHAR(100),
        model_used VARCHAR(100),
        message_count INTEGER DEFAULT 0,
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_conv_user ON portal_conversations(user_id, updated_at DESC)`);

    // ──── portal_messages ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES portal_conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        sources JSONB DEFAULT '[]',
        model_used VARCHAR(100),
        tokens_used INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT FALSE,
        verified_by INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_msg_conv ON portal_messages(conversation_id, created_at ASC)`);

    // ──── portal_documents ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        original_name VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100),
        file_size INTEGER,
        extracted_text TEXT,
        page_count INTEGER,
        analysis_result JSONB,
        analysis_status VARCHAR(20) DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
        category VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_docs_user ON portal_documents(user_id, created_at DESC)`);

    // ──── portal_agent_tasks ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_agent_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        conversation_id INTEGER REFERENCES portal_conversations(id) ON DELETE SET NULL,
        task_type VARCHAR(50) NOT NULL,
        task_input JSONB NOT NULL DEFAULT '{}',
        task_output JSONB,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        steps JSONB DEFAULT '[]',
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER DEFAULT 0,
        error_message TEXT,
        model_used VARCHAR(100),
        tokens_used INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_tasks_user ON portal_agent_tasks(user_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_tasks_status ON portal_agent_tasks(status)`);

    // ──── portal_subscriptions ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        plan VARCHAR(20) NOT NULL,
        period_months INTEGER DEFAULT 1,
        price INTEGER NOT NULL,
        discount_percent INTEGER DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        payment_ref VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_subs_user ON portal_subscriptions(user_id)`);

    // ──── portal_feedback ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER DEFAULT 0,
        message_id INTEGER,
        conversation_id INTEGER,
        rating VARCHAR(10) NOT NULL CHECK (rating IN ('good', 'bad')),
        user_question TEXT,
        ai_response TEXT,
        topic VARCHAR(100),
        source VARCHAR(20) DEFAULT 'dashboard',
        reviewed BOOLEAN DEFAULT FALSE,
        review_result VARCHAR(20) CHECK (review_result IN ('confirmed_good', 'confirmed_bad', 'corrected')),
        reviewer_note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_feedback_user ON portal_feedback(user_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_portal_feedback_rating ON portal_feedback(rating)`);

    console.log('[PORTAL] Database migrations completed');
  } catch (err) {
    console.error('[PORTAL] Migration error:', err.message);
  }
}

module.exports = { runPortalMigrations, PLAN_LIMITS };
