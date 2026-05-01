# pipeline-viz

Three-tier Concourse CI pipeline animation library.

```
Tier 1  parser.js        Concourse YAML → viz.json
Tier 2  pipeline-viz.js  Lit web component — DOM + state
Tier 3  pipeline-anim.js GSAP timeline — motion only
```

Each tier knows nothing about the others except the interface between them.

## Quick start

Open any demo page in a browser — no build step:

- `demo/index.html` — Landing page linking to all demos
- `demo/basics.html` — Sequential + Parallel (fan-in)
- `demo/gates.html` — Gate + gateActor + Fan-out
- `demo/failures.html` — Failure modes + Full feedback
- `demo/java-lib.html` — Full 17-job construct (zones + timing tokens)

## Animation primitives

Six composable primitives for building pipeline flows:

| Primitive | What it does |
|-----------|-------------|
| **Sequential** | Jobs chained via `depends_on` |
| **Parallel (fan-in)** | `parallelGroup` + merge circle — all must pass |
| **Gate / Approval** | Amber pulsing pause before execution |
| **Fan-out** | `fanOutGroup` — independent terminal jobs, no merge |
| **Failure** | `failAtStep: N` — red state, downstream blocked |
| **Rollback** | `triggeredByFailure` — activates on upstream failure |

See **[ANIMATION-PRIMITIVES.md](ANIMATION-PRIMITIVES.md)** for the full
composition guide with data schemas, examples, and step-by-step instructions.

## Authoring tool

Open `authoring/concourse-viz.html`. Paste a Concourse pipeline YAML,
fill in team name and color, download a `.js` data file ready to use
in slides or Waypoint.

## Architecture

```
src/
  parser.js          Tier 1 — pure JS, zero framework deps
  pipeline-viz.js    Tier 2 — Lit custom element
  pipeline-anim.js   Tier 3 — GSAP engine
demo/
  index.html         Landing page — links to focused demo pages
  shared.css         Shared styles across all demo pages
  shared.js          Shared Tier 2 + Tier 3 engine (PV.boot API)
  basics.html        Sequential + Parallel primitives
  gates.html         Gate + gateActor + Fan-out primitives
  failures.html      Failure modes from all pipeline types
  java-lib.html      Full construct — zones + timing tokens
authoring/
  concourse-viz.html YAML → .js export tool
```

## GSAP — free core only

Uses `gsap.timeline()`, `timeScale()`, `stagger`, `ScrollTrigger`.
No paid plugins (DrawSVG, MorphSVG, SplitText).
Connector line drawing uses `stroke-dashoffset` — exact visual equivalent of DrawSVG at zero cost.

## License

MIT
