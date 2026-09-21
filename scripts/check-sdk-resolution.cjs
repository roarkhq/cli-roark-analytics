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
const { createRequire } = require('node:module');
const path = require('node:path');

const main = () => {
  const probe = process.argv[2];
  if (!probe) {
    throw new Error('usage: check-sdk-resolution.cjs <directory where the tarball is installed>');
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
  const fromCli = createRequire(commandsPath);
  const sdk = fromCli('@roarkanalytics/sdk');
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
    throw new Error(
      `${missing.length} of ${COMMANDS.length} commands do not resolve on the SDK this build ships against ` +
        '(listed above). The command table names resources the pinned @roarkanalytics/sdk does not have. ' +
        'Either the SDK release carrying them is not out yet, or the dependency range in package.json was ' +
        'not moved with the regenerated table.',
    );
  }

  console.log(`all ${COMMANDS.length} commands resolve on the SDK this build ships against`);
};

try {
  main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
