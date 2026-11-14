# @roarkanalytics/cli

The official command line interface for the Roark Analytics API.

This package is generated from the same OpenAPI spec as
[`@roarkanalytics/sdk`](https://www.npmjs.com/package/@roarkanalytics/sdk), which it wraps.

## Install

```sh
npm install -g @roarkanalytics/cli
```

Or run it without installing:

```sh
npx @roarkanalytics/cli --help
```

## Authenticate

```sh
roark auth login          # prompts, and stores the token with mode 0600
roark auth status         # shows which credential is in effect
```

Or set the environment variable the SDK already reads:

```sh
export ROARK_API_BEARER_TOKEN="..."
```

Settings resolve highest precedence first: flag, environment variable, project
`.roark.json` found by walking up from the working directory, then the user config
file (`roark config path` prints where that is).

One exception, because a `.roark.json` arrives with a clone rather than being
something you wrote: if a project file sets `baseURL`, `roark` refuses to send
a stored or environment credential to it. Pass `--allow-project-base-url` (or set
`ROARK_ALLOW_PROJECT_BASE_URL`) once you have read the file, or `--token` to send a
different credential.

## Get started

```sh
roark get-started
```

Seven steps from an empty project to a graded simulation: the project you are in, the agent
under test, the caller that phones it, what the call is about, the metrics that grade it, the
saved run, and then the run itself. Each step writes one YAML file under `./roark` and the
directory is applied with `config apply`, so the setup is yours to commit, re-running it fills
in whatever is missing, and nothing is ever pruned.

It writes YAML by default, which needs nothing installed. In a project that has the SDK it
offers TypeScript instead: one `roark.config.ts` using the typed `define*` helpers, which
`config apply` finds by name.

```sh
roark get-started --scaffold-only   # write the config with placeholders; no questions, no API calls
roark get-started --no-run          # set it all up, start the run yourself later
roark get-started --ts              # TypeScript config instead of YAML
```

## Usage

Commands read noun before verb, and the verb is one of `list`, `get`, `create`,
`update` or `delete` unless the operation is genuinely something else:

```sh
roark call list --limit 5
roark call get <call-id>
roark simulation plan job start <plan-id>
```

### Output

JSON on stdout, indented and coloured for a terminal and compact when piped, so the
same command works in both places:

```sh
roark call list --limit 5 | jq '.data[].id'
roark call get <call-id> --format plain
```

Errors go to stderr, so `> out.json` captures only real output.

### Request bodies

Flags cover the common case; nested objects go one level deep with dots. A whole
payload can be supplied as JSON, and flags then override what it contains:

```sh
roark webhook create --url https://example.com/hook
roark customer-flow create --data @flow.json
cat flow.json | roark customer-flow create
```

### Any endpoint

Endpoints without a generated command are still reachable:

```sh
roark api get /v1/call --query limit=5
roark api post /v1/webhook --data '{"url":"https://example.com"}'
```

### Shell completion

```sh
eval "$(roark completion bash)"
eval "$(roark completion zsh)"
roark completion fish | source
```

## Exit codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | Success                                                    |
| 1    | The API rejected the request                               |
| 2    | The command line was wrong                                 |
| 3    | No credential, or the credential was refused               |
| 4    | The addressed resource does not exist                      |
| 5    | The request never completed: connection, timeout, or abort |

## Commands

`roark <command> --help` prints the flags for any one of these.

### agent

| Command                                                                                                                                                                                          | Description                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `roark agent build --name <value> --job-description <value> --tts.provider <value> --tts.voice-id <value> --stt.provider <value> --stt.model <value> --llm.provider <value> --llm.model <value>` | Build a Roark-hosted agent         |
| `roark agent conversation create <agent-id> --modality <value> --channel <value> --allowed-origins <value>`                                                                                      | Start a conversation with an agent |
| `roark agent create --name <value> --endpoint.direction <value>`                                                                                                                                 | Create a new agent                 |
| `roark agent draft create <agent-id>`                                                                                                                                                            | Start a draft                      |
| `roark agent draft delete <agent-id>`                                                                                                                                                            | Discard the draft                  |
| `roark agent draft get <agent-id>`                                                                                                                                                               | Get an agent's draft               |
| `roark agent draft publish <agent-id> --expected-revision <value>`                                                                                                                               | Publish the draft                  |
| `roark agent draft update <agent-id> --settings <value>`                                                                                                                                         | Edit the draft                     |
| `roark agent endpoint create --direction <value> --agent-id <value>`                                                                                                                             | Create a new agent endpoint        |
| `roark agent endpoint get <endpoint-id>`                                                                                                                                                         | Get agent endpoint by ID           |
| `roark agent endpoint list`                                                                                                                                                                      | List agent endpoints               |
| `roark agent endpoint update <endpoint-id>`                                                                                                                                                      | Update an agent endpoint           |
| `roark agent get <agent-id>`                                                                                                                                                                     | Get agent by ID                    |
| `roark agent list`                                                                                                                                                                               | List agents                        |
| `roark agent prompt list <agent-id>`                                                                                                                                                             | List an agent's prompts            |
| `roark agent prompt update <agent-id> --prompt <value>`                                                                                                                                          | Set an agent's prompt              |
| `roark agent prompt version list <agent-id> <prompt-id>`                                                                                                                                         | List a prompt's versions           |
| `roark agent setup answer <agent-id> <setup-id> --text <value>`                                                                                                                                  | Answer a setup's question          |
| `roark agent setup cancel <agent-id> <setup-id>`                                                                                                                                                 | Cancel a running setup             |
| `roark agent setup create <agent-id>`                                                                                                                                                            | Set up an agent                    |
| `roark agent setup get <agent-id> <setup-id>`                                                                                                                                                    | Get a setup by ID                  |
| `roark agent setup guidance send <agent-id> <setup-id> --text <value>`                                                                                                                           | Guide a running setup              |
| `roark agent setup latest get <agent-id>`                                                                                                                                                        | Get an agent's setup               |
| `roark agent update <agent-id>`                                                                                                                                                                  | Update an agent                    |
| `roark agent version get <agent-id> <version-id>`                                                                                                                                                | Get an agent version               |
| `roark agent version list <agent-id>`                                                                                                                                                            | List an agent's versions           |
| `roark agent version rollback <agent-id> <version-id>`                                                                                                                                           | Roll an agent back to a version    |

### agent-config

| Command                                                                | Description                   |
| ---------------------------------------------------------------------- | ----------------------------- |
| `roark agent-config get <key>`                                         | Get a managed config          |
| `roark agent-config list`                                              | List managed configs          |
| `roark agent-config promote <key>`                                     | Promote staging to production |
| `roark agent-config resolve <key>`                                     | Resolve config for a session  |
| `roark agent-config staging delete <key>`                              | Discard the staging revision  |
| `roark agent-config update <key> --channel <value> --document <value>` | Write a config revision       |

### analytics

| Command                                    | Description              |
| ------------------------------------------ | ------------------------ |
| `roark analytics query --measures <value>` | Run an analytics query   |
| `roark analytics schema get`               | Get the analytics schema |

### autoimprove

| Command                                                                                                              | Description                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `roark autoimprove job answer <job-id> --text <value>`                                                               | Answer Roark's question              |
| `roark autoimprove job cancel <job-id>`                                                                              | Cancel a job                         |
| `roark autoimprove job create --agent-id <value> --objective-metric-definition-id <value> --objective-label <value>` | Start an Autoimprove job             |
| `roark autoimprove job dismiss <job-id>`                                                                             | Dismiss a verified job               |
| `roark autoimprove job get <job-id>`                                                                                 | Get an Autoimprove job               |
| `roark autoimprove job guidance send <job-id> --text <value>`                                                        | Send guidance to a running job       |
| `roark autoimprove job list`                                                                                         | List Autoimprove jobs                |
| `roark autoimprove job promote <job-id>`                                                                             | Promote a verified job to production |

### benchmark

| Command                                                                 | Description                           |
| ----------------------------------------------------------------------- | ------------------------------------- |
| `roark benchmark leaderboard get --suite <value>`                       | Get the benchmark leaderboard         |
| `roark benchmark metric list --suite <value>`                           | List benchmark metrics                |
| `roark benchmark suite list`                                            | List benchmark suites                 |
| `roark benchmark target get <target-key> --suite <value>`               | Get a benchmark target                |
| `roark benchmark target history list <target-key> --suite <value>`      | List a target’s published generations |
| `roark benchmark target score-sample list <target-key> --suite <value>` | List score samples for a target       |

### call

| Command                                                                                                                                                 | Description                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `roark call batch delete --call-ids <value>`                                                                                                            | Delete calls in batch             |
| `roark call cost get <call-id>`                                                                                                                         | Get call cost                     |
| `roark call create --recording-url <value> --started-at <value> --interface-type <value> --call-direction <value> --customer.phone-number-e164 <value>` | Create a call                     |
| `roark call delete <call-id>`                                                                                                                           | Delete a call                     |
| `roark call get <call-id>`                                                                                                                              | Get a call by ID                  |
| `roark call list`                                                                                                                                       | List calls                        |
| `roark call metric list <call-id>`                                                                                                                      | List call metrics                 |
| `roark call property update <call-id> --properties <value>`                                                                                             | Update the properties of a call   |
| `roark call sentiment-run list <call-id>`                                                                                                               | List call sentiment runs          |
| `roark call tool-invocation append <call-id> --tool-invocations <value>`                                                                                | Append tool invocations to a call |
| `roark call transcript get <call-id>`                                                                                                                   | Get call transcript               |

### config

| Command                    | Description                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `roark config apply [dir]` | Reconcile the project to a config directory (or bundle). Previews and confirms first. |
| `roark config diff [dir]`  | Preview the changes a config directory (or bundle) would make. No writes.             |

### conversation

| Command                                    | Description        |
| ------------------------------------------ | ------------------ |
| `roark conversation get <conversation-id>` | Get a conversation |
| `roark conversation list`                  | List conversations |

### credential

| Command                                   | Description                             |
| ----------------------------------------- | --------------------------------------- |
| `roark credential create --name <value>`  | Create a personal credential            |
| `roark credential list`                   | List your personal credentials          |
| `roark credential revoke <credential-id>` | Revoke one of your personal credentials |

### customer

| Command                                                                                            | Description                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------- |
| `roark customer attribute delete <customer-profile-id> <key>`                                      | Clear a field on a customer     |
| `roark customer attribute unlock <customer-profile-id> <key>`                                      | Unlock a field on a customer    |
| `roark customer attribute update <customer-profile-id> <key> --value <value>`                      | Set a field on a customer       |
| `roark customer conversation list <customer-profile-id>`                                           | List a customer's conversations |
| `roark customer delete <customer-profile-id>`                                                      | Erase a customer                |
| `roark customer field create --key <value> --label <value> --value-type <value> --extract <value>` | Create a customer field         |
| `roark customer field delete <key>`                                                                | Delete a customer field         |
| `roark customer field list`                                                                        | List customer fields            |
| `roark customer field update <key>`                                                                | Update a customer field         |
| `roark customer get <customer-profile-id>`                                                         | Get a customer                  |
| `roark customer list`                                                                              | List customers                  |
| `roark customer notes update <customer-profile-id> --notes <value>`                                | Update the notes on a customer  |

### customer-flow

| Command                                                                                                                                               | Description                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `roark customer-flow create --data '{ ... }'`                                                                                                         | Create a customer flow                 |
| `roark customer-flow delete <flow-id>`                                                                                                                | Delete a customer flow                 |
| `roark customer-flow duplicate <flow-id>`                                                                                                             | Duplicate a customer flow              |
| `roark customer-flow edge-case create <flow-id> --title <value>`                                                                                      | Add an edge case                       |
| `roark customer-flow edge-case delete <flow-id> <edge-case-id>`                                                                                       | Remove an edge case                    |
| `roark customer-flow edge-case promote <flow-id> <edge-case-id>`                                                                                      | Promote an edge case to the happy path |
| `roark customer-flow edge-case update <flow-id> <edge-case-id>`                                                                                       | Update an edge case                    |
| `roark customer-flow get <flow-id>`                                                                                                                   | Get customer flow by ID                |
| `roark customer-flow graph replace <flow-id> --graph <value>`                                                                                         | Replace a scripted flow's steps        |
| `roark customer-flow happy-path update <flow-id>`                                                                                                     | Update a flow's happy path             |
| `roark customer-flow list`                                                                                                                            | List customer flows                    |
| `roark customer-flow update <flow-id> --off-script-policy.reaction <value> --off-script-policy.max-attempts <value> --off-script-policy.then <value>` | Update a customer flow                 |

### dashboard

| Command                                                                                      | Description        |
| -------------------------------------------------------------------------------------------- | ------------------ |
| `roark dashboard create --name <value>`                                                      | Create a dashboard |
| `roark dashboard data get <dashboard-id>`                                                    | Get dashboard data |
| `roark dashboard delete <dashboard-id>`                                                      | Delete a dashboard |
| `roark dashboard get <dashboard-id>`                                                         | Get a dashboard    |
| `roark dashboard list`                                                                       | List dashboards    |
| `roark dashboard update <dashboard-id>`                                                      | Update a dashboard |
| `roark dashboard widget create <dashboard-id> --measures <value> --name <value>`             | Add a widget       |
| `roark dashboard widget delete <dashboard-id> <widget-id>`                                   | Remove a widget    |
| `roark dashboard widget update <dashboard-id> <widget-id> --measures <value> --name <value>` | Replace a widget   |
| `roark dashboard widget-data get <dashboard-id> <widget-id>`                                 | Get widget data    |

### health

| Command        | Description           |
| -------------- | --------------------- |
| `roark health` | Get API health status |

### http-request-definition

| Command                                                              | Description                       |
| -------------------------------------------------------------------- | --------------------------------- |
| `roark http-request-definition create --scope <value> --url <value>` | Create HTTP request definition    |
| `roark http-request-definition get <definition-id>`                  | Get HTTP request definition by ID |
| `roark http-request-definition list`                                 | List HTTP request definitions     |
| `roark http-request-definition update <definition-id>`               | Update HTTP request definition    |

### integrations

| Command                                                                                                                     | Description                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `roark integrations calendar calendar list <connection-id>`                                                                 | List the calendars a bookable target can be created on |
| `roark integrations calendar check <connection-id>`                                                                         | Check a calendar connection                            |
| `roark integrations calendar create --provider <value> --label <value> --api-key <value>`                                   | Connect a calendar account                             |
| `roark integrations calendar delete <connection-id>`                                                                        | Delete a calendar connection                           |
| `roark integrations calendar get <connection-id>`                                                                           | Get a calendar connection                              |
| `roark integrations calendar google-oauth start --label <value>`                                                            | Start connecting a Google Calendar                     |
| `roark integrations calendar list`                                                                                          | List calendar connections                              |
| `roark integrations calendar target create <connection-id> --name <value> --calendar-id <value> --duration-minutes <value>` | Create a bookable target                               |
| `roark integrations calendar target delete <connection-id> <target-id>`                                                     | Delete a bookable target                               |
| `roark integrations calendar target get <connection-id> <target-id>`                                                        | Read one bookable target                               |
| `roark integrations calendar target list <connection-id>`                                                                   | List what can be booked on a calendar                  |
| `roark integrations calendar target update <connection-id> <target-id>`                                                     | Update a bookable target                               |
| `roark integrations calendar update <connection-id>`                                                                        | Update a calendar connection                           |
| `roark integrations mcp-server create --url <value>`                                                                        | Connect an MCP server                                  |
| `roark integrations mcp-server delete <server-id>`                                                                          | Disconnect an MCP server                               |
| `roark integrations mcp-server discover --url <value>`                                                                      | Discover an MCP server                                 |
| `roark integrations mcp-server get <server-id>`                                                                             | Get an MCP server                                      |
| `roark integrations mcp-server list`                                                                                        | List MCP servers                                       |
| `roark integrations mcp-server refresh <server-id>`                                                                         | Refresh an MCP server                                  |
| `roark integrations mcp-server update <server-id>`                                                                          | Update an MCP server                                   |

### live-report

| Command                                                                                               | Description                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| `roark live-report create --name <value> --notifications.email <value> --notifications.slack <value>` | Create a live report            |
| `roark live-report delete <report-id>`                                                                | Delete a live report            |
| `roark live-report document get <report-id> <document-id>`                                            | Get a report document           |
| `roark live-report document list <report-id>`                                                         | List report documents           |
| `roark live-report get <report-id>`                                                                   | Get a live report               |
| `roark live-report list`                                                                              | List live reports               |
| `roark live-report run <report-id>`                                                                   | Generate a live report document |
| `roark live-report update <report-id> --notifications.email <value> --notifications.slack <value>`    | Update a live report            |

### metric

| Command                                                                          | Description                            |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| `roark metric collection-job cancel <job-id>`                                    | Cancel a metric collection job         |
| `roark metric collection-job create`                                             | Create and run a metric collection job |
| `roark metric collection-job get <job-id>`                                       | Get metric collection job by ID        |
| `roark metric collection-job list`                                               | List metric collection jobs            |
| `roark metric definition create --data '{ ... }'`                                | Create custom metric definition        |
| `roark metric definition list`                                                   | List metric definitions                |
| `roark metric definition update <id-or-slug> --http-request.url <value>`         | Update a metric definition             |
| `roark metric policy create --name <value> --modality <value> --metrics <value>` | Create a metric policy                 |
| `roark metric policy delete <policy-id>`                                         | Delete a metric policy                 |
| `roark metric policy get <policy-id>`                                            | Get metric policy by ID                |
| `roark metric policy list`                                                       | List metric policies                   |
| `roark metric policy update <policy-id>`                                         | Update a metric policy                 |
| `roark metric variant create <id-or-slug> --name <value>`                        | Create a metric variant                |
| `roark metric variant delete <id-or-slug> <variant-id>`                          | Delete a metric variant                |
| `roark metric variant get <id-or-slug> <variant-id>`                             | Get a metric variant                   |
| `roark metric variant list <id-or-slug>`                                         | List a metric’s variants               |
| `roark metric variant update <id-or-slug> <variant-id>`                          | Update a metric variant                |

### phone-number

| Command                                       | Description                    |
| --------------------------------------------- | ------------------------------ |
| `roark phone-number allowance get`            | Get the phone number allowance |
| `roark phone-number available list`           | Search available phone numbers |
| `roark phone-number create`                   | Buy a phone number             |
| `roark phone-number delete <phone-number-id>` | Release a phone number         |
| `roark phone-number list`                     | List phone numbers             |
| `roark phone-number update <phone-number-id>` | Update a phone number          |

### project

| Command              | Description                                |
| -------------------- | ------------------------------------------ |
| `roark project list` | List projects available to this credential |

### simulation

| Command                                                                                               | Description                         |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `roark simulation audio-clip list`                                                                    | List audio clips                    |
| `roark simulation environment create --name <value> --background-noise <value>`                       | Create an environment               |
| `roark simulation environment delete <environment-id>`                                                | Delete an environment               |
| `roark simulation environment get <environment-id>`                                                   | Get environment by ID               |
| `roark simulation environment list`                                                                   | List environments                   |
| `roark simulation environment update <environment-id>`                                                | Update an environment               |
| `roark simulation group create --name <value> --simulation-run-plan-ids <value>`                      | Create a simulation group           |
| `roark simulation group delete <group-id>`                                                            | Delete a simulation group           |
| `roark simulation group get <group-id>`                                                               | Get a simulation group              |
| `roark simulation group list`                                                                         | List simulation groups              |
| `roark simulation group run <group-id>`                                                               | Run a simulation group              |
| `roark simulation group update <group-id>`                                                            | Update a simulation group           |
| `roark simulation job get <job-id>`                                                                   | Get simulation by ID                |
| `roark simulation job lookup --roark-phone-number <value>`                                            | Lookup by phone number              |
| `roark simulation job tool-mock list <job-id>`                                                        | List mocked tool invocations        |
| `roark simulation persona create --name <value> --language <value> --accent <value> --gender <value>` | Create a new persona                |
| `roark simulation persona get <persona-id>`                                                           | Get persona by ID                   |
| `roark simulation persona list`                                                                       | List personas                       |
| `roark simulation persona update <persona-id>`                                                        | Update a persona                    |
| `roark simulation plan create --data '{ ... }'`                                                       | Create a run plan                   |
| `roark simulation plan delete <plan-id>`                                                              | Delete a run plan                   |
| `roark simulation plan get <plan-id>`                                                                 | Get run plan by ID                  |
| `roark simulation plan job cancel <job-id>`                                                           | Cancel a simulation plan job        |
| `roark simulation plan job cost get <job-id>`                                                         | Get simulation run cost             |
| `roark simulation plan job debrief create <job-id>`                                                   | Generate simulation run debrief     |
| `roark simulation plan job delete <job-id>`                                                           | Delete a simulation plan job        |
| `roark simulation plan job get <job-id>`                                                              | Get simulation plan job             |
| `roark simulation plan job list`                                                                      | List simulation plan jobs           |
| `roark simulation plan job result get <job-id>`                                                       | Get simulation run results          |
| `roark simulation plan job start <plan-id>`                                                           | Run a simulation plan               |
| `roark simulation plan list`                                                                          | List run plans                      |
| `roark simulation plan update <plan-id>`                                                              | Update a run plan                   |
| `roark simulation run --data '{ ... }'`                                                               | Run a simulation                    |
| `roark simulation run-group create`                                                                   | Create a run group                  |
| `roark simulation run-group delete <group-id>`                                                        | Delete a run group                  |
| `roark simulation run-group get <group-id>`                                                           | Get a run group                     |
| `roark simulation run-group list`                                                                     | List run groups                     |
| `roark simulation run-group report regenerate <group-id>`                                             | Regenerate a run group report       |
| `roark simulation template list`                                                                      | List simulation templates           |
| `roark simulation tool mock --simulation-job-id <value> --tool-name <value>`                          | Mock a tool call during a test call |
| `roark simulation tool-fixture create --tool-name <value>`                                            | Set a tool fixture                  |
| `roark simulation tool-fixture delete <fixture-id>`                                                   | Delete a tool fixture               |
| `roark simulation tool-fixture list`                                                                  | List tool fixtures                  |
| `roark simulation tool-fixture update <fixture-id>`                                                   | Update a tool fixture               |

### tool

| Command                                                                                                                                                                                                                                                 | Description   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `roark tool create --name <value> --description <value> --runtime.request <value> --calendar.calendar-connection-id <value> --calendar.operation <value> --calendar.appointment-types <value> --mcp.mcp-server-id <value> --mcp.tool <value>`           | Create a tool |
| `roark tool delete <tool-id>`                                                                                                                                                                                                                           | Delete a tool |
| `roark tool get <tool-id>`                                                                                                                                                                                                                              | Get a tool    |
| `roark tool list`                                                                                                                                                                                                                                       | List tools    |
| `roark tool update <tool-id> --name <value> --description <value> --runtime.request <value> --calendar.calendar-connection-id <value> --calendar.operation <value> --calendar.appointment-types <value> --mcp.mcp-server-id <value> --mcp.tool <value>` | Update a tool |

### usage

| Command                                       | Description      |
| --------------------------------------------- | ---------------- |
| `roark usage get --from <value> --to <value>` | Get usage & cost |

### webhook

| Command                                               | Description       |
| ----------------------------------------------------- | ----------------- |
| `roark webhook create --url <value> --events <value>` | Create webhook    |
| `roark webhook delete <webhook-id>`                   | Delete webhook    |
| `roark webhook get <webhook-id>`                      | Get webhook by ID |
| `roark webhook list`                                  | List webhooks     |

### whoami

| Command        | Description                     |
| -------------- | ------------------------------- |
| `roark whoami` | Describe the current credential |

## Requirements

Node.js 20 or newer.

## Contributing

`src/commands.ts`, `src/completions.ts`, `man/` and this file are generated from
the OpenAPI spec; edits to them will be overwritten. `src/runtime/` is
hand-maintained and is never generated.
