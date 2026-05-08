require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function setupDatabase() {
  const client = await pool.connect();

  try {
    console.log('🔧 Setting up database...');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        name VARCHAR(255),
        blocked BOOLEAN DEFAULT FALSE,
        blocked_at TIMESTAMP,
        blocked_by INTEGER,
        block_reason TEXT,
        last_active TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Users table created');

    // Create admins table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'student',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Admins table created');

    // Add duty hours and activity tracking columns to admins
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS duty_start TIME DEFAULT NULL`);
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS duty_end TIME DEFAULT NULL`);
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT DEFAULT NULL`);
    console.log('✅ Admins table columns updated (duty_start, duty_end, last_active_at, telegram_chat_id)');

    // Create requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        request_text TEXT NOT NULL,
        request_type VARCHAR(50) DEFAULT 'text',
        file_id VARCHAR(255),
        file_size BIGINT,
        file_name VARCHAR(255),
        category VARCHAR(255) DEFAULT 'Boshqa',
        status VARCHAR(50) DEFAULT 'pending',
        response_text TEXT,
        student_response TEXT,
        student_admin_id INTEGER REFERENCES admins(id),
        responded_by VARCHAR(255),
        master_approved BOOLEAN DEFAULT FALSE,
        assigned_to INTEGER REFERENCES admins(id),
        assigned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        answered_at TIMESTAMP
      )
    `);
    console.log('✅ Requests table created');

    // Create block_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS block_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        reason TEXT,
        performed_by INTEGER REFERENCES admins(id),
        performed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Block_history table created');

    // Create chat_messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        mentions JSONB DEFAULT '[]',
        reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at)
    `);
    // Migration: add reply_to_id if table already exists without it
    await client.query(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL
    `);
    console.log('✅ Chat_messages table created');

    // Create trigger for block history
    await client.query(`
      CREATE OR REPLACE FUNCTION log_block_action()
      RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'UPDATE' AND OLD.blocked != NEW.blocked) THEN
          INSERT INTO block_history (user_id, action, reason, performed_by)
          VALUES (
            NEW.id,
            CASE WHEN NEW.blocked THEN 'blocked' ELSE 'unblocked' END,
            NEW.block_reason,
            NEW.blocked_by
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS block_history_trigger ON users;
    `);

    await client.query(`
      CREATE TRIGGER block_history_trigger
      AFTER UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION log_block_action();
    `);
    console.log('✅ Block history trigger created');

    // Check if master admin exists
    const adminCheck = await client.query(
      "SELECT * FROM admins WHERE username = 'admin'"
    );

    if (adminCheck.rows.length === 0) {
      // Create default master admin
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await client.query(
        `INSERT INTO admins (username, password, full_name, role)
         VALUES ($1, $2, $3, $4)`,
        ['admin', hashedPassword, 'Master Admin', 'master']
      );
      console.log('✅ Default master admin created');
      console.log('   Username: admin');
      console.log('   Password: admin123');
      console.log('   ⚠️  CHANGE THIS PASSWORD AFTER FIRST LOGIN!');
    } else {
      console.log('ℹ️  Master admin already exists');
    }

    // Check if student admin exists
    const studentCheck = await client.query(
      "SELECT * FROM admins WHERE username = 'student'"
    );

    if (studentCheck.rows.length === 0) {
      // Create default student admin
      const hashedPassword = await bcrypt.hash('student123', 10);
      await client.query(
        `INSERT INTO admins (username, password, full_name, role)
         VALUES ($1, $2, $3, $4)`,
        ['student', hashedPassword, 'Student Admin 1', 'student']
      );
      console.log('✅ Default student admin created');
      console.log('   Username: student');
      console.log('   Password: student123');
      console.log('   ⚠️  CHANGE THIS PASSWORD AFTER FIRST LOGIN!');
    } else {
      console.log('ℹ️  Student admin already exists');
    }

    console.log('\n✅ Database setup complete!');
    console.log('\n📋 Summary:');
    console.log('   - All tables created');
    console.log('   - Default admin accounts ready');
    console.log('   - Ready to start the application!');

  } catch (error) {
    console.error('❌ Error setting up database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run setup
setupDatabase().catch(console.error);
