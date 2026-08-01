import { readFile } from 'node:fs/promises';

const auditPath = process.argv[2];
if (!auditPath) {
  throw new Error('Usage: node scripts/ci/validate-npm-audit.mjs <npm-audit.json>');
}

const report = JSON.parse(await readFile(auditPath, 'utf8'));
const vulnerabilities = report.vulnerabilities ?? {};
const expectedPackages = ['react-router', 'react-router-dom'];
const actualPackages = Object.keys(vulnerabilities).sort();

if (JSON.stringify(actualPackages) !== JSON.stringify(expectedPackages)) {
  throw new Error(
    `Unexpected npm audit findings: expected ${expectedPackages.join(', ')}, got ${actualPackages.join(', ') || 'none'}`,
  );
}

const router = vulnerabilities['react-router'];
const routerDom = vulnerabilities['react-router-dom'];
const advisoryUrl = 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2';

if (router.severity !== 'high' || routerDom.severity !== 'high') {
  throw new Error('The two accepted React Router findings must remain high severity.');
}

const routerAdvisories = (router.via ?? [])
  .filter((entry) => entry && typeof entry === 'object')
  .map((entry) => entry.url);
if (routerAdvisories.length !== 1 || routerAdvisories[0] !== advisoryUrl) {
  throw new Error(`react-router must resolve only to the documented ${advisoryUrl} finding.`);
}

if (
  !Array.isArray(routerDom.via)
  || routerDom.via.length !== 1
  || routerDom.via[0] !== 'react-router'
) {
  throw new Error('react-router-dom must be reported only through react-router.');
}

const counts = report.metadata?.vulnerabilities ?? {};
if (
  counts.total !== 2
  || counts.high !== 2
  || counts.critical !== 0
  || counts.moderate !== 0
  || counts.low !== 0
  || counts.info !== 0
) {
  throw new Error(`Unexpected npm audit severity totals: ${JSON.stringify(counts)}`);
}

console.log(`Accepted exactly two documented findings from ${advisoryUrl}; no others were reported.`);
