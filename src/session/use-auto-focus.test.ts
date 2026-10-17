/**
 * use-auto-focus.ts — the session alias is the contract-tier hook itself (one implementation).
 */
import { describe, expect, it } from 'vitest';
import { useAutoFocus as shared } from '../shared/ui/use-auto-focus';
import { useAutoFocus } from './use-auto-focus';

describe('useAutoFocus (session alias)', () => {
  it('is the shared/ui hook, not a copy', () => {
    expect(useAutoFocus).toBe(shared);
  });
});
