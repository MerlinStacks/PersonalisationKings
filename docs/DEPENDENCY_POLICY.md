# Dependency And Supply-Chain Policy

## Runtime Baseline

- Use Node.js 24 LTS for production services.
- Use the exact Bun version declared by `packageManager` in the root `package.json`.
- Keep `bun.lock` committed and require `bun install --frozen-lockfile` in CI and release builds.
- Keep Playwright and its Chromium revision aligned through the proof worker package and container build.

## Updates

- Review dependency updates at least monthly and perform a broader quarterly review.
- Apply critical security fixes as soon as a tested release is available.
- Do not deploy automated dependency updates directly to production.
- Require Prisma validation, clean-database migration deployment, typechecks, tests, PHP/JavaScript syntax checks, and production builds before merging.
- GitHub Actions updates are grouped weekly. Bun package updates remain manual until repository automation can update both workspace manifests and `bun.lock` reliably.

## Security Gates

- `bun audit` rejects known high or critical dependency vulnerabilities.
- GitHub dependency review rejects pull requests introducing high or critical known vulnerabilities.
- Gitleaks scans full Git history for committed credentials.
- Trivy scans repository infrastructure configuration.
- Syft generates an SPDX JSON SBOM as a workflow artifact.
- Trivy rejects high or critical fixed vulnerabilities in the application, proof-worker, and PostgreSQL images.
- Syft generates an additional SPDX JSON SBOM for every scanned image surface.
- Enable GitHub secret scanning and push protection in repository settings where available.

## Exceptions

Document a temporary exception in the pull request with the advisory identifier, affected surface, compensating control, owner, and expiry date. Do not suppress an advisory indefinitely without a reviewed risk decision.

Container image scanning is a required release gate. Base and infrastructure image references are digest-pinned; reviewed updates must refresh their digests. Retain the generated image SBOM artifacts with each release.

Create production releases with protected semantic-version tags matching `v*.*.*` on commits reachable from `main`. The tag-triggered Security workflow runs every dependency, secret, configuration, and container gate before creating the GitHub Release. It attaches the source, application, proof-worker, PostgreSQL, and Redis SPDX JSON SBOMs plus `SHA256SUMS`; an existing release or asset is not overwritten. Protect production tags from creation, movement, or deletion outside the reviewed release process.
