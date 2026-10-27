import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gstinCheckChar, gstinProblem, tidyGstin } from '../../src/gstin.ts'

// The shop's GSTIN check at checkout, the same rule the API applies (mango-api/src/gstin.js).

test('a GSTIN with the right check character passes, tidied first', () => {
  // A GSTIN published as a worked example of the check character.
  assert.equal(gstinProblem('27AAPFU0939F1ZV'), null)
  assert.equal(gstinProblem(' 27aapfu0939f1zv '), null)
  assert.equal(tidyGstin(' 27aa pfu0939f1zv'), '27AAPFU0939F1ZV')
  assert.equal(gstinCheckChar('29ABCDE1234F1Z'), 'W', 'the example in the checkout hint is a valid GSTIN')
  assert.equal(gstinProblem('29ABCDE1234F1ZW'), null)
})

test('typos, wrong lengths, bad shapes and unknown states are refused in words', () => {
  assert.match(gstinProblem('27AAPFU0939F1ZW') ?? '', /typo/)
  assert.match(gstinProblem('27AAPFU0939F1Z') ?? '', /15 characters; this has 14/)
  assert.match(gstinProblem('2AAAPFU0939F1ZV') ?? '', /not a GSTIN/)
  assert.match(gstinProblem(`00AAPFU0939F1Z${gstinCheckChar('00AAPFU0939F1Z')}`) ?? '', /not a GSTIN/)
  assert.match(gstinProblem('') ?? '', /Enter the GSTIN/)
})
