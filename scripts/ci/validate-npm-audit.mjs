import { readFile } from 'node:fs/promises';

const auditPath = process.argv[2];
if (!auditPath) {
  throw new Error('Usage: node scripts/ci/validate-npm-audit.mjs <npm-audit.json>');
}

const report = JSON.parse(await readFile(auditPath, 'utf8'));
const vulnerabilities = report.vulnerabilities ?? {};
const advisoryUrl = 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2';

/*
 * This is an allow-list with a CEILING, not an exact expectation.
 *
 * It used to demand exactly `react-router` + `react-router-dom` and fail on
 * anything else -- including on NOTHING else. That is the wrong shape for an audit
 * gate twice over: a new advisory failed the build with a message about the two
 * router findings, and FIXING the router advisory also failed the build, reporting
 * `got none` as if a clean audit were a defect.
 *
 * Both happened on 2026-08-09. A new nanoid advisory (GHSA, <3.3.17, reachable via
 * vite -> postcss) turned the gate red, and pinning `nanoid` to 3.3.18 through
 * `overrides` cleared it -- at which point the router findings had also been
 * resolved upstream and the audit came back empty, which the gate then rejected.
 *
 * So: zero findings passes, only the documented router advisory is tolerated, and
 * anything else still fails. The tolerance stays because dropping it would mean
 * this file has to change again the moment that advisory reappears in a range this
 * project pins.
 */
const ALLOWED_PACKAGES = new Set(['react-router', 'react-router-dom']);
const actualPackages = Object.keys(vulnerabilities).sort();

const unexpected = actualPackages.filter((name) => !ALLOWED_PACKAGES.has(name));
if (unexpected.length > 0) {
  throw new Error(
    `Unexpected npm audit findings: ${unexpected.join(', ')}. `
    + `Only ${[...ALLOWED_PACKAGES].join(', ')} (${advisoryUrl}) are accepted.`,
  );
}

if (actualPackages.length === 0) {
  console.log('npm audit reported no vulnerabilities.');
  process.exit(0);
}

const router = vulnerabilities['react-router'];
const routerDom = vulnerabilities['react-router-dom'];

// The pair is reported together or not at all; one without the other means the
// dependency shape changed and the assertions below no longer describe reality.
if (!router || !routerDom) {
  throw new Error(
    `The router advisory is reported as a pair; saw only ${actualPackages.join(', ')}.`,
  );
}

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
