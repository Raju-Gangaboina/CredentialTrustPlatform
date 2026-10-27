const { extractFromFile } = require('./server/verification/extractor');
const { runVerification } = require('./server/verification/registry');
const { runForensicCheck } = require('./server/verification/aiForensics');

const CASES = [
  { file: 'server/uploads/certificates/1790488681165_561b9d66c3f58ccc.pdf', studentName: 'Gangaboina Raju Yadav', label: 'Infosys Springboard (real name match)' },
  { file: 'server/uploads/certificates/1790488681165_561b9d66c3f58ccc.pdf', studentName: 'Someone Else Entirely', label: 'Infosys Springboard (deliberate name MISMATCH test)' },
  { file: 'test_cert.pdf', studentName: 'Whoever', label: 'Synthetic Saylor test cert (no QR)' },
  { file: 'server/uploads/certificates/1790318480960_7af4beabe444e3be.pdf', studentName: 'Whoever', label: 'Real ExcelR cert (no link at all)' }
];

(async () => {
  for (const c of CASES) {
    console.log('\n=================================================');
    console.log(c.label, '::', c.file);
    console.log('=================================================');
    const extraction = await extractFromFile(c.file);
    console.log('sourceType:', extraction.sourceType, '| fields:', JSON.stringify(extraction.fields));
    console.log('links:', JSON.stringify(extraction.links));
    console.log('hasVC:', !!extraction.verifiableCredential, '| hasRenderedPage:', !!extraction.renderedPageImageBase64);

    const verification = await runVerification(extraction, { studentName: c.studentName });
    console.log('--- STATUS:', verification.status, '| issuerKey:', verification.issuerKey, '---');
    for (const e of verification.evidence) console.log(' -', e.pass, '|', e.label);

    const forensics = await runForensicCheck(extraction, c.file);
    console.log(' - (forensics)', forensics.evidence.pass, '|', forensics.evidence.label);
  }
  process.exit(0);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
