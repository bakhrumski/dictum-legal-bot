'use strict';

const fs = require('fs');
const path = require('path');

const CONSTITUTION_PATH = path.join(__dirname, '..', 'prompts', 'core-legal-constitution.md');
const LEGAL_RESEARCH_PLAYBOOK_PATH = path.join(
  __dirname,
  '..',
  'prompts',
  'universal-legal-research-playbook.md'
);

const documentCache = new Map();

function readPolicyDocument(filePath) {
  if (!documentCache.has(filePath)) {
    documentCache.set(filePath, fs.readFileSync(filePath, 'utf8').trim());
  }
  return documentCache.get(filePath);
}

function extractVersion(text, label) {
  const match = String(text || '').match(new RegExp(`^${label}:\\s*([^\\s]+)$`, 'mi'));
  return match ? match[1] : 'unknown';
}

function getCoreLegalConstitution() {
  return readPolicyDocument(CONSTITUTION_PATH);
}

function getConstitutionVersion() {
  return extractVersion(getCoreLegalConstitution(), 'Constitution-Version');
}

function getLegalResearchPlaybook() {
  return readPolicyDocument(LEGAL_RESEARCH_PLAYBOOK_PATH);
}

function getLegalResearchPlaybookVersion() {
  return extractVersion(getLegalResearchPlaybook(), 'Playbook-Version');
}

function getLegalPolicyVersions() {
  return Object.freeze({
    constitution: getConstitutionVersion(),
    legalResearch: getLegalResearchPlaybookVersion(),
  });
}

/**
 * Compose the stable policy prefix in strict precedence order.
 *
 * Keep per-user data, retrieved evidence, domain directives and output schemas
 * out of this function. That makes the prefix reusable for prompt caching and
 * prevents lower-priority instructions from appearing before the constitution.
 */
function buildLegalResearchPolicyPrefix() {
  return [
    'ASOSIY HUQUQIY KONSTITUTSIYA (eng yuqori ustuvorlik; ichki):',
    getCoreLegalConstitution(),
    'HUQUQIY MASLAHAT VA TADQIQOT PLAYBOOKI (konstitutsiyaga bo\'ysunadi; ichki):',
    getLegalResearchPlaybook(),
  ].join('\n\n');
}

/**
 * Capabilities without a dedicated playbook still inherit the constitution.
 * Their capability-specific contract is appended by the owning prompt builder.
 */
function buildCoreLegalPolicyPrefix() {
  return [
    'ASOSIY HUQUQIY KONSTITUTSIYA (eng yuqori ustuvorlik; ichki):',
    getCoreLegalConstitution(),
  ].join('\n\n');
}

module.exports = {
  CONSTITUTION_PATH,
  LEGAL_RESEARCH_PLAYBOOK_PATH,
  getCoreLegalConstitution,
  getConstitutionVersion,
  getLegalResearchPlaybook,
  getLegalResearchPlaybookVersion,
  getLegalPolicyVersions,
  buildCoreLegalPolicyPrefix,
  buildLegalResearchPolicyPrefix,
};
