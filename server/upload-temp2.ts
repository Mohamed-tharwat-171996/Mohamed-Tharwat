import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

async function verify() {
  const dbPath = path.join(process.cwd(), 'inventory_ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e_development.db');
  console.log("Reading from sqlite:", dbPath);
  const db = new Database(dbPath);
  const pastSessions = db.prepare("SELECT * FROM inventory_snapshots").all();
  console.log(`Found ${pastSessions.length} snapshots in SQLite!`);
}
verify();
