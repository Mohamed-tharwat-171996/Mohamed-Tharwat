import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";
import { firestore, COLLECTIONS, setFirestoreDoc, getAppEnv } from "../services/firestoreService";

export type UserRole = "general_manager" | "system_admin" | "program_manager" | "warehouse_supervisor" | "storekeeper" | "supervisor" | "stores_manager";

export interface DBUser {
  code: string;
  name: string;
  phone?: string;
  role: UserRole;
  password?: string;
  remember_me?: number;
  is_precoded?: number;
  is_registered?: number;
  is_activated?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category?: string;
  bookQty: number;
  unit: string;
  previousDiff?: number;
}

const USE_FIRESTORE = process.env.USE_FIRESTORE !== "false";

export class DatabaseService {
  private dbs: Map<string, Database.Database> = new Map();

  constructor() {
    // Pre-initialize and migrate the default active boot environment database
    const bootEnv = getAppEnv();
    this.getDb(bootEnv);
  }

  private getDb(env: string = getAppEnv()): Database.Database {
    let db = this.dbs.get(env);
    if (!db) {
      const projectId = "ai-studio-00951ae3-ee45-4ad1-ad2a-6733dde9830e";
      const oldDbPath = path.join(process.cwd(), `inventory_${env}.db`);
      const dbPath = path.join(process.cwd(), `inventory_${projectId}_${env}.db`);
      
      // Auto-migrate: If old database exists but new one doesn't, rename it
      if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
        console.log(`📦 Universal Naming: Migrating legacy SQLite ${env} database to project-aware path...`);
        try {
          fs.renameSync(oldDbPath, dbPath);
        } catch (err) {
          console.warn(`⚠️ Failed to rename legacy database:`, err);
        }
      }

      console.log(`🔌 Connecting to isolated SQLite database for [${env.toUpperCase()}] at address [${projectId}]: ${dbPath}`);
      db = new Database(dbPath);

      // ✅ Add WAL mode and optimized settings for ephemeral container storage
      db.pragma("journal_mode = WAL");   // Prevents corruption on concurrent writes
      db.pragma("synchronous = NORMAL"); // Balances safety and performance
      db.pragma("cache_size = -64000");  // 64MB cache
      db.pragma("foreign_keys = ON");    // Enables relational integrity

      this.dbs.set(env, db);

      // Bootstrap this specific database connection
      this.initSchemaForDb(db);
      this.migrateSchemaForDb(db);
      
      // 🛡️ SECURE BOUNDARY ENFORCER: Write environment_tag directly into settings
      try {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('environment_tag', ?)").run(env);
        console.log(`🛡️ Tagged database for environment [${env.toUpperCase()}] successfully.`);
      } catch (e) {
        console.warn("⚠️ Failed to write environment_tag:", e);
      }

      this.upgradeInsecureDefaultAccountsForDb(db, env);
      this.pruneOldDeletedSessionsForDb(db);
      this.deduplicateSnapshotsForDb(db);
      this.migrateFromJSONForDb(db);
    }
    return db;
  }

  private initSchemaForDb(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        role TEXT NOT NULL,
        password TEXT NOT NULL,
        remember_me INTEGER DEFAULT 0,
        is_precoded INTEGER DEFAULT 1,
        is_registered INTEGER DEFAULT 0,
        is_activated INTEGER DEFAULT 1,
        updated_at INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        bookQty REAL DEFAULT 0,
        unit TEXT,
        previousDiff REAL DEFAULT 0,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS inventory_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        snapshot_data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_code TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        timestamp TEXT NOT NULL,
        ip_address TEXT,
        log_details TEXT
      );

      CREATE TABLE IF NOT EXISTS deleted_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        session_data TEXT NOT NULL,
        deleted_reason TEXT
      );
    `);

    try {
      db.prepare("ALTER TABLE deleted_sessions ADD COLUMN deleted_reason TEXT").run();
      console.log("🛠️ Migrated Database: Added deleted_reason column to deleted_sessions table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE audit_logs ADD COLUMN target_type TEXT").run();
      console.log("🛠️ Migrated Database: Added target_type column to audit_logs table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE inventory ADD COLUMN sort_order INTEGER DEFAULT 0").run();
      console.log("🛠️ Migrated Database: Added sort_order column to inventory table.");
    } catch (e) {}
  }

  private migrateSchemaForDb(db: Database.Database) {
    try {
      db.prepare("ALTER TABLE users ADD COLUMN is_activated INTEGER DEFAULT 1").run();
      console.log("🛠️ Migrated Database: Added is_activated column to users table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE users ADD COLUMN updated_at INTEGER DEFAULT 0").run();
      console.log("🛠️ Migrated Database: Added updated_at column to users table.");
    } catch (e) {}

    try {
      const columns = db.prepare("PRAGMA table_info(users)").all() as any[];
      const hasEmail = columns.some(c => c.name === "email");
      if (hasEmail) {
        console.log("🛠️ Migrating users table to remove the email column...");
        db.exec(`
          CREATE TABLE IF NOT EXISTS users_new (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            role TEXT NOT NULL,
            password TEXT NOT NULL,
            remember_me INTEGER DEFAULT 0,
            is_precoded INTEGER DEFAULT 1,
            is_registered INTEGER DEFAULT 0,
            is_activated INTEGER DEFAULT 1
          );
          
          INSERT INTO users_new (code, name, phone, role, password, remember_me, is_precoded, is_registered, is_activated)
          SELECT code, name, phone, role, password, remember_me, is_precoded, is_registered, is_activated FROM users;
          
          DROP TABLE users;
          ALTER TABLE users_new RENAME TO users;
        `);
        console.log("🗑️ Migrated Database: Dropped email column successfully.");
      }
    } catch (e: any) {
      console.error("⚠️ Failed to migrate users table and drop email column:", e.message);
    }
  }

  private upgradeInsecureDefaultAccountsForDb(db: Database.Database, env: string) {
    try {
      if (env === "production") {
        console.log("🛡️ Production environment detected: Bypassing local user upgrades to protect data integrity.");
        return;
      }

      const bootstrapUsers = [
        { code: '18', name: 'المدير العام', role: 'general_manager', pass: '171996' }
      ];

      for (const u of bootstrapUsers) {
        const checkUser = db.prepare("SELECT * FROM users WHERE LOWER(code) = LOWER(?)").get(u.code) as any;
        const securePass = bcrypt.hashSync(u.pass, 10);
        
        if (!checkUser) {
          db.prepare(`
            INSERT INTO users (code, name, phone, role, password, remember_me, is_precoded, is_registered, is_activated)
            VALUES (?, ?, '', ?, ?, 1, 1, 1, 1)
          `).run(u.code.trim(), u.name, u.role, securePass);
          console.log(`🚀 Bootstrapped General Manager '${u.code}' successfully inside [${env.toUpperCase()}].`);
        } else {
          db.prepare("UPDATE users SET role = 'general_manager', name = ? WHERE LOWER(code) = '18'").run(u.name);
          console.log(`🛠️ Secure Hardening: User 18 role and name validated inside [${env.toUpperCase()}] without altering existing password.`);
        }
      }
    } catch (e) {
      console.error(`⚠️ Retroactive default accounts upgrade scanner failed inside [${env.toUpperCase()}]:`, e);
    }
  }

  private pruneOldDeletedSessionsForDb(db: Database.Database) {
    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      db.prepare("DELETE FROM deleted_sessions WHERE deleted_at < ?").run(threeDaysAgo.toISOString());
    } catch (e) {
      console.error("Failed to prune old deleted sessions on startup:", e);
    }
  }

  private deduplicateSnapshotsForDb(db: Database.Database) {
    try {
      db.prepare(`
        DELETE FROM inventory_snapshots 
        WHERE id NOT IN (
          SELECT max(id) FROM inventory_snapshots GROUP BY session_id
        )
      `).run();
      console.log("Successfully deduplicated inventory_snapshots on startup.");
    } catch (e) {
      console.error("Failed to deduplicate snapshots on startup:", e);
    }
  }

  private migrateFromJSONForDb(db: Database.Database) {
    const jsonPath = path.join(process.cwd(), "db.json");
    if (!fs.existsSync(jsonPath)) return;

    try {
      const userCount = db.prepare("SELECT count(*) as count FROM users").get() as { count: number };
      if (userCount.count > 0) return;

      console.log("📦 Found legacy db.json. Performing high-security data migration to SQLite...");
      const rawData = fs.readFileSync(jsonPath, "utf-8");
      const legacy = JSON.parse(rawData);

      const precoded = legacy.precodedUsers || [];
      const registered = legacy.registeredUsers || [];
      const masterItems = legacy.masterItems || [];
      const activeSession = legacy.activeSession || null;
      const pastSessions = legacy.pastSessions || [];

      db.transaction(() => {
        const devUsersMap = new Map<string, DBUser>();

        for (const u of precoded) {
          const codeStr = String(u.code).trim();
          devUsersMap.set(codeStr, {
            code: codeStr,
            name: u.name,
            phone: u.phone || "",
            role: u.role || "storekeeper",
            password: u.password,
            remember_me: u.rememberMe ? 1 : 0,
            is_precoded: 1,
            is_registered: 0,
          });
        }

        for (const u of registered) {
          const codeStr = String(u.code).trim();
          const existing = devUsersMap.get(codeStr);
          if (existing) {
            existing.is_registered = 1;
            if (u.password) existing.password = u.password;
          } else {
            devUsersMap.set(codeStr, {
              code: codeStr,
              name: u.name,
              phone: u.phone || "",
              role: u.role || "storekeeper",
              password: u.password,
              remember_me: u.rememberMe ? 1 : 0,
              is_precoded: 1,
              is_registered: 1,
            });
          }
        }

        if (!devUsersMap.has("18")) {
          devUsersMap.set("18", {
            code: "18",
            name: "مسئول النظام - 18",
            role: "system_admin",
            password: "SystemAdmin18@Secure!",
            is_precoded: 1,
            is_registered: 1,
          });
        }
        
        devUsersMap.delete("admin");
        devUsersMap.delete("t29173995");

        const insertUser = db.prepare(`
          INSERT INTO users (code, name, phone, role, password, remember_me, is_precoded, is_registered)
          VALUES (@code, @name, @phone, @role, @password, @remember_me, @is_precoded, @is_registered)
        `);

        for (const user of devUsersMap.values()) {
          let securePass = user.password || "123";
          const isAlreadyHashed = typeof securePass === "string" && 
            securePass.length === 60 && 
            (/^\$2[aybx]\$[0-9]{2}\$/).test(securePass);

          if (!isAlreadyHashed) {
            securePass = bcrypt.hashSync(String(securePass).trim(), 10);
          }
          insertUser.run({
            code: user.code,
            name: user.name,
            phone: user.phone || "",
            role: user.role,
            password: securePass,
            remember_me: user.remember_me || 0,
            is_precoded: user.is_precoded || 0,
            is_registered: user.is_registered || 0,
          });
        }

        const insertItem = db.prepare(`
          INSERT INTO inventory (id, name, category, bookQty, unit, previousDiff, sort_order)
          VALUES (@id, @name, @category, @bookQty, @unit, @previousDiff, @sort_order)
        `);

        let legacyIdx = 0;
        for (const item of masterItems) {
          insertItem.run({
            id: String(item.id || item.itemId),
            name: item.name || item.itemName,
            category: item.category || "",
            bookQty: Number(item.bookQty) || 0,
            unit: item.unit || "كجم",
            previousDiff: Number(item.previousDiff) || 0,
            sort_order: legacyIdx++,
          });
        }

        if (activeSession) {
          db.prepare(`
            INSERT OR REPLACE INTO settings (key, value)
            VALUES ('activeSession', ?)
          `).run(JSON.stringify(activeSession));
        }

        const insertSnapshot = db.prepare(`
          INSERT INTO inventory_snapshots (session_id, date, notes, created_at, snapshot_data)
          VALUES (@session_id, @date, @notes, @created_at, @snapshot_data)
        `);

        for (const sess of pastSessions) {
          insertSnapshot.run({
            session_id: String(sess.id),
            date: sess.date || new Date().toISOString().slice(0, 10),
            notes: sess.notes || "",
            created_at: new Date().toISOString(),
            snapshot_data: JSON.stringify(sess),
          });
        }
      });
      console.log("🎉 Successfully migrated database to SQLite with bcrypt password protection!");
    } catch (migErr) {
      console.error("❌ Legacy JSON migration failed:", migErr);
    }
  }

  public query(sql: string, params: any[] = []): any[] {
    return this.getDb().prepare(sql).all(...params);
  }

  public queryOne(sql: string, params: any[] = []): any {
    return this.getDb().prepare(sql).get(...params);
  }

  public run(sql: string, params: any[] = []): Database.RunResult {
    const result = this.getDb().prepare(sql).run(...params);
    
    if (USE_FIRESTORE && firestore) {
      const upperSql = sql.trim().toUpperCase();
      if (upperSql.startsWith("INSERT") || upperSql.startsWith("UPDATE") || upperSql.startsWith("DELETE") || upperSql.startsWith("DROP")) {
         console.log("⚠️ Syncing write operation to Firestore... (Implement detailed sync logic here)");
      }
    }
    return result;
  }

  public bumpLastUpdated() {
    try {
      this.getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastUpdated', ?)").run(String(Date.now()));
    } catch (e) {
      console.warn("⚠️ Failed to bump lastUpdated timestamp:", e);
    }
  }

  public transaction<T>(fn: () => T): T {
    const db = this.getDb();
    const runTx = db.transaction(fn);
    return runTx();
  }

  public logAction(actor: string, action: string, details: string, ip: string = 'internal', targetType: string = 'عام') {
    try {
      this.getDb().prepare(`
        INSERT INTO audit_logs (user_code, action, target_type, timestamp, ip_address, log_details)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(actor, action, targetType, new Date().toISOString(), ip, details);
    } catch (err) {
      console.error("Failed to write audit log:", err);
    }
  }

  public backupDatabaseFile(destName: string) {
    const backupDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    const destPath = path.join(backupDir, destName);
    this.getDb().backup(destPath)
      .then(() => console.log(`Database backup successful: ${destName}`))
      .catch((err) => console.error("Database backup failed:", err));
  }
}

export const dbService = new DatabaseService();
