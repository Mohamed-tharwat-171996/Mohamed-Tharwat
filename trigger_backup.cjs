const jwt = require('jsonwebtoken');
const sqlite3 = require('better-sqlite3');
const db = new sqlite3('inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
const JWT_SECRET = 'secure_inventory_jwt_secret_key_2024';
const token = jwt.sign({ code: '18', role: 'general_manager', name: 'Admin' }, JWT_SECRET, { expiresIn: '1h' });
const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/backup/trigger',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Length': 0
  }
}, (res) => {
  res.on('data', (d) => process.stdout.write(d));
});
req.on('error', console.error);
req.end();
