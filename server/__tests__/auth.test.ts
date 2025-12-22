import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { securityHeaders, requestIdMiddleware, csrfProtection, SESSION_CONFIG } from '../lib/security';

describe('Admin Authentication', () => {
  let app: express.Express;
  const testAdminPassword = 'test-admin-password-123';
  const sessions = new Map<string, { token: string; expiresAt: Date; lastActivityAt: Date }>();

  beforeEach(() => {
    sessions.clear();
    app = express();
    app.use(requestIdMiddleware);
    app.use(securityHeaders);
    app.use(cookieParser());
    app.use(csrfProtection);
    app.use(express.json());

    process.env.ADMIN_PASSWORD = testAdminPassword;

    app.post('/api/admin/login', (req, res) => {
      const { password } = req.body;
      
      if (!password) {
        return res.status(400).json({ message: 'Password required' });
      }
      
      if (password !== testAdminPassword) {
        return res.status(401).json({ message: 'Invalid password' });
      }

      const sessionToken = 'test-session-token-' + Date.now();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      sessions.set(sessionToken, {
        token: sessionToken,
        expiresAt,
        lastActivityAt: new Date(),
      });

      res.cookie(SESSION_CONFIG.COOKIE_NAME, sessionToken, {
        ...SESSION_CONFIG.COOKIE_OPTIONS,
        expires: expiresAt,
      });

      return res.json({ success: true });
    });

    app.post('/api/admin/logout', (req, res) => {
      const sessionToken = req.cookies?.[SESSION_CONFIG.COOKIE_NAME];
      if (sessionToken) {
        sessions.delete(sessionToken);
      }
      res.clearCookie(SESSION_CONFIG.COOKIE_NAME);
      return res.json({ success: true });
    });

    app.get('/api/admin/verify', (req, res) => {
      const sessionToken = req.cookies?.[SESSION_CONFIG.COOKIE_NAME];
      const session = sessionToken ? sessions.get(sessionToken) : null;
      const isValid = session && session.expiresAt > new Date();
      return res.json({ authenticated: isValid });
    });

    app.get('/api/admin/protected', (req, res) => {
      const sessionToken = req.cookies?.[SESSION_CONFIG.COOKIE_NAME];
      const session = sessionToken ? sessions.get(sessionToken) : null;
      
      if (!session || session.expiresAt < new Date()) {
        return res.status(401).json({ message: 'Admin authentication required' });
      }
      
      return res.json({ data: 'protected content' });
    });
  });

  describe('POST /api/admin/login', () => {
    it('should reject missing password', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({});
      expect(response.status).toBe(400);
    });

    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({ password: 'wrong-password' });
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid password');
    });

    it('should accept correct password', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({ password: testAdminPassword });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should set session cookie on successful login', async () => {
      const response = await request(app)
        .post('/api/admin/login')
        .send({ password: testAdminPassword });
      expect(response.status).toBe(200);
      
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain(SESSION_CONFIG.COOKIE_NAME);
      expect(cookies[0]).toContain('HttpOnly');
    });
  });

  describe('POST /api/admin/logout', () => {
    it('should clear session cookie', async () => {
      const loginResponse = await request(app)
        .post('/api/admin/login')
        .send({ password: testAdminPassword });
      
      const cookies = loginResponse.headers['set-cookie'];
      const sessionCookie = cookies[0].split(';')[0];

      const logoutResponse = await request(app)
        .post('/api/admin/logout')
        .set('Cookie', sessionCookie);
      
      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.body.success).toBe(true);
    });
  });

  describe('GET /api/admin/verify', () => {
    it('should return false for unauthenticated request', async () => {
      const response = await request(app).get('/api/admin/verify');
      expect(response.status).toBe(200);
      expect(response.body.authenticated).toBeFalsy();
    });

    it('should return true for authenticated request', async () => {
      const loginResponse = await request(app)
        .post('/api/admin/login')
        .send({ password: testAdminPassword });
      
      const cookies = loginResponse.headers['set-cookie'];
      const sessionCookie = cookies[0].split(';')[0];

      const verifyResponse = await request(app)
        .get('/api/admin/verify')
        .set('Cookie', sessionCookie);
      
      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.authenticated).toBe(true);
    });
  });

  describe('Protected Admin Routes', () => {
    it('should reject unauthenticated access', async () => {
      const response = await request(app).get('/api/admin/protected');
      expect(response.status).toBe(401);
      expect(response.body.message).toContain('authentication required');
    });

    it('should allow authenticated access', async () => {
      const loginResponse = await request(app)
        .post('/api/admin/login')
        .send({ password: testAdminPassword });
      
      const cookies = loginResponse.headers['set-cookie'];
      const sessionCookie = cookies[0].split(';')[0];

      const protectedResponse = await request(app)
        .get('/api/admin/protected')
        .set('Cookie', sessionCookie);
      
      expect(protectedResponse.status).toBe(200);
      expect(protectedResponse.body.data).toBe('protected content');
    });
  });
});
