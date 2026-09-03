// Kept in step with this package's package.json two ways. Release-please rewrites
// the annotated line below in the release PR, because src/version.ts is in
// `extra-files` in release-please-config.json - without that the release PR bumps
// package.json alone and src/version.test.ts fails on it. scripts/sync-version.cjs
// then rewrites the same line before tsc, so nothing stale can reach dist even if
// the two ever drift.
//
// Do not edit: an edit here is overwritten, and the published number is whatever
// package.json says.
export const version = '0.3.0'; // x-release-please-version
