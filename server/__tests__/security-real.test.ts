import { describe, it, expect, beforeEach } from 'vitest';
import { 
  generateCSRFToken, 
  validateCSRFToken, 
  sanitizeStakeId,
  hashForLogging,
  SESSION_CONFIG,
  logSecurityEvent,
  getRecentSecurityEvents,
  escapeHtml,
} from '../lib/security';

describe('Security Module - Real Implementation', () => {
  describe('CSRF Token Functions', () => {
    it('generateCSRFToken should create a 64-character hex token', () => {
      const sessionId = 'test-session-123';
      const token = generateCSRFToken(sessionId);
      
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it('generateCSRFToken should create unique tokens for same session', () => {
      const sessionId = 'test-session-456';
      const token1 = generateCSRFToken(sessionId);
      const token2 = generateCSRFToken(sessionId);
      
      expect(token1).not.toBe(token2);
    });

    it('validateCSRFToken should return false for empty inputs', () => {
      expect(validateCSRFToken('', '')).toBe(false);
      expect(validateCSRFToken('session', '')).toBe(false);
      expect(validateCSRFToken('', 'token')).toBe(false);
    });

    it('validateCSRFToken should validate correctly generated tokens', () => {
      const sessionId = 'valid-session-789';
      const token = generateCSRFToken(sessionId);
      
      expect(validateCSRFToken(sessionId, token)).toBe(true);
    });

    it('validateCSRFToken should reject invalid tokens', () => {
      const sessionId = 'another-session';
      generateCSRFToken(sessionId);
      
      expect(validateCSRFToken(sessionId, 'invalid-token')).toBe(false);
      expect(validateCSRFToken(sessionId, 'a'.repeat(64))).toBe(false);
    });

    it('validateCSRFToken should reject tokens from different sessions', () => {
      const session1 = 'session-1';
      const session2 = 'session-2';
      const token1 = generateCSRFToken(session1);
      
      expect(validateCSRFToken(session2, token1)).toBe(false);
    });
  });

  describe('Input Sanitization', () => {
    it('sanitizeStakeId should lowercase input', () => {
      expect(sanitizeStakeId('TestUser')).toBe('testuser');
      expect(sanitizeStakeId('ALLCAPS')).toBe('allcaps');
    });

    it('sanitizeStakeId should remove special characters', () => {
      expect(sanitizeStakeId('user<script>')).toBe('userscript');
      expect(sanitizeStakeId('user@domain.com')).toBe('userdomaincom');
      expect(sanitizeStakeId('user with spaces')).toBe('userwithspaces');
    });

    it('sanitizeStakeId should allow alphanumeric, underscore, hyphen', () => {
      expect(sanitizeStakeId('user_name-123')).toBe('user_name-123');
      expect(sanitizeStakeId('player123')).toBe('player123');
    });

    it('sanitizeStakeId should truncate long inputs', () => {
      const longInput = 'a'.repeat(200);
      expect(sanitizeStakeId(longInput)).toHaveLength(100);
    });

    it('sanitizeStakeId should handle non-string inputs', () => {
      expect(sanitizeStakeId(null as any)).toBe('');
      expect(sanitizeStakeId(undefined as any)).toBe('');
      expect(sanitizeStakeId(123 as any)).toBe('');
    });

    it('escapeHtml should escape HTML entities', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
      expect(escapeHtml("it's")).toBe("it&#x27;s");
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });
  });

  describe('IP Hashing', () => {
    it('hashForLogging should return consistent hash for same IP', () => {
      const ip = '192.168.1.1';
      const hash1 = hashForLogging(ip);
      const hash2 = hashForLogging(ip);
      
      expect(hash1).toBe(hash2);
    });

    it('hashForLogging should return different hashes for different IPs', () => {
      const hash1 = hashForLogging('192.168.1.1');
      const hash2 = hashForLogging('192.168.1.2');
      
      expect(hash1).not.toBe(hash2);
    });

    it('hashForLogging should return 16-character hash', () => {
      const hash = hashForLogging('10.0.0.1');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('Session Configuration', () => {
    it('should have secure cookie settings', () => {
      expect(SESSION_CONFIG.COOKIE_OPTIONS.httpOnly).toBe(true);
      expect(SESSION_CONFIG.COOKIE_OPTIONS.sameSite).toBe('strict');
    });

    it('should have appropriate timeout values', () => {
      expect(SESSION_CONFIG.MAX_AGE_MS).toBe(30 * 60 * 1000);
      expect(SESSION_CONFIG.ABSOLUTE_TIMEOUT_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('should use correct cookie name', () => {
      expect(SESSION_CONFIG.COOKIE_NAME).toBe('admin_session');
    });
  });

  describe('Security Event Logging', () => {
    it('should log security events', () => {
      const beforeCount = getRecentSecurityEvents().length;
      
      logSecurityEvent({
        type: 'auth_failure',
        ipHash: 'test-hash-123',
        details: 'Test auth failure',
      });
      
      const afterCount = getRecentSecurityEvents().length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });

    it('should retrieve recent events with correct structure', () => {
      logSecurityEvent({
        type: 'access_denied',
        ipHash: 'test-hash-456',
        stakeId: 'testuser',
        details: 'Test access denied',
      });
      
      const events = getRecentSecurityEvents(1);
      expect(events.length).toBeGreaterThan(0);
      
      const event = events[0];
      expect(event.type).toBeDefined();
      expect(event.ipHash).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should limit returned events', () => {
      for (let i = 0; i < 10; i++) {
        logSecurityEvent({
          type: 'auth_success',
          ipHash: `hash-${i}`,
        });
      }
      
      const events = getRecentSecurityEvents(5);
      expect(events.length).toBeLessThanOrEqual(5);
    });
  });
});
