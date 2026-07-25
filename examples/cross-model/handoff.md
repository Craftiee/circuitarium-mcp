# Cross-model CRUMBLE handoff

This pattern lets Codex, Claude, or a local model continue work on the same
CRUMB artifact through Circuitarium MCP's CRUMBLE integration without
pretending their separate stdio server processes share a session.

## Model A: orient and record identity

1. Call `electronics_capabilities`.
2. Call `crumb_analyze_design` with:

   ```json
   {
     "path": "fixtures/crumb/breadboard-resistor.cru",
     "view": "summary",
     "topologyMode": "known-board-v1.3.5"
   }
   ```

3. Inspect `ok`, diagnostics, recognition counts, conversion losses,
   `context.projectDigest`, and `context.compatibilityProfile`.
4. Request bounded component or connection pages only if the task needs them.
   If `data.page.nextCursor` is present, copy it unchanged into the next
   request's `cursor`. It is opaque and valid only for that project digest and
   view. Also pass `context.projectDigest` as `expectedProjectDigest` on that
   continued read.

## Copy/paste handoff note

The object below is a coordination note, not a separate MCP tool input or a
persisted-session token:

```json
{
  "handoffVersion": "electronics-handoff/0.1",
  "goal": "Review the resistor placement and identify both inferred connection groups.",
  "backendId": "crumb.file",
  "adapterVersion": "crumb.file/0.2",
  "compatibilityProfile": "crumb.unity/1.3.5",
  "contractVersion": "electronics.mcp/0.2",
  "projectRef": "fixtures/crumb/breadboard-resistor.cru",
  "projectDigest": "sha256:<copy exact digest from tool context>",
  "analysis": {
    "topologyMode": "known-board-v1.3.5",
    "sourceIncluded": false,
    "findings": [
      "The resistor signature was recognized.",
      "Its two terminals were kept as a component branch, not unioned into one net."
    ],
    "openQuestions": [
      "Confirm the terminal attachment addresses and connection provenance."
    ]
  },
  "requestedNextAction": {
    "tool": "crumb_analyze_design",
    "arguments": {
      "path": "fixtures/crumb/breadboard-resistor.cru",
      "expectedProjectDigest": "sha256:<copy exact digest from tool context>",
      "view": "connections",
      "topologyMode": "known-board-v1.3.5",
      "limit": 50
    }
  },
  "capabilityBoundary": [
    "No live CRUMB control",
    "No circuit simulation",
    "No arbitrary editing",
    "Topology evidence is pinned to CRUMB 1.3.5 Unity-era saves"
  ]
}
```

Never fill the digest with a guessed value. Copy the exact value returned by the
tool.

## Model B: verify before relying

The receiving model should:

1. call `electronics_capabilities` in its own process;
2. call `crumb_analyze_design` with the same project reference, summary view,
   topology mode, and the handoff digest as `expectedProjectDigest`;
3. stop and report a changed artifact if the result has `ok: false` and
   `error.code: "PROJECT_STATE_CONFLICT"`;
4. otherwise confirm the returned context still records the expected digest
   and compatibility profile;
5. request the bounded connection view and continue the stated goal.

The guarded first call is:

```json
{
  "path": "fixtures/crumb/breadboard-resistor.cru",
  "expectedProjectDigest": "sha256:<copy exact digest from handoff>",
  "view": "summary",
  "topologyMode": "known-board-v1.3.5"
}
```

The first bounded connection call does not invent a cursor:

```json
{
  "path": "fixtures/crumb/breadboard-resistor.cru",
  "expectedProjectDigest": "sha256:<copy exact digest from handoff>",
  "view": "connections",
  "topologyMode": "known-board-v1.3.5",
  "limit": 50
}
```

Only if that response returns `data.page.nextCursor` does the following
connection-page call include a cursor:

```json
{
  "path": "fixtures/crumb/breadboard-resistor.cru",
  "expectedProjectDigest": "sha256:<copy exact digest from handoff>",
  "view": "connections",
  "topologyMode": "known-board-v1.3.5",
  "limit": 50,
  "cursor": "<copy the exact page.nextCursor value>"
}
```

Do not decode or recreate the cursor. If the file digest or view changes,
stop. A changed file returns `PROJECT_STATE_CONFLICT` because the request also
provides `expectedProjectDigest`. Begin a fresh unguarded summary only after
deciding to accept and review the new artifact.

A suitable prompt for the receiving model is:

```text
Use Circuitarium MCP and its CRUMBLE integration. Call
electronics_capabilities first.
Re-analyze the handoff project in summary view and pass its recorded SHA-256
digest as expectedProjectDigest before trusting the findings. If
PROJECT_STATE_CONFLICT is returned, stop and report the change. Use only
callable backends. Then request the smallest bounded page needed for the
requested next action. Do not claim live simulation, signal reads, or arbitrary
CRUMB editing.
```

## Why this works

The `.cru` file is the shared artifact and its digest is the immutable identity.
The models do not need to share conversation history, language-model vendor
credentials, or an MCP process. A stronger or weaker model can follow the same
contract:

```text
discover capabilities
        |
analyze summary guarded by expected digest
        |
read one bounded semantic page
        |
report findings plus next action
```

If source code is needed, make that an explicit, authorized request. The default
handoff carries source metadata and a digest, not the embedded source text.
