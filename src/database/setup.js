require('dotenv').config();
const { pool } = require('./db');

async function setupDatabase() {
  const client = await pool.connect();

  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        blocked BOOLEAN DEFAULT FALSE,
        blocked_at TIMESTAMP,
        blocked_by INTEGER,
        block_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('users table created');

    // Create admins table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'student',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('admins table created');

    // Create requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        request_text TEXT,
        request_type VARCHAR(50) DEFAULT 'text',
        file_id VARCHAR(255),
        file_size INTEGER,
        file_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        category VARCHAR(100) DEFAULT 'Boshqa',
        response_text TEXT,
        student_response TEXT,
        student_admin_id INTEGER,
        responded_by VARCHAR(255),
        master_approved BOOLEAN DEFAULT FALSE,
        assigned_to INTEGER REFERENCES admins(id),
        assigned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        answered_at TIMESTAMP
      )
    `);
    console.log('requests table created');

    // Add assigned_student_id column if not exists
    await client.query(`
      ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_student_id INTEGER REFERENCES admins(id)
    `);
    console.log('assigned_student_id column ensured');

    // Create block_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS block_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(50),
        reason TEXT,
        performed_by INTEGER REFERENCES admins(id),
        performed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('block_history table created');

    // Create student_ratings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_ratings (
        id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
        rated_by INTEGER REFERENCES admins(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(request_id)
      )
    `);
    console.log('student_ratings table created');

    // Insert default master admin
    const existingAdmin = await client.query(
      "SELECT id FROM admins WHERE username = 'admin'"
    );

    if (existingAdmin.rows.length === 0) {
      await client.query(`
        INSERT INTO admins (username, password, full_name, role)
        VALUES ('admin', 'admin123', 'Master Admin', 'master')
      `);
      console.log('Default master admin created (admin / admin123)');
    }

    console.log('\nDatabase setup complete!');

  } catch (error) {
    console.error('Setup error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase();
