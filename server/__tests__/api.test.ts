import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { securityHeaders, requestIdMiddleware, csrfProtection } from '../lib/security';

describe('API Endpoints', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(requestIdMiddleware);
    app.use(securityHeaders);
    app.use(cookieParser());
    app.use(csrfProtection);
    app.use(express.json());
  });

  describe('GET /api/config', () => {
    beforeEach(() => {
      app.get('/api/config', (req, res) => {
        res.json({
          configured: true,
          siteName: 'LukeRewards Spins',
          prizeLabel: '$5',
        });
      });
    });

    it('should return configuration', async () => {
      const response = await request(app).get('/api/config');
      expect(response.status).toBe(200);
      expect(response.body.configured).toBe(true);
      expect(response.body.siteName).toBeDefined();
    });

    it('should include security headers', async () => {
      const response = await request(app).get('/api/config');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('GET /api/health', () => {
    beforeEach(() => {
      app.get('/api/health', (req, res) => {
        res.json({
          status: 'healthy',
          database: 'connected',
        });
      });
    });

    it('should return health status', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
    });
  });

  describe('POST /api/lookup - Input Validation', () => {
    beforeEach(() => {
      app.post('/api/lookup', (req, res) => {
        const { stake_id } = req.body;
        if (!stake_id || typeof stake_id !== 'string' || stake_id.trim() === '') {
          return res.status(400).json({ message: 'Invalid stake_id' });
        }
        res.json({
          stake_id: stake_id.toLowerCase(),
          tickets_total: 50,
          tickets_remaining: 25,
        });
      });
    });

    it('should reject empty stake_id', async () => {
      const response = await request(app)
        .post('/api/lookup')
        .send({ stake_id: '' });
      expect(response.status).toBe(400);
    });

    it('should reject missing stake_id', async () => {
      const response = await request(app)
        .post('/api/lookup')
        .send({});
      expect(response.status).toBe(400);
    });

    it('should accept valid stake_id', async () => {
      const response = await request(app)
        .post('/api/lookup')
        .send({ stake_id: 'testuser' });
      expect(response.status).toBe(200);
      expect(response.body.stake_id).toBe('testuser');
    });

    it('should normalize stake_id to lowercase', async () => {
      const response = await request(app)
        .post('/api/lookup')
        .send({ stake_id: 'TestUser' });
      expect(response.status).toBe(200);
      expect(response.body.stake_id).toBe('testuser');
    });
  });

  describe('CSRF Protection', () => {
    beforeEach(() => {
      app.post('/api/admin/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should allow requests with same origin', async () => {
      const response = await request(app)
        .post('/api/admin/test')
        .set('Origin', 'http://localhost:5000')
        .set('Host', 'localhost:5000')
        .send({});
      expect(response.status).toBe(200);
    });

    it('should allow requests from localhost variants', async () => {
      const response = await request(app)
        .post('/api/admin/test')
        .set('Origin', 'http://127.0.0.1:5000')
        .set('Host', 'localhost:5000')
        .send({});
      expect(response.status).toBe(200);
    });
  });

  describe('Error Response Format', () => {
    beforeEach(() => {
      app.post('/api/error-test', (req, res) => {
        res.status(400).json({ message: 'Validation failed' });
      });
    });

    it('should return JSON error with message field', async () => {
      const response = await request(app)
        .post('/api/error-test')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.message).toBeDefined();
      expect(typeof response.body.message).toBe('string');
    });
  });
});
