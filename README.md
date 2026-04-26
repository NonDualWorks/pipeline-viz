# pipeline-viz

Three-tier Concourse CI pipeline animation library.

```
Tier 1  parser.js        Concourse YAML → viz.json
Tier 2  pipeline-viz.js  Lit web component — DOM + state
Tier 3  pipeline-anim.js GSAP timeline — motion only
```

Each tier knows nothing about the others except the interface between them.

## Quick start

Open `demo/index.html` in a browser. No build step.

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
  index.html         Working POC — open from file://, no build needed
authoring/
  concourse-viz.html YAML → .js export tool
```

## GSAP — free core only

Uses `gsap.timeline()`, `timeScale()`, `stagger`, `ScrollTrigger`.
No paid plugins (DrawSVG, MorphSVG, SplitText).
Connector line drawing uses `stroke-dashoffset` — exact visual equivalent of DrawSVG at zero cost.

## License

MIT
