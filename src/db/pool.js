const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
pool.on('error', err => console.error('Unexpected PostgreSQL pool error', err));
module.exports = pool;
