// Keep `src/version.ts` in step with this package's `package.json`.
//
// It exists because `src/version.ts` used to be maintained by hand: it said
// 2.31.0 while `package.json` said 0.1.0, and `roark --version` shipped the wrong
// number. Release-please now bumps the file too (`extra-files` in
// release-please-config.json), so this is the second of two guards rather than
// the only one - it runs before tsc, so the compiled output can only ever carry
// the published version, however the file got there.
const fs = require('fs');
const path = require('path');

const main = () => {
  const version = require('../package.json').version;
  if (typeof version !== 'string' || !version) {
    throw new Error(`package.json has no usable version; got ${typeof version}`);
  }
  // Whatever is here is compiled in and answers `roark --version`, so a typo
  // reaches the registry as the package's identity. `v0.1.1` and `0.1` both
  // install fine and both read as wrong forever, npm versions being immutable.
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version is not semver: ${version}`);
  }

  const versionFile = path.resolve(__dirname, '..', 'src', 'version.ts');
  const contents = fs.readFileSync(versionFile, 'utf8');
  // `[^']*` rather than `.*`: the line carries a trailing
  // `// x-release-please-version` annotation, and a greedy `.*` would run to the
  // last quote on the line the moment that comment ever contains one.
  const PATTERN = /(export const version = ')([^']*)(')/;
  if (!PATTERN.test(contents)) {
    throw new Error("src/version.ts does not declare 'export const version'; nothing to sync");
  }

  const updated = contents.replace(PATTERN, `$1${version}$3`);
  if (updated !== contents) {
    fs.writeFileSync(versionFile, updated);
    console.log(`synced src/version.ts to ${version}`);
  }
};

if (require.main === module) {
  main();
}
