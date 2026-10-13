'use strict';

/**
 * The weekly survey is off unless FREE_SURVEY=on (owner, 2026-10-13): no
 * SURVEY_REQUIRED, no due date (so no reminder); the channel gate is
 * unchanged. When it is on, a question marked "(ixtiyoriy)" may stay empty.
 *
 *   node tests/free-survey.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tiers = fs.readFileSync(path.join(__dirname, '../src/rag/subscription-tiers.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');

assert.ok(/const surveyOn = \(\) => String\(process\.env\.FREE_SURVEY \|\| 'off'\)\.trim\(\)\.toLowerCase\(\) === 'on';/u.test(tiers), 'off by default');
assert.ok(/if \(surveyOn\(\) && Date\.now\(\) >= surveyDue && !row\.survey_completed_at\) \{\s*return \{ allowed: false, code: 'SURVEY_REQUIRED'/u.test(tiers), 'SURVEY_REQUIRED only when on');
assert.ok(/surveyDueAt: surveyOn\(\) \? new Date\(surveyDue\)\.toISOString\(\) : null,/u.test(tiers), 'no due date (no reminder) when off');
assert.ok(/return \{ allowed: false, code: 'CHANNEL_REQUIRED'/u.test(tiers), 'the channel gate stays');
// the dashboard's reminder needs a due date; the optional question may stay empty
assert.ok(/if \(!st \|\| st\.surveyCompleted \|\| !st\.surveyDueAt\) return;/u.test(page));
assert.ok(/if \(!val && \/ixtiyoriy\/i\.test\(q\.question_text \|\| ''\)\) continue;/u.test(page));

console.log('free survey: off by default, optional question optional - OK');
