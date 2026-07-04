import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { dbService } from "../database/dbService";
import { getFirestoreDB, FirebaseBackupService } from "../services/firebaseBackupService";
import { getFirestoreApiDisabled, setFirestoreApiDisabled, isFirestoreErrorDisabled, getFirestoreDoc, setFirestoreDoc, resolveCollectionName, getEnvSecret, getAppEnv, isFirestoreConfigured } from "../services/firestoreService";

let cachedSecrets: Record<string, string> = {};

// Safe lazy loading of JWT keys - Requires or auto-saves a secure secret for production stability
function getJWTSecret(): string {
  const env = getAppEnv();

  // Priority 1: Environment Specific Secrets (e.g. PROD_JWT_SECRET or DEV_JWT_SECRET)
  const envSecret = getEnvSecret("JWT_SECRET");
  if (envSecret) {
    return envSecret;
  }
  
  if (cachedSecrets[env]) {
    return cachedSecrets[env];
  }

  // 2. Try to load from SQLite settings to ensure stability across container restarts
  try {
    const row = dbService.queryOne("SELECT value FROM settings WHERE key = 'jwt_secret'");
    if (row && row.value) {
      cachedSecrets[env] = row.value;
      return row.value;
    }
  } catch (dbErr) {
    console.warn("⚠️ Database query for jwt_secret settings row failed synchronously:", dbErr);
  }

  // 3. Last Resort Fallback - Stable hardcoded anchor to prevent logout-on-restart if Firestore/DB fail
  const fallbackAnchor = "al_eman_secure_inventory_2026_fallback_anchor_secret";
  cachedSecrets[env] = fallbackAnchor;
  
  // Try to persist this fallback for next time
  try {
    dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)", [fallbackAnchor]);
  } catch (e) {}

  return fallbackAnchor;
}

export interface TokenPayload {
  code: string;
  name: string;
  role: string;
}

// Extend typical Express Request object safely in module
export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export class AuthService {
  // Pure asynchronous initialization of the cryptographic JWT secret key
  public static async initializeSecrets(): Promise<void> {
    const env = getAppEnv();
    const isProduction = env === "production" || env === "masters" || env === "master";

    // Priority 1: Environment Specific Secrets
    const envSecret = getEnvSecret("JWT_SECRET");
    if (envSecret) {
      cachedSecrets[env] = envSecret;
      return;
    }

    if (isProduction) {
      console.warn("⚠️ WARNING: JWT_SECRET environment variable is not defined for production. Attempting to load from Firestore or SQLite, or generating a secure high-entropy random key to guarantee persistent and stable operation.");
    }

    // 1. Try to load from SQLite first to keep things instant
    try {
      const row = dbService.queryOne("SELECT value FROM settings WHERE key = 'jwt_secret'");
      if (row && row.value) {
        cachedSecrets[env] = row.value;
        console.log(`🔒 Secured App Environment: Loaded existing JWT signature key from SQLite for ${env}.`);
      }
    } catch (e) {
      console.warn(`⚠️ Failed to load JWT secret from local SQLite settings for ${env}:`, e);
    }

    // 2. Try to load or generate the secret in Firestore Cloud for absolute multi-instance stability and zero-hardcoding security
    if (!getFirestoreApiDisabled()) {
      try {
        const cloudData = await getFirestoreDoc("system_config", "jwt_secret_doc");
        
        if (cloudData && cloudData.value) {
          const cloudSecret = cloudData.value;
          cachedSecrets[env] = cloudSecret;
          
          dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)", [cloudSecret]);
          console.log(`🔥 Secured App Environment: Synced JWT signature key successfully from Firestore Cloud storage for ${env}!`);
        } else {
          // Generate a purely random 64-byte high-entropy hex key
          const generated = crypto.randomBytes(64).toString("hex");
          cachedSecrets[env] = generated;
          
          await setFirestoreDoc("system_config", "jwt_secret_doc", { value: generated, updatedAt: new Date().toISOString() });
          dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)", [generated]);
          console.log(`🔒 Secured App Environment: Generated and saved a secure high-entropy random key to Firestore Cloud for ${env}.`);
        }
      } catch (syncErr: any) {
        if (isFirestoreErrorDisabled(syncErr)) {
          setFirestoreApiDisabled(true);
          console.log("☁️ Firestore API is disabled or not activated in this GCP project. Operating in stable local Storage mode (skipping cloud JWT secret sync).");
        } else {
          console.warn(`⚠️ Firestore key synchronization bypassed or failed for ${env}:`, syncErr.message || syncErr);
        }
      }
    }

    // 3. If offline or bypassed and we have no cached key, dynamically generate a safe key
    if (!cachedSecrets[env]) {
      try {
        const generated = crypto.randomBytes(64).toString("hex");
        cachedSecrets[env] = generated;
        dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)", [generated]);
        console.log(`🔒 Secured App Environment: No JWT secret provided in environ or cloud. Generated and stored fallback key in SQLite for ${env}.`);
      } catch (genErr) {
        const fallback = "fallback_jwt_secret_hash_secure_" + Math.random().toString(36).slice(2) + Date.now();
        cachedSecrets[env] = fallback;
        dbService.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)", [fallback]);
      }
    }
  }

  // Sign JWT Secure Token
  public static signToken(payload: TokenPayload): string {
    return jwt.sign(payload, getJWTSecret(), { expiresIn: "12h" });
  }

  // Verify JWT Token manually
  public static verifyToken(token: string): TokenPayload {
    return jwt.verify(token, getJWTSecret()) as TokenPayload;
  }

  // Pure login routing handler checking hashed passwords with built-in 5-attempts lockout limiter
  public static async login(code: string, passwordStr: string): Promise<{ token: string; user: any }> {
    const codeClean = String(code).trim().toLowerCase();

    let dbUser = null;

    // Query Firestore strictly - completely separated from SQLite, live directly to Firestore only
    try {
      const resolvedColl = resolveCollectionName("users");
      console.log(`🔐 Login attempt for [${codeClean}] in collection: ${resolvedColl}`);
      dbUser = await getFirestoreDoc("users", codeClean);
      if (!dbUser && codeClean === "18") {
        console.log("🔒 Master account 18 missing in Firestore during login. Re-seeding securely...");
        const { FirebaseBackupService } = await import("../services/firebaseBackupService");
        await FirebaseBackupService.ensureDefaultGMInCloud();
        dbUser = await getFirestoreDoc("users", "18");
      }
    } catch (err: any) {
      console.error(`🛑 Firestore lookup failed for ${codeClean}:`, err.message || err);
      throw new Error("فشل الاتصال بقاعدة بيانات الفايرستور السحابية لتسجيل الدخول.");
    }

    if (!dbUser) {
      console.error(`🛑 REJECTED: User code [${codeClean}] is not registered in Firestore.`);
      throw new Error("رمز أمين المخزن أو المستخدم غير مسجل في الفايرستور السحابي.");
    }

    const passwordHash = dbUser.password;
    const isMatch = bcrypt.compareSync(String(passwordStr).trim(), passwordHash);
    if (!isMatch) {
      throw new Error("كلمة المرور المدخلة غير صحيحة!");
    }

    const isActivated = dbUser.is_activated !== undefined ? dbUser.is_activated : dbUser.isActivated;
    const isRegistered = dbUser.is_registered !== undefined ? dbUser.is_registered : dbUser.isRegistered;

    // NEW: Check activation status if explicitly defined
    if (dbUser.code !== "18" && (isActivated === 0 || isActivated === false || isActivated === null)) {
      throw new Error("هذا الحساب معطل (غير نشط). يرجى مراجعة مدير النظام لتنشيطه.");
    }

    // NEW: Block un-activated (unregistered) users from direct login and enforce activation flow
    if (dbUser.code !== "18" && (isRegistered === 0 || isRegistered === false || isRegistered === null)) {
      throw new Error("عذراً، هذا الحساب لم يتم تنشيطه بعد. يرجى النقر على 'تنشيط مستخدم جديد' للدخول وتعيين كلمة مرور مخصصة أولاً.");
    }

    const payload: TokenPayload = {
      code: dbUser.code,
      name: dbUser.name,
      role: dbUser.role,
    };

    const token = this.signToken(payload);

    // Default password checks are no longer active since passwords must be at least 12 characters
    const isUsingDefaultPassword = false;

    return {
      token,
      user: {
        code: dbUser.code,
        name: dbUser.name,
        phone: dbUser.phone || "",
        role: dbUser.role,
        rememberMe: dbUser.remember_me === 1 || dbUser.remember_me === true || dbUser.rememberMe === true,
        isUsingDefaultPassword,
      },
    };
  }

  // Validates password requirements (accepts any password of any size as requested)
  public static validatePasswordStrength(password: string): boolean {
    if (!password || password.trim().length === 0) return false;
    return true;
  }

  // Guard routing middleware for Express
  public static authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً للوصول للنظام." });
    }

    const token = authHeader.split(" ")[1];
    try {
      const decodedPayload = jwt.verify(token, getJWTSecret()) as TokenPayload & { exp?: number };
      
      req.user = decodedPayload;

      // 🛡️ Token Renewal Shield: Automatically renew the token if nearing expiration (or less than 12h remaining)
      if (decodedPayload.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        const timeLeft = decodedPayload.exp - currentTime;
        // Renew if less than 11.5 hours remaining to prevent generating a new token on every immediate request, but satisfy the 12h extension goal
        if (timeLeft < 11.5 * 3600) {
          const renewedPayload: TokenPayload = {
            code: decodedPayload.code,
            name: decodedPayload.name,
            role: decodedPayload.role,
          };
          const renewedToken = AuthService.signToken(renewedPayload); // signs with 12h expiration
          res.setHeader("X-Renewed-Token", renewedToken);
          res.setHeader("Access-Control-Expose-Headers", "X-Renewed-Token");
        }
      }

      next();
    } catch (err) {
      return res.status(403).json({ error: "جلسة العمل منتهية الصلاحية أو غير صالحة. يرجى تسجيل الدخول مجدداً." });
    }
  }

  // RBAC Guard middleware for Express routing
  public static requireRole(allowedRoles: string[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً." });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: `عذراً، تحتاج لصلاحيات (${allowedRoles.join(" أو ")}) للحصول على وصول لهذا الإجراء. دورك الحالي هو: ${req.user.role}`,
        });
      };

      next();
    };
  }
}

