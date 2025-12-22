import express from 'express';
import cookieParser from 'cookie-parser';
import { securityHeaders, csrfProtection, requestIdMiddleware } from '../lib/security';

export function createTestApp() {
  const app = express();
  
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  
  return app;
}

export const mockWagerData = new Map<string, { stakeId: string; wageredAmount: number; periodLabel: string }>();

export function setupMockWagerData() {
  mockWagerData.clear();
  mockWagerData.set('testuser1', {
    stakeId: 'testuser1',
    wageredAmount: 50000,
    periodLabel: 'December 2025',
  });
  mockWagerData.set('testuser2', {
    stakeId: 'testuser2',
    wageredAmount: 100000,
    periodLabel: 'December 2025',
  });
  mockWagerData.set('lowroller', {
    stakeId: 'lowroller',
    wageredAmount: 500,
    periodLabel: 'December 2025',
  });
}

export function getMockWagerRow(stakeId: string) {
  return mockWagerData.get(stakeId.toLowerCase()) || null;
}

export function calculateMockTickets(wageredAmount: number): number {
  return Math.floor(wageredAmount / 1000);
}
