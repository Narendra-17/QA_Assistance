---
name: DAST sensitive path status policy
description: Status-aware rules for avoiding false positives in active sensitive-path probes.
---

Sensitive-path probes must report only explicit exposures: 200 responses on an allowlisted path, with path-specific severity; 403 and 404 are secure/skipped, and admin redirects are low-severity informational findings. Standard public metadata paths are never findings.

**Why:** Treating every non-404 as exposed misclassified access-denied responses, login redirects, and RFC-standard public files as vulnerabilities.

**How to apply:** Keep the path allowlist and never-flag set centralized in the probe classifier, include the exact HTTP status in evidence, and add a regression case for each status/path combination when changing the policy.