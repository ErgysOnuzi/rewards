import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In production, derive from SESSION_SECRET which is required
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      // Fail hard - no insecure fallbacks
      throw new Error("[FATAL] Neither ENCRYPTION_KEY nor SESSION_SECRET is set. Cannot encrypt data securely.");
    }
    console.warn("[SECURITY] ENCRYPTION_KEY not set - deriving from SESSION_SECRET");
    return crypto.createHash("sha256").update(sessionSecret).digest();
  }
  if (key.length === 64) {
    return Buffer.from(key, "hex");
  }
  return crypto.createHash("sha256").update(key).digest();
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(":")) return ciphertext;
  
  try {
    const key = getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
    
    if (!ivHex || !authTagHex || !encrypted) {
      return ciphertext;
    }
    
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error("Invalid authentication tag length");
    }
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    console.error("[Encryption] Decryption failed, returning original value");
    return ciphertext;
  }
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 3 && parts[0].length === 32 && parts[1].length === 32;
}

export function hashForLookup(value: string): string {
  if (!value) return value;
  return crypto.createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}
