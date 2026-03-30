const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[DB] Neočekivana greška:', err);
});

const db = {
  query: (text, params) => pool.query(text, params),

  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  queryOne: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows[0] || null;
  },

  queryAll: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows;
  },
};

module.exports = db;