import { dbService } from "../database/dbService";

export interface AuditLog {
  id: number;
  user_code: string | null;
  action: string;
  target_type: string | null;
  timestamp: string;
  ip_address: string | null;
  log_details: string;
}

export class AuditService {
  // Method to securely log actions
  public static log(userCode: string | null, action: string, logDetails: string, ipAddress?: string, targetType: string = 'عام') {
    try {
      const sql = `
        INSERT INTO audit_logs (user_code, action, target_type, timestamp, ip_address, log_details)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      dbService.run(sql, [
        userCode || "SYSTEM",
        action,
        targetType,
        new Date().toISOString(),
        ipAddress || "127.0.0.1",
        logDetails
      ]);
      console.log(`[Audit Log] ${action} by ${userCode || "SYSTEM"}: ${logDetails}`);
    } catch (err) {
      console.error("Failed to write to audit log table:", err);
    }
  }

  // Method to fetch list of logs with limits
  public static getLogs(limit: number = 300): AuditLog[] {
    try {
      const sql = `
        SELECT * FROM audit_logs
        ORDER BY id DESC
        LIMIT ?
      `;
      return dbService.query(sql, [limit]) as AuditLog[];
    } catch (err) {
      console.error("Failed to query audit logs:", err);
      return [];
    }
  }
}
