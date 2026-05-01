# Animation Primitives — Composing Pipeline Flows

This guide explains how to compose pipeline animations using the toolkit's
six primitives. Each primitive is a data-level concept — you declare it in
your scenario data and the rendering + animation layers handle the rest.

---

## Quick reference

| Primitive | Key fields | Visual result |
|-----------|-----------|---------------|
| **Sequential** | `depends_on: [...]` | Left-to-right chain, connector lines between jobs |
| **Parallel (fan-in)** | `parallelGroup`, `row` | Stacked jobs in one column, merge circle, bridge line |
| **Gate / Approval** | `gate`, `gateDelay`, gate step | Amber pulsing border, pause before running |
| **Fan-out** | `fanOutGroup`, `row` | Stacked jobs, NO merge circle, independent completion |
| **Failure** | `failAtStep: N` | Job turns red at step N, downstream blocked |
| **Rollback** | `triggeredByFailure: "job"` | Activates only when named job fails, amber result |
| **Zones** | `zones` (top-level), `zone` (per job) | Colored header bars, visual phase grouping |
| **gateActor** | `gateActor`, `gateActorColor` | Persona label on gates (e.g., 👤 REVIEWERS) |

---

## Data schema

Every scenario is a plain JavaScript object:

```javascript
const myPipeline = {
  name: 'my-pipeline',    // displayed in header
  team: 'my-team',        // displayed in header
  color: '#10b981',       // team accent color (header dot)
  zones: [                // optional — visual phase grouping
    { id: 'pr', label: 'PR — Feature Branch', color: '#38bdf8' },
    { id: 'release', label: 'Release — Main Branch', color: '#10b981' },
  ],
  jobs: [ /* Job objects */ ]
}
```

### Job object

```javascript
{
  name: 'build',                    // unique identifier (required)
  duration: 1600,                   // animation duration in ms (default: 1600)
  depends_on: ['test'],             // upstream job names (empty = root job)
  steps: [ /* Step objects */ ],     // what happens inside this job

  // ── Parallel fan-in (optional) ──
  parallelGroup: 'tests',           // groups jobs into one column
  row: 0,                           // vertical position within group (0-indexed)

  // ── Fan-out (optional) ──
  fanOutGroup: 'notify',            // groups jobs WITHOUT merge circle
  row: 0,                           // vertical position within group

  // ── Gate / Approval (optional) ──
  gate: 'approval',                 // 'approval', 'scheduled', 'conditional', or 'manual'
  gateDelay: 2000,                  // ms spent in gate state before proceeding
  gateActor: 'Reviewers',           // persona label (replaces generic gate label)
  gateActorColor: '#f472b6',        // persona label color

  // ── Zone (optional) ──
  zone: 'pr',                       // zone id — groups jobs under a zone header

  // ── Failure (optional) ──
  failAtStep: 1,                    // step index where job fails (-1 or absent = no failure)

  // ── Rollback (optional) ──
  triggeredByFailure: 'deploy',     // only runs if named job fails
}
```

### Step object

```javascript
// Resource step (get/put)
{ label: 'get: source',   type: 'resource', resource_type: 'git' }
{ label: 'put: app-image', type: 'resource', resource_type: 'image' }

// Task step
{ label: 'task: build',   type: 'task' }

// Gate step (always first step in a gate job)
{ label: 'gate: approval', type: 'gate' }
```

### Resource types

These map to circle colors in the visualization:

| Token | Color | Concourse types |
|-------|-------|----------------|
| `git` | `#f5a623` (amber) | git, github-release |
| `image` | `#38bdf8` (sky) | registry-image, docker-image |
| `s3` | `#fbbf24` (yellow) | s3 |
| `semver` | `#a78bfa` (purple) | semver |
| `notify` | `#10b981` (emerald) | slack-notification |
| `deploy` | `#10b981` (emerald) | cf, kubernetes, helm-release |
| `unknown` | `#71717a` (gray) | anything else |

---

## Primitive 1: Sequential

The simplest pattern. Jobs run one after another.

```javascript
const sequential = {
  name: 'simple-chain', team: 'demo', color: '#10b981',
  jobs: [
    { name: 'build', duration: 1200,
      steps: [
        { label: 'get: source', type: 'resource', resource_type: 'git' },
        { label: 'task: compile', type: 'task' },
      ]},
    { name: 'test', depends_on: ['build'], duration: 1600,
      steps: [
        { label: 'task: run tests', type: 'task' },
      ]},
    { name: 'deploy', depends_on: ['test'], duration: 1400,
      steps: [
        { label: 'task: deploy', type: 'task' },
        { label: 'put: notify', type: 'resource', resource_type: 'notify' },
      ]},
  ]
}
```

**Result:** `build → test → deploy` rendered left-to-right with connector lines.

**Rules:**
- `depends_on` references job names, not indices
- A job with no `depends_on` starts immediately (root job)
- Multiple roots all start at t=0

---

## Primitive 2: Parallel (fan-in)

Jobs that share a `parallelGroup` render in the same column and start simultaneously.
A merge circle appears after the group — downstream jobs wait for ALL siblings to finish.

```javascript
{ name: 'unit-tests',  parallelGroup: 'tests', row: 0, depends_on: ['build'], duration: 1600,
  steps: [
    { label: 'task: unit suite', type: 'task' },
  ]},
{ name: 'integ-tests', parallelGroup: 'tests', row: 1, depends_on: ['build'], duration: 2200,
  steps: [
    { label: 'task: integ suite', type: 'task' },
  ]},
{ name: 'scan', depends_on: ['unit-tests', 'integ-tests'], duration: 1400,
  steps: [
    { label: 'task: security scan', type: 'task' },
  ]},
```

**Result:** Two jobs stacked vertically, fork lines from `build`, merge circle, bridge line to `scan`.

**Rules:**
- All jobs in a `parallelGroup` must share the same `depends_on` upstream(s)
- `row` determines vertical order (0 = top)
- The merge circle turns green only when ALL siblings succeed
- If any sibling fails, the merge circle turns red and downstream is blocked
- Siblings keep running after one fails (full feedback, not fail-fast)

---

## Primitive 3: Gate / Approval

A gate job pauses in an amber "waiting for approval" state before executing.
The first step should be a `type: 'gate'` step.

```javascript
{ name: 'code-review', depends_on: ['tests'], duration: 1200,
  gate: 'approval',     // or 'scheduled'
  gateDelay: 2000,       // wait 2 seconds before auto-approving
  steps: [
    { label: 'gate: approval', type: 'gate' },   // always first
    { label: 'task: merge check', type: 'task' },
  ]},
```

**Result:** Job enters amber pulsing state after dependencies pass. After `gateDelay` ms, it transitions to running and executes remaining steps.

**Rules:**
- `gate: 'approval'` shows `APPROVAL` label; `gate: 'scheduled'` shows `SCHEDULED`
- The gate step renders as a hollow amber circle
- During gate state: amber pulsing border, gate step shows as "running"
- After approval: gate step turns "done", remaining steps execute normally
- To simulate gate rejection: set `failAtStep: 0` — the gate step fails
- `gateDelay` controls the visual pause duration (ms)

---

## Primitive 4: Fan-out

Like parallel groups but WITHOUT a merge circle. Jobs complete independently.
Use for terminal notification/reporting jobs where you don't need to wait for all.

```javascript
{ name: 'notify-slack',     fanOutGroup: 'notify', row: 0, depends_on: ['deploy'], duration: 800,
  steps: [
    { label: 'put: slack', type: 'resource', resource_type: 'notify' },
  ]},
{ name: 'update-dashboard', fanOutGroup: 'notify', row: 1, depends_on: ['deploy'], duration: 1000,
  steps: [
    { label: 'task: update metrics', type: 'task' },
  ]},
```

**Result:** Two jobs stacked vertically (like parallel) but no merge circle, no bridge line. Each finishes independently.

**Rules:**
- Same layout as `parallelGroup` (column grouping + `row`)
- No merge circle — each job's success/failure is independent
- Typically used at the end of a pipeline for notifications
- Shows a `FAN-OUT` label in purple above the group
- Fan-out jobs should NOT have downstream dependents (they're terminal)

### Fan-out vs Parallel — when to use which

| Scenario | Use |
|----------|-----|
| Tests that must ALL pass before deploy | `parallelGroup` (fan-in) |
| Notifications after deploy (don't wait) | `fanOutGroup` (fan-out) |
| Parallel builds that feed a single publish | `parallelGroup` |
| Independent post-deploy actions | `fanOutGroup` |

---

## Primitive 5: Failure

Any job can fail at a specific step. Downstream jobs are blocked.

```javascript
{ name: 'unit-tests', parallelGroup: 'tests', row: 0, duration: 1600,
  failAtStep: 1,        // step index 1 fails (0-indexed)
  steps: [
    { label: 'get: source', type: 'resource', resource_type: 'git' },
    { label: 'task: unit suite', type: 'task' },    // ← this fails
    { label: 'task: coverage', type: 'task' },       // ← never reached
  ]},
```

**Result:** Steps 0 runs green, step 1 turns red, step 2 stays idle. Job border turns red. Downstream jobs stay dark.

**Rules:**
- `failAtStep` is 0-indexed
- Steps before `failAtStep` complete normally
- The failing step turns red, subsequent steps stay idle
- In a parallel group: siblings keep running (full feedback principle)
- The merge circle turns red on first failure
- Downstream jobs never start — they remain in idle state
- Omit `failAtStep` (or set to -1) for success

---

## Primitive 6: Rollback

A job that only activates when a specific upstream job fails.

```javascript
{ name: 'deploy', depends_on: ['build'], duration: 1600, failAtStep: 2,
  steps: [
    { label: 'get: image', type: 'resource', resource_type: 'image' },
    { label: 'task: helm upgrade', type: 'task' },
    { label: 'task: health check', type: 'task' },  // ← fails
  ]},
{ name: 'rollback', triggeredByFailure: 'deploy', duration: 1400,
  steps: [
    { label: 'task: helm rollback', type: 'task' },
    { label: 'put: notify', type: 'resource', resource_type: 'notify' },
  ]},
```

**Result:** When `deploy` fails, `rollback` activates and runs. Result banner shows amber "deploy failed, rollback succeeded".

**Rules:**
- `triggeredByFailure` names the job to watch
- The rollback job stays hidden/idle until the trigger job fails
- If the trigger job succeeds, the rollback job never runs
- Rollback jobs can have their own steps, duration, etc.

---

## Composing primitives

The power of the toolkit is combining these primitives. Here's how to think about composition:

### Composition rules

1. **Any job can be sequential** — just use `depends_on`
2. **Any group of jobs can be parallel** — add `parallelGroup` + `row`
3. **Any job can be a gate** — add `gate` + `gateDelay` + gate step
4. **Any terminal group can be fan-out** — use `fanOutGroup` + `row`
5. **Any job can fail** — add `failAtStep`
6. **Any failure can trigger rollback** — add `triggeredByFailure`
7. **Primitives stack** — a gate job inside a parallel group works correctly

### Example: Full developer journey

This composes all primitives into one flow:

```
code-push → [unit-tests | integ-tests] → code-review(GATE) → build-image →
deploy-dev → [smoke-tests | qa-signoff(GATE)] → deploy-staging →
deploy-prod → [notify-slack + update-dashboard](FAN-OUT)
```

```javascript
const devJourney = {
  name: 'developer-journey', team: 'platform', color: '#a78bfa',
  jobs: [
    // 1. Sequential root
    { name: 'code-push', duration: 800,
      steps: [
        { label: 'get: source', type: 'resource', resource_type: 'git' },
        { label: 'task: lint', type: 'task' },
      ]},

    // 2. Parallel fan-in (tests)
    { name: 'unit-tests', parallelGroup: 'tests', row: 0,
      depends_on: ['code-push'], duration: 1600,
      steps: [
        { label: 'get: source', type: 'resource', resource_type: 'git' },
        { label: 'task: unit suite', type: 'task' },
        { label: 'task: coverage', type: 'task' },
      ]},
    { name: 'integ-tests', parallelGroup: 'tests', row: 1,
      depends_on: ['code-push'], duration: 2200,
      steps: [
        { label: 'get: source', type: 'resource', resource_type: 'git' },
        { label: 'task: start env', type: 'task' },
        { label: 'task: integ suite', type: 'task' },
        { label: 'task: teardown', type: 'task' },
      ]},

    // 3. Gate (human approval after tests)
    { name: 'code-review', depends_on: ['unit-tests', 'integ-tests'],
      duration: 1200, gate: 'approval', gateDelay: 2000,
      steps: [
        { label: 'gate: approval', type: 'gate' },
        { label: 'task: merge check', type: 'task' },
      ]},

    // 4. Sequential chain
    { name: 'build-image', depends_on: ['code-review'], duration: 1400,
      steps: [
        { label: 'task: docker build', type: 'task' },
        { label: 'put: app-image', type: 'resource', resource_type: 'image' },
      ]},
    { name: 'deploy-dev', depends_on: ['build-image'], duration: 1200,
      steps: [
        { label: 'get: app-image', type: 'resource', resource_type: 'image' },
        { label: 'task: helm upgrade', type: 'task' },
        { label: 'task: health check', type: 'task' },
      ]},

    // 5. Parallel + gate combo
    { name: 'smoke-tests', parallelGroup: 'qa', row: 0,
      depends_on: ['deploy-dev'], duration: 1800,
      steps: [
        { label: 'task: smoke suite', type: 'task' },
        { label: 'task: api checks', type: 'task' },
      ]},
    { name: 'qa-signoff', parallelGroup: 'qa', row: 1,
      depends_on: ['deploy-dev'], duration: 2200,
      gate: 'approval', gateDelay: 1800,
      steps: [
        { label: 'gate: approval', type: 'gate' },
        { label: 'task: qa checklist', type: 'task' },
      ]},

    // 6. More sequential
    { name: 'deploy-staging', depends_on: ['smoke-tests', 'qa-signoff'],
      duration: 1400,
      steps: [
        { label: 'get: app-image', type: 'resource', resource_type: 'image' },
        { label: 'task: helm upgrade', type: 'task' },
        { label: 'task: verify', type: 'task' },
      ]},
    { name: 'deploy-prod', depends_on: ['deploy-staging'], duration: 1600,
      steps: [
        { label: 'get: app-image', type: 'resource', resource_type: 'image' },
        { label: 'task: helm upgrade', type: 'task' },
        { label: 'task: health check', type: 'task' },
        { label: 'put: notify', type: 'resource', resource_type: 'notify' },
      ]},

    // 7. Fan-out (independent terminal actions)
    { name: 'notify-slack', fanOutGroup: 'notify', row: 0,
      depends_on: ['deploy-prod'], duration: 800,
      steps: [
        { label: 'put: slack', type: 'resource', resource_type: 'notify' },
      ]},
    { name: 'update-dashboard', fanOutGroup: 'notify', row: 1,
      depends_on: ['deploy-prod'], duration: 1000,
      steps: [
        { label: 'task: update metrics', type: 'task' },
        { label: 'put: dashboard', type: 'resource', resource_type: 'notify' },
      ]},
  ]
}
```

### Creating scenario variants

Derive failure scenarios from a base by overriding specific jobs:

```javascript
// Base (happy path)
SCENARIOS['happy'] = devJourney

// Gate rejection — fail at the gate step
SCENARIOS['gate-reject'] = {
  ...devJourney,
  name: 'gate-rejected',
  jobs: devJourney.jobs.map(j =>
    j.name === 'code-review' ? { ...j, failAtStep: 0 } : j
  )
}

// Test failure — fail at step 1 of unit-tests
SCENARIOS['test-fail'] = {
  ...devJourney,
  name: 'test-fails',
  jobs: devJourney.jobs.map(j =>
    j.name === 'unit-tests' ? { ...j, failAtStep: 1 } : j
  )
}
```

---

## Step-by-step: Adding a new pipeline flow

### In the demo (`demo/index.html`)

1. **Define your scenario data** in the `SCENARIOS` object:

```javascript
SCENARIOS['my-flow'] = {
  name: 'my-flow', team: 'my-team', color: '#10b981',
  jobs: [ /* your jobs */ ]
}
```

2. **Add a tab** in the HTML:

```html
<button class="sc-tab" data-s="my-flow">
  <span class="sc-name">My Flow</span>
  <span class="sc-sub">description</span>
</button>
```

3. **Open in browser** — no build step needed.

### In slides (`pipeline-viz-slides/golden-paths/index.html`)

1. **Define scenario data** inline or import from `data/` directory

2. **Add an animation slide**:

```html
<section>
  <h3>My Flow</h3>
  <div class="pv-container" id="pv-my-flow"
       data-anim-id="myflow"
       data-scenario="my-flow"
       style="margin:20px auto;max-width:800px"></div>
</section>
```

3. **Register in ANIM_REGISTRY**:

```javascript
ANIM_REGISTRY['myflow'] = { scenario: 'my-flow', built: false }
```

### In production (Lit component)

1. **Parse from YAML** using `parsePipeline()` from `src/parser.js`
2. **Set data** on the `<pipeline-viz>` element: `el.data = viz`
3. **Animate** with `PipelineAnimator`:

```javascript
const anim = new PipelineAnimator(el, { speed: 1.0, mode: 'auto' })
anim.replay()
```

### From Concourse YAML

Use the authoring tool (`authoring/concourse-viz.html`) to convert real
Concourse pipeline YAML into the data format. Gate and fan-out annotations
are recognized from YAML job properties:

```yaml
jobs:
- name: approval-gate
  gate: approval
  gate_delay: 2000
  plan:
  - gate: approval
  - task: verify

- name: notify-slack
  fan_out_group: notify
  plan:
  - put: slack-notification
```

---

## Visual language reference

### Job states

| State | Border color | Meaning |
|-------|-------------|---------|
| `idle` | `#3d3d3d` | Not yet started |
| `pending` | `#8b572a` | About to start |
| `gate` | `#fbbf24` (pulsing) | Waiting for approval |
| `running` | `#f5a623` | Executing steps |
| `succeeded` | `#11c560` | All steps passed |
| `failed` | `#ed4b35` | A step failed |

### SVG elements

| Element | When |
|---------|------|
| Connector line | Between sequential jobs |
| Fork lines (bezier) | From upstream to parallel group members |
| Merge circle | After `parallelGroup` (NOT after `fanOutGroup`) |
| Bridge line | From merge circle to downstream job |
| `PARALLEL` label | Above parallel groups |
| `FAN-OUT` label | Above fan-out groups (purple) |
| Gate label | Above gate jobs (amber) |

---

## Extended features

### Zones — environment/phase visual layer

Zones group pipeline columns into named phases (e.g., PR vs Release). They are purely visual — no animation logic changes.

```javascript
const myPipeline = {
  name: 'my-pipeline', team: 'team', color: '#a78bfa',
  zones: [
    { id: 'pr', label: 'PR — Feature Branch', color: '#38bdf8' },
    { id: 'release', label: 'Release — Main Branch', color: '#10b981' },
  ],
  jobs: [
    { name: 'lint', zone: 'pr', ... },       // assigned to PR zone
    { name: 'build', zone: 'release', ... },  // assigned to Release zone
  ]
}
```

**Result:** Colored header bars above each zone's columns with label text. Extra gap between zones for visual separation.

**Rules:**
- `zones` is a top-level array: `[{ id, label, color }]`
- Each job gets `zone: 'zone-id'` to assign it
- Zone headers render as semi-transparent bars with colored accent lines
- Columns auto-group by zone — extra gap inserted at zone boundaries
- Without zones, layout is identical to before (backward compatible)

### gateActor — persona labels on gates

Distinguish different gates by showing WHO approves instead of a generic label.

```javascript
{ name: 'review-gate', gate: 'approval', gateDelay: 2500,
  gateActor: 'Reviewers', gateActorColor: '#f472b6',
  steps: [
    { label: 'gate: code review', type: 'gate' },
    { label: 'task: review checklist', type: 'task' },
  ]},
{ name: 'merge-approval', gate: 'approval', gateDelay: 2000,
  gateActor: 'CODEOWNERS', gateActorColor: '#60a5fa',
  steps: [
    { label: 'gate: team approval', type: 'gate' },
  ]},
```

**Result:** Gate label shows `👤 REVIEWERS` in pink and `👤 CODEOWNERS` in blue instead of generic `⏸ APPROVAL`.

**Rules:**
- `gateActor` replaces the default gate label text
- `gateActorColor` sets the label color (falls back to amber `#fbbf24`)
- Animation mechanic unchanged (same amber pulse)
- Without `gateActor`, falls back to gate vocabulary icons

### Gate vocabulary — extended gate types

Four gate types with distinct icons:

| `gate` value | Icon | Meaning |
|-------------|------|---------|
| `'approval'` | ⏸ | Human approval required |
| `'scheduled'` | ⏱ | Time-window gate |
| `'conditional'` | ⚡ | Auto-approve if criteria met |
| `'manual'` | 🔒 | Explicit manual trigger |

All four use the same animation mechanic (amber pulse, gateDelay). The icon/label is visual only.

---

## Construct: Java Library Publish

The first complete pipeline construct — a 17-job flow across 2 zones covering the full lifecycle of publishing a Java library JAR.

### Flow

```
PR ZONE (feature branch):
  pr-triggered → [compile-and-test ‖ code-quality] → publish-snapshot →
  [report-status ‖ security-scan] → review-gate(👤 REVIEWERS) →
  consumer-test → merge-approval(👤 CODEOWNERS)

RELEASE ZONE (main branch):
  merge-triggered → rebase-check → [release-build ‖ changelog] →
  set-semver → publish-release → [notify-teams + tag-release](FAN-OUT)
```

### Primitives coverage

| Primitive | Where |
|-----------|-------|
| Sequential | Main chain through both zones |
| Parallel (fan-in) | compile+test ‖ code-quality; report-status ‖ security-scan; release-build ‖ changelog |
| Gate (approval) | review-gate (Reviewers), merge-approval (CODEOWNERS) |
| Fan-out | notify-teams + tag-release |
| Failure | compile fails → blocks; security scan finds CVE → blocks |
| Zones | PR zone (blue) vs Release zone (green) |
| gateActor | Reviewers (pink), CODEOWNERS (blue) |

### Scenario variants

| Tab | What happens | Data tweak |
|-----|-------------|------------|
| Happy path | All pass, both gates approved, release published | Base data |
| Build fails | compile-and-test fails at unit tests | `failAtStep: 1` |
| Security blocked | security-scan finds vulnerability | `failAtStep: 1` |
| Review rejected | Code review gate rejected | `failAtStep: 0` |

---

## Timing Tokens

Semantic duration tokens replace raw millisecond values. Jobs use `timing: 'slow'` instead of `duration: 2200`. The animation engine resolves tokens to milliseconds. Raw `duration` still works as an override (takes precedence over `timing`).

### Token definitions

| Token | Duration | Typical use |
|-------|----------|-------------|
| `flash` | 400ms | trigger, notify, get resource |
| `quick` | 800ms | simple task, status post, semver bump |
| `steady` | 1400ms | build, publish, changelog |
| `slow` | 2200ms | test suite, compile+test |
| `crawl` | 3000ms | security scan, heavy analysis |

### Usage

```javascript
// Using timing token (preferred)
{ name: 'compile-and-test', timing: 'slow',
  steps: [ /* ... */ ]
}

// Gate timing token
{ name: 'review-gate', timing: 'quick', gate: 'approval', gateTiming: 'slow',
  gateActor: 'Reviewers', gateActorColor: '#f472b6',
  steps: [ /* ... */ ]
}

// Raw duration override (still works, takes precedence)
{ name: 'custom-job', duration: 1750,
  steps: [ /* ... */ ]
}
```

### Resolution order

1. `job.duration` (raw ms) — highest priority
2. `TIMING_TOKENS[job.timing]` — semantic token lookup
3. `300 + stepCount * 480` — auto-calculated fallback

For gate delays:
1. `job.gateDelay` (raw ms) — highest priority
2. `TIMING_TOKENS[job.gateTiming]` — semantic token lookup
3. `2000` — default fallback

### Backward compatibility

Existing scenarios using `duration:` directly continue to work unchanged. The token system is additive — no breaking changes.

---

## Tips

- **Keep `duration` values realistic** — longer tasks = longer `duration`
- **Gate delays** should be visually distinct (1500-3000ms works well)
- **Fan-out** is always terminal — don't put downstream jobs after it
- **Test your flow** with the happy path first, then add failure variants
- **Use `row: 0, 1, 2...`** for consistent vertical ordering in groups
- **Resource types** only matter for circle colors — pick what looks right
- **Zones** are optional — pipelines without zones render identically to before
- **gateActor** is optional — gates without it use the gate vocabulary icon
