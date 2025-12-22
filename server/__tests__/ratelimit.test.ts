import { describe, it, expect, beforeEach } from 'vitest';
import { isRateLimited, isStakeIdRateLimited } from '../lib/rateLimit';

describe('Rate Limiting - Real Implementation', () => {
  describe('isRateLimited (IP-based)', () => {
    it('should not rate limit first request', () => {
      const uniqueIp = `test-ip-${Date.now()}-${Math.random()}`;
      expect(isRateLimited(uniqueIp)).toBe(false);
    });

    it('should track multiple requests from same IP', () => {
      const ip = `multi-request-ip-${Date.now()}`;
      
      for (let i = 0; i < 5; i++) {
        isRateLimited(ip);
      }
      
      expect(isRateLimited(ip)).toBe(false);
    });
  });

  describe('isStakeIdRateLimited (Account-based)', () => {
    it('should not rate limit first request for stake ID', () => {
      const uniqueStakeId = `test-stake-${Date.now()}-${Math.random()}`;
      expect(isStakeIdRateLimited(uniqueStakeId)).toBe(false);
    });

    it('should track multiple requests from same stake ID', () => {
      const stakeId = `multi-stake-${Date.now()}`;
      
      for (let i = 0; i < 5; i++) {
        isStakeIdRateLimited(stakeId);
      }
      
      expect(isStakeIdRateLimited(stakeId)).toBe(false);
    });
  });
});
