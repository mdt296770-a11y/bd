require('dotenv').config();
const fs = require('node:fs'); const path = require('node:path'); const pool = require('../src/db/pool');
(async()=>{try{const sql=fs.readFileSync(path.join(__dirname,'../src/db/schema.sql'),'utf8'); await pool.query(sql); console.log('Database schema is ready.');}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
