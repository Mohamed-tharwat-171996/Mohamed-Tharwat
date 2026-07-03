const Database = require('better-sqlite3');
const db = new Database('inventory_development.db');
console.log(db.prepare('SELECT code, name FROM users').all());
