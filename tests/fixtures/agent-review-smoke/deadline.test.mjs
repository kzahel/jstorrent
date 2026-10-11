import assert from 'node:assert/strict';
import test from 'node:test';
import { deadlineElapsed } from './deadline.mjs';

test('deadline has not elapsed before its boundary', () => {
  assert.equal(deadlineElapsed(1000, 999), false);
});

test('deadline has elapsed at its inclusive boundary', () => {
  assert.equal(deadlineElapsed(1000, 1000), true);
});

test('deadline has elapsed after its boundary', () => {
  assert.equal(deadlineElapsed(1000, 1001), true);
});
