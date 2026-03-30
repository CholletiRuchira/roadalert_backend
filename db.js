const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'roadalert',
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDB() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected successfully');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id          VARCHAR(36) PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        email       VARCHAR(100) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        role        VARCHAR(20) NOT NULL DEFAULT 'civilian',
        district    VARCHAR(100),
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS reports (
        id            VARCHAR(36) PRIMARY KEY,
        title         VARCHAR(255) NOT NULL,
        description   TEXT,
        location_text VARCHAR(255) NOT NULL,
        latitude      DECIMAL(10,6),
        longitude     DECIMAL(10,6),
        severity      VARCHAR(20) NOT NULL,
        hazard_type   VARCHAR(50) NOT NULL,
        status        VARCHAR(30) NOT NULL DEFAULT 'pending',
        image_url     VARCHAR(500),
        reporter_id   VARCHAR(36),
        reporter_name VARCHAR(100),
        assigned_to   VARCHAR(36),
        action_notes  TEXT,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id          VARCHAR(36) PRIMARY KEY,
        report_id   VARCHAR(36),
        actor_id    VARCHAR(36),
        actor_name  VARCHAR(100),
        action      VARCHAR(50) NOT NULL,
        notes       TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');

    const [rows] = await conn.execute(
      'SELECT id FROM users WHERE email = ?',
      ['authority@roadalert.gov']
    );

    if (rows.length === 0) {
      const hash = bcrypt.hashSync('Admin@1234', 10);
      await conn.execute(
        `INSERT INTO users (id, name, email, password, role, district)
         VALUES (?, ?, ?, ?, 'authority', 'Central District')`,
        [uuidv4(), 'District Authority', 'authority@roadalert.gov', hash]
      );
      console.log('✅ Authority account created');
    }

    conn.release();
    console.log('✅ Database tables ready');

  } catch (err) {
    console.error('❌ Database error:', err.message);
    process.exit(1);
  }
}

initDB();

module.exports = pool;