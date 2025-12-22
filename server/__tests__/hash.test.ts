import { describe, it, expect } from 'vitest';
import { hashIp } from '../lib/hash';

describe('Hash Module - Real Implementation', () => {
  describe('hashIp', () => {
    it('should return consistent hash for same IP', () => {
      const ip = '192.168.1.100';
      const hash1 = hashIp(ip);
      const hash2 = hashIp(ip);
      
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different IPs', () => {
      const hash1 = hashIp('10.0.0.1');
      const hash2 = hashIp('10.0.0.2');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should return a string', () => {
      const hash = hashIp('127.0.0.1');
      expect(typeof hash).toBe('string');
    });

    it('should handle IPv6 addresses', () => {
      const hash = hashIp('::1');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
      const hash = hashIp('');
      expect(typeof hash).toBe('string');
    });
  });
});
