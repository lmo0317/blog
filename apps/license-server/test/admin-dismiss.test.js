import test from 'node:test';
import assert from 'node:assert/strict';
import { LicenseDatabase } from '../lib/db.js';
import { InsightsService } from '../lib/insights-service.js';
test('dismissed to-do cards are shared and expire', () => {
  let now = Date.parse('2026-10-20T00:00:00Z');
  const db = new LicenseDatabase(':memory:');
  const s = new InsightsService(db, { now: () => now });
  s.dismiss(['err-4-x']); s.dismiss('ver-4-1.0.31');
  assert.deepEqual(Object.keys(new InsightsService(db, { now: () => now }).dismissed()).sort(), ['err-4-x', 'ver-4-1.0.31']);
  now += 31 * 86400000; s.dismiss('buy-a');
  assert.deepEqual(Object.keys(s.dismissed()), ['buy-a']);
  s.dismiss([], { reset: true }); assert.deepEqual(s.dismissed(), {});
});
