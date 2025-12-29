import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { securityHeaders, requestIdMiddleware, SESSION_CONFIG } from '../lib/security';

describe('Security Middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(requestIdMiddleware);
    app.use(securityHeaders);
    app.get('/test', (req, res) => {
      res.json({ success: true });
    });
  });

  describe('Security Headers', () => {
    it('should set Strict-Transport-Security header', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['strict-transport-security']).toBe(
        'max-age=63072000; includeSubDomains; preload'
      );
    });

    it('should set X-Frame-Options header to SAMEORIGIN', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('should set X-Content-Type-Options header', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set Referrer-Policy header', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should set Content-Security-Policy header', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'self' https://lukesdegens.com");
    });

    it('should set Permissions-Policy header', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['permissions-policy']).toContain('geolocation=()');
    });
  });

  describe('Request ID Middleware', () => {
    it('should add X-Request-ID header to response', async () => {
      const response = await request(app).get('/test');
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should generate unique request IDs', async () => {
      const response1 = await request(app).get('/test');
      const response2 = await request(app).get('/test');
      expect(response1.headers['x-request-id']).not.toBe(response2.headers['x-request-id']);
    });
  });

  describe('Session Configuration', () => {
    it('should have correct cookie name', () => {
      expect(SESSION_CONFIG.COOKIE_NAME).toBe('admin_session');
    });

    it('should have 30 minute inactivity timeout', () => {
      expect(SESSION_CONFIG.MAX_AGE_MS).toBe(30 * 60 * 1000);
    });

    it('should have 24 hour absolute timeout', () => {
      expect(SESSION_CONFIG.ABSOLUTE_TIMEOUT_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('should have httpOnly cookie option', () => {
      expect(SESSION_CONFIG.COOKIE_OPTIONS.httpOnly).toBe(true);
    });

    it('should have sameSite strict option', () => {
      expect(SESSION_CONFIG.COOKIE_OPTIONS.sameSite).toBe('strict');
    });
  });
});
