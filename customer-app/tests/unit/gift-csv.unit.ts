import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv, recipientProblems, recipientsFromCsv } from '../../src/gift-csv.ts'

// The recipients CSV of a gift order to many (MULTI_GIFT), read in the browser.
// The API checks every recipient again; these are the buyer's early warnings.

const BOXES = [
  { sku: 'ALP-3', name: 'Alphonso 3kg Box' },
  { sku: 'BAD-5', name: 'Badami 5kg Box' },
]
const HEAD = '"name","phone","address","pincode","box","ripeness","boxes","note"'

test('quoted cells, doubled quotes, commas and line breaks inside quotes, CRLF and a BOM', () => {
  const rows = parseCsv('﻿a,"b, c","say ""hi"""\r\n"two\nlines",x,\r\n\r\n')
  assert.deepEqual(rows, [
    ['a', 'b, c', 'say "hi"'],
    ['two\nlines', 'x', ''],
  ])
})

test('the template as the API serves it reads back as one recipient', () => {
  const csv = `${HEAD}\r\n"Asha Rao","9876543210","Flat 4B, Lake View Apartments, Indiranagar, Bengaluru","560038","ALP-3","RIPE","1","Happy Diwali from all of us!"\r\n`
  const { recipients, problems } = recipientsFromCsv(csv, BOXES, 25)
  assert.deepEqual(problems, [])
  assert.deepEqual(recipients, [
    {
      name: 'Asha Rao', phone: '9876543210', address: 'Flat 4B, Lake View Apartments, Indiranagar, Bengaluru', pincode: '560038',
      sku: 'ALP-3', stage: 'RIPE', qty: 1, note: 'Happy Diwali from all of us!',
    },
  ])
})

test('boxes by code or name, ripeness in words, and the formula guard taken off', () => {
  const csv = `name,phone,address,pincode,box,ripeness,boxes,note\n'=Ravi,+91 98765 43210,"12, MG Road, Bengaluru",560001,badami 5kg box,Semi-ripe,2,'-with love\n`
  const { recipients, problems } = recipientsFromCsv(csv, BOXES, 25)
  assert.deepEqual(problems, [])
  assert.equal(recipients[0].name, '=Ravi')
  assert.equal(recipients[0].sku, 'BAD-5')
  assert.equal(recipients[0].stage, 'SEMI_RIPE')
  assert.equal(recipients[0].qty, 2)
  assert.equal(recipients[0].note, '-with love')
})

test('every row problem is reported by row, and too many rows are refused', () => {
  const csv = [HEAD, '"A","9876543210","12, MG Road, Bengaluru","560001","ALP-3","RIPE","1",""', '"","123","short","5600","Mango","green","0",""'].join('\n')
  const { problems } = recipientsFromCsv(csv, BOXES, 25)
  const row2 = problems.filter((p) => p.row === 2).map((p) => p.field).sort()
  assert.deepEqual(row2, ['address', 'name', 'phone', 'pincode', 'qty', 'sku', 'stage'])
  assert.equal(problems.filter((p) => p.row === 1).length, 0)
  const many = [HEAD, ...Array.from({ length: 4 }, () => '"A","9876543210","12, MG Road, Bengaluru","560001","ALP-3","RIPE","1",""')].join('\n')
  const capped = recipientsFromCsv(many, BOXES, 3)
  assert.equal(capped.recipients.length, 3)
  assert.match(capped.problems[0].message, /up to 3 recipients; this file has 4/)
})

test('a file without the template header says what is missing', () => {
  const { problems } = recipientsFromCsv('who,where\nA,B\n', BOXES, 25)
  assert.equal(problems[0].row, 0)
  assert.match(problems[0].message, /Missing: name, phone, address, pincode, box, ripeness, boxes/)
  assert.equal(recipientsFromCsv('', BOXES, 25).problems[0].message, 'The file is empty.')
})

test('the quick checks on one recipient', () => {
  assert.deepEqual(recipientProblems({ name: 'A', phone: '09876543210', address: '12, MG Road, Bengaluru', pincode: '560001', sku: 'ALP-3', stage: 'RIPE', qty: 1 }), [])
  assert.deepEqual(
    recipientProblems({ name: ' ', phone: '5', address: 'x', pincode: '1', sku: 'ALP-3', stage: 'RIPE', qty: 0, note: 'n'.repeat(201) }).map((p) => p.field),
    ['name', 'phone', 'address', 'pincode', 'qty', 'note'],
  )
})
