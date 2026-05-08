require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function updateAdminPassword() {
  const client = await pool.connect();

  try {
    console.log('🔧 Updating admin password...');

    // Hash the password from .env
    const password = process.env.ADMIN_PASSWORD || 'dictum2026';
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update admin password
    const result = await client.query(
      'UPDATE admins SET password = $1 WHERE username = $2 RETURNING id, username, full_name, role',
      [hashedPassword, 'admin']
    );

    if (result.rows.length > 0) {
      console.log('✅ Admin password updated successfully!');
      console.log('   Username:', result.rows[0].username);
      console.log('   Full Name:', result.rows[0].full_name);
      console.log('   Role:', result.rows[0].role);
      console.log('   Password:', password);
    } else {
      console.log('❌ Admin user not found!');
    }

  } catch (error) {
    console.error('❌ Error updating password:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run update
updateAdminPassword().catch(console.error);
