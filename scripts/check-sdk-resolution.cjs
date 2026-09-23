// Assert that every command in the table resolves on the SDK that will be
// installed alongside it.
//
// `src/commands.ts` is generated from the OpenAPI spec and addresses the SDK by
// string - `clientProperty` and `methodName` are both plain `string` in
// `src/runtime/types.ts`, because the table is data rather than code. That is
// what makes it generatable, and it is also why tsc cannot check it: nothing in
// the build compares a name in the table against the package that has to
// provide it.
//
// v0.23.0 is what that costs. The SDK renamed `autoimproveFix` to
// `autoimproveJob` in its 4.0.0, the table was regenerated to match, and the
// dependency range stayed at `^3.2.1` - which cannot resolve to a 4.x at all.
// Typecheck passed, 163 tests passed, the publish checks passed, and the
// tarball went out pinning a 3.x with no `autoimproveJob` in it. All eight
// `roark autoimprove job ...` commands reached users throwing
// "autoimproveJob.create is missing from @roarkanalytics/sdk", and npm
// publishes are immutable.
//
// The check runs against an INSTALL of the packed tarball rather than against
// this repository's `node_modules`. Those two differ and the difference is the
// bug: the repo installs from `pnpm-lock.yaml`, while what a user gets is the
// `npm-shrinkwrap.json` the build generates. Probing the install is the only
// way to ask the question that matters - does the thing being published work.
//
// The optional second argument is what makes that question answerable BEFORE a
// release is cut. With no argument the SDK is resolved the way the binary would
// resolve it, which is whatever the build happened to pin - the NEWEST version
// the declared range admits. v0.25.0 is what that costs: the table named
// `agent.build`, the range said `^4.0.0`, and the publish raced the SDK's own
// release and lost by three minutes. It failed correctly, but it failed at the
// only moment that is expensive - the tag and the GitHub release already
// existed and npm had nothing.
//
// Pointed at a directory holding a specific SDK, it asks the opposite and much
// stricter question: does the table resolve on the OLDEST version the range
// admits? That has no race in it. It is a property of two files in the
// repository, it is false the moment the generator adds a command the declared
// floor cannot serve, and `ci.yml` asks it on the regeneration PR itself.
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

// The SDK's `exports` map does not list `./package.json`, so requiring it
// throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the entry point instead and walk
// up to the manifest beside it. Only used to name a version in the log, so a
// miss degrades to "unknown" rather than failing the check.
const versionOfResolvedSdk = (resolver) => {
  try {
    let directory = path.dirname(resolver.resolve('@roarkanalytics/sdk'));
    for (;;) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) {
        return JSON.parse(fs.readFileSync(manifest, 'utf8')).version ?? 'unknown';
      }
      const parent = path.dirname(directory);
      if (parent === directory) return 'unknown';
      directory = parent;
    }
  } catch {
    return 'unknown';
  }
};

const main = () => {
  const probe = process.argv[2];
  const sdkDir = process.argv[3];
  if (!probe) {
    throw new Error(
      'usage: check-sdk-resolution.cjs <directory where the tarball is installed> [directory to resolve the SDK from]',
    );
  }

  // Resolve from inside the probe directory, so this reads the installed tree
  // rather than this repository's.
  const fromProbe = createRequire(path.join(probe, 'index.js'));
  const commandsPath = fromProbe.resolve('@roarkanalytics/cli/commands.js');
  const { COMMANDS } = fromProbe('@roarkanalytics/cli/commands.js');

  if (!Array.isArray(COMMANDS) || COMMANDS.length === 0) {
    throw new Error(`the installed commands.js exported no COMMANDS array; got ${typeof COMMANDS}`);
  }

  // Resolve the SDK from the CLI's own location, not from this script's. npm
  // may hoist it to the top level or nest it under the CLI, and the binary will
  // read whichever one is nested-or-hoisted relative to itself. Asking the same
  // question from the same place is the point.
  //
  // Unless a directory was named, in which case resolve from there instead: the
  // caller has installed one specific SDK and wants the table judged against
  // THAT rather than against whatever this tree resolved. The shrinkwrap is why
  // this cannot be done by installing the floor next to the tarball - a nested
  // copy would win over a hoisted one - so the two resolutions are kept apart.
  const fromCli = createRequire(sdkDir ? path.join(sdkDir, 'index.js') : commandsPath);
  const sdk = fromCli('@roarkanalytics/sdk');
  const sdkVersion = versionOfResolvedSdk(fromCli);
  const Roark = sdk.default ?? sdk.Roark ?? sdk;
  // The constructor refuses to build without credentials, and a resource
  // accessor is a getter on the instance, so there has to be an instance. The
  // token is never sent: nothing here performs a request, and the base URL is a
  // closed port so that a bug in that direction fails loudly instead of
  // reaching the real API.
  const client = new Roark({ bearerToken: 'resolution-probe', baseURL: 'http://127.0.0.1:1' });

  const missing = COMMANDS.filter((command) => {
    const resource = client[command.clientProperty];
    return resource == null || typeof resource[command.methodName] !== 'function';
  });

  if (missing.length > 0) {
    // The list goes to the log as plain lines and the summary goes to
    // `::error::` as one. A workflow annotation is single-line - a newline in it
    // truncates the annotation at the first one - so the detail would be lost
    // in exactly the case someone needs to read it.
    for (const command of missing) {
      console.error(
        `  roark ${command.commandPath.join(' ')} -> ${command.clientProperty}.${command.methodName}`,
      );
    }
    // Two callers, two different things to do about it, so the remedy is worded
    // per caller rather than left as one sentence that is half wrong either way.
    throw new Error(
      sdkDir ?
        `${missing.length} of ${COMMANDS.length} commands do not resolve on @roarkanalytics/sdk@${sdkVersion}, ` +
        'the oldest version the range in package.json admits (listed above). The range is the only thing a ' +
        'consumer reads, so as written it promises a CLI that throws. Raise the floor to the SDK release ' +
        'that carries these methods - the regeneration that added them to the table is what should have ' +
        'moved it. If that release is not on npm yet, this stays red until it is, which is correct: the ' +
        'commands cannot work before it exists.'
      : `${missing.length} of ${COMMANDS.length} commands do not resolve on the SDK this build ships against ` +
        `(@roarkanalytics/sdk@${sdkVersion}, listed above). The command table names resources the pinned ` +
        '@roarkanalytics/sdk does not have. Either the SDK release carrying them is not out yet, or the ' +
        'dependency range in package.json was not moved with the regenerated table.',
    );
  }

  console.log(
    sdkDir ?
      `all ${COMMANDS.length} commands resolve on @roarkanalytics/sdk@${sdkVersion}, the oldest the range admits`
    : `all ${COMMANDS.length} commands resolve on the SDK this build ships against (@roarkanalytics/sdk@${sdkVersion})`,
  );
};

try {
  main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
