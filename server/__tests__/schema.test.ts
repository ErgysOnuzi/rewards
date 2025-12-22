import { describe, it, expect } from 'vitest';
import { 
  lookupRequestSchema, 
  spinRequestSchema, 
  withdrawRequestSchema,
  processWithdrawalSchema,
  CASE_PRIZES,
  selectCasePrize,
  validatePrizeProbabilities,
} from '../../shared/schema';

describe('Schema Validation - Real Implementation', () => {
  describe('lookupRequestSchema', () => {
    it('should accept valid stake_id', () => {
      const result = lookupRequestSchema.safeParse({ stake_id: 'testuser' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stake_id).toBe('testuser');
      }
    });

    it('should reject empty stake_id', () => {
      const result = lookupRequestSchema.safeParse({ stake_id: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing stake_id', () => {
      const result = lookupRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject non-string stake_id', () => {
      const result = lookupRequestSchema.safeParse({ stake_id: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe('spinRequestSchema', () => {
    it('should accept valid stake_id', () => {
      const result = spinRequestSchema.safeParse({ stake_id: 'player1' });
      expect(result.success).toBe(true);
    });

    it('should reject empty stake_id', () => {
      const result = spinRequestSchema.safeParse({ stake_id: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('withdrawRequestSchema', () => {
    it('should accept valid withdrawal request', () => {
      const result = withdrawRequestSchema.safeParse({
        stake_id: 'player1',
        amount: 100,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amount).toBe(100);
      }
    });

    it('should reject zero amount', () => {
      const result = withdrawRequestSchema.safeParse({
        stake_id: 'player1',
        amount: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative amount', () => {
      const result = withdrawRequestSchema.safeParse({
        stake_id: 'player1',
        amount: -50,
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing amount', () => {
      const result = withdrawRequestSchema.safeParse({
        stake_id: 'player1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('processWithdrawalSchema', () => {
    it('should accept valid approval', () => {
      const result = processWithdrawalSchema.safeParse({
        id: 1,
        status: 'approved',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid rejection with notes', () => {
      const result = processWithdrawalSchema.safeParse({
        id: 2,
        status: 'rejected',
        admin_notes: 'Suspected fraud',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = processWithdrawalSchema.safeParse({
        id: 1,
        status: 'invalid_status',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Prize System - Real Implementation', () => {
  describe('CASE_PRIZES', () => {
    it('should have valid prize definitions', () => {
      expect(Array.isArray(CASE_PRIZES)).toBe(true);
      expect(CASE_PRIZES.length).toBeGreaterThan(0);
    });

    it('should have required prize properties', () => {
      for (const prize of CASE_PRIZES) {
        expect(prize).toHaveProperty('label');
        expect(prize).toHaveProperty('value');
        expect(prize).toHaveProperty('color');
        expect(prize).toHaveProperty('probability');
        expect(typeof prize.value).toBe('number');
        expect(typeof prize.probability).toBe('number');
      }
    });

    it('should have probabilities that sum to 100', () => {
      const totalProbability = CASE_PRIZES.reduce((sum, prize) => sum + prize.probability, 0);
      expect(totalProbability).toBeCloseTo(100, 1);
    });

    it('should include losing outcomes', () => {
      const hasLoss = CASE_PRIZES.some(prize => prize.value === 0);
      expect(hasLoss).toBe(true);
    });

    it('should include winning outcomes', () => {
      const hasWin = CASE_PRIZES.some(prize => prize.value > 0);
      expect(hasWin).toBe(true);
    });
  });

  describe('selectCasePrize', () => {
    it('should return a valid prize object', () => {
      const prize = selectCasePrize(CASE_PRIZES);
      expect(prize).toHaveProperty('label');
      expect(prize).toHaveProperty('value');
      expect(prize).toHaveProperty('color');
    });

    it('should return one of the defined prizes', () => {
      const prize = selectCasePrize(CASE_PRIZES);
      const found = CASE_PRIZES.find(p => p.label === prize.label);
      expect(found).toBeDefined();
    });

    it('should produce varied results over multiple selections', () => {
      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const prize = selectCasePrize(CASE_PRIZES);
        results.add(prize.label);
      }
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('validatePrizeProbabilities', () => {
    it('should validate correct probabilities', () => {
      expect(validatePrizeProbabilities(CASE_PRIZES)).toBe(true);
    });

    it('should reject empty prize array', () => {
      expect(validatePrizeProbabilities([])).toBe(false);
    });

    it('should reject probabilities not summing to 100', () => {
      const badPrizes = [
        { label: 'A', value: 10, color: 'gold' as const, probability: 50 },
        { label: 'B', value: 0, color: 'gray' as const, probability: 30 },
      ];
      expect(validatePrizeProbabilities(badPrizes)).toBe(false);
    });
  });
});
