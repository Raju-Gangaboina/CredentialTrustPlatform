# CredentialTrustPlatform
Campus Credential Trust & Verification Platform

We don’t ask AI whether a certificate looks real. We ask the issuer whether it actually exists.

Students upload certificates into per-subject vaults. The platform extracts the key fields (certificate ID, date, score) with OCR and PDF parsing. A rule-based verification engine then checks them against the issuer, using issuer adapters, QR and web checks, and C2PA provenance. Every result is one of VERIFIED, NOT_FOUND, NEEDS_REVIEW or PENDING, and comes with an evidence checklist. There are no percentage scores. Faculty get a class dashboard with a per-subject heatmap and a review queue for approving or rejecting certificates.

Stack: Node.js, Express, built-in node:sqlite, vanilla JS frontend, pdf.js, Tesseract.js, @contentauth/c2pa-node
