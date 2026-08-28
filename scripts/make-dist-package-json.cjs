// The manifest that ships inside dist/, which is what gets published.
//
// Vendored from sdk-roark-analytics-node's scripts/utils/make-dist-package-json.cjs,
// reduced to what a bin package needs. That version also rewrote an `exports`
// map and `main`/`module`/`types`; this package declares none of them - a CLI is
// an executable, not something you import - so the only path that moves is
// `bin`, which is `./dist/bin.js` here and `./bin.js` once dist/ IS the package
// root.
const path = require('path');

const pkgJson = require(path.join(__dirname, '..', 'package.json'));

for (const key in pkgJson.bin) {
  if (typeof pkgJson.bin[key] === 'string') {
    pkgJson.bin[key] = pkgJson.bin[key].replace(/^(\.\/)?dist\//, './');
  }
}

// The published package installs no dev toolchain, and its lifecycle scripts
// exist to stop someone publishing from the source directory - inside dist/ they
// would fire on the real publish and refuse it.
delete pkgJson.devDependencies;
delete pkgJson.scripts.prepack;
delete pkgJson.scripts.prepublishOnly;
delete pkgJson.scripts.prepare;

console.log(JSON.stringify(pkgJson, null, 2));
