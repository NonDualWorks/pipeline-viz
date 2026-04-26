/**
 * pipeline-viz.js — Tier 2: Web Component
 *
 * Responsibilities:
 *   - Render pipeline jobs and steps as DOM elements
 *   - Own the state machine (idle→pending→running→succeeded/failed)
 *   - Expose DOM elements with stable data-* attributes
 *   - Emit custom events when state changes
 *   - Accept viz.json data as a property
 *
 * Does NOT know about:
 *   - How elements animate (that is Tier 3's job)
 *   - GSAP or any animation library
 *   - CSS transitions (Tier 3 handles motion)
 *
 * Interface with Tier 3 (Animation):
 *   DOM attributes: data-job="name"  data-step="0"  data-state="idle"
 *   Custom events:  'pv:state-change' { job, step, from, to }
 *                   'pv:pipeline-done' { success: bool }
 *                   'pv:ready'         (after first render)
 */

// Lit loaded from CDN or npm
const { LitElement, html, css, nothing } =
  typeof Lit !== 'undefined' ? Lit
  : await import('https://cdn.jsdelivr.net/npm/lit@3/index.js')

// ── STATE MACHINE ─────────────────────────────────────────────────
const STATES = {
  IDLE:      'idle',
  PENDING:   'pending',
  RUNNING:   'running',
  SUCCEEDED: 'succeeded',
  FAILED:    'failed',
  BLOCKED:   'blocked',
}

// ── RESOURCE COLOR TOKENS ─────────────────────────────────────────
// CSS custom properties — defined in Tier 2, readable by Tier 3
const RC_COLORS = {
  git:      'var(--pv-rc-git,      #f5a623)',
  image:    'var(--pv-rc-image,    #38bdf8)',
  s3:       'var(--pv-rc-s3,       #fbbf24)',
  semver:   'var(--pv-rc-semver,   #a78bfa)',
  time:     'var(--pv-rc-time,     #a78bfa)',
  notify:   'var(--pv-rc-notify,   #10b981)',
  deploy:   'var(--pv-rc-deploy,   #10b981)',
  pipeline: 'var(--pv-rc-pipeline, #38bdf8)',
  unknown:  'var(--pv-rc-unknown,  #71717a)',
}

// ── PIPELINE VIZ COMPONENT ────────────────────────────────────────
class PipelineViz extends LitElement {

  static properties = {
    // Pipeline data — accepts object or JSON string
    data:  { type: Object },
    // Pipeline team name for header
    team:  { type: String },
    // Accent color for pipeline header
    color: { type: String },
    // Internal state map — jobName → state string
    _jobStates:  { type: Object, state: true },
    _stepStates: { type: Object, state: true },
  }

  static styles = css`
    :host {
      display: block;
      font-family: var(--pv-font-mono, 'JetBrains Mono', ui-monospace, monospace);

      /* Concourse state colors — overrideable via CSS custom properties */
      --pv-idle:      #3d3d3d;
      --pv-pending:   #8b572a;
      --pv-running:   #f5a623;
      --pv-succeeded: #11c560;
      --pv-failed:    #ed4b35;
      --pv-blocked:   #3d3d3d;

      /* Resource type colors */
      --pv-rc-git:     #f5a623;
      --pv-rc-image:   #38bdf8;
      --pv-rc-s3:      #fbbf24;
      --pv-rc-semver:  #a78bfa;
      --pv-rc-notify:  #10b981;
      --pv-rc-unknown: #71717a;

      /* Layout */
      --pv-surface:      #18181b;
      --pv-surface-high: #27272a;
      --pv-border:       rgba(255,255,255,0.08);
      --pv-text:         #f4f4f5;
      --pv-muted:        #a1a1aa;
      --pv-subtle:       #71717a;
    }

    /* ── PIPELINE BLOCK ───────────────────────────────── */
    .pipeline-block {
      background: var(--pv-surface);
      border: 2px solid var(--pv-border);
      border-radius: 10px;
      overflow: hidden;
    }

    .pipeline-header {
      padding: 7px 14px;
      background: var(--pv-surface-high);
      border-bottom: 1px solid var(--pv-border);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pl-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--pv-idle);
      transition: background 0.3s;
      flex-shrink: 0;
    }

    .pl-team  { font-size: 10px; font-weight: 600; color: var(--pv-text); }
    .pl-sep   { font-size: 10px; color: var(--pv-subtle); }
    .pl-name  { font-size: 10px; color: var(--pv-muted); }

    /* ── SVG CANVAS (parallel layout) ────────────────── */
    .svg-scroll { overflow-x: auto; padding: 16px; }
    svg { display: block; overflow: visible; }

    /* ── LINEAR LAYOUT ───────────────────────────────── */
    .jobs-row {
      display: flex;
      align-items: flex-start;
      padding: 14px;
      gap: 0;
      overflow-x: auto;
      min-width: max-content;
    }

    .lead-line {
      width: 14px;
      height: 2px;
      margin-top: 18px;
      flex-shrink: 0;
      background: var(--pv-idle);
    }

    /* ── JOB BOX ─────────────────────────────────────── */
    .job-box {
      width: 134px;
      flex-shrink: 0;
      border: 2px solid var(--pv-idle);
      border-radius: 5px;
      overflow: hidden;
      background: var(--pv-surface);
    }

    /* State border colors — Tier 3 can also drive these
       but having CSS fallbacks keeps it functional without animation */
    .job-box[data-state="pending"]   { border-color: var(--pv-pending);   }
    .job-box[data-state="running"]   { border-color: var(--pv-running);   }
    .job-box[data-state="succeeded"] { border-color: var(--pv-succeeded); }
    .job-box[data-state="failed"]    { border-color: var(--pv-failed);    }

    .job-header {
      padding: 4px 8px;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .job-box[data-state="running"]   .job-header { background: rgba(245,166,35,0.10); }
    .job-box[data-state="succeeded"] .job-header { background: rgba(17,197,96,0.08);  }
    .job-box[data-state="failed"]    .job-header { background: rgba(237,75,53,0.08);  }

    /* State icon slot — Tier 3 animates content here */
    .state-icon {
      width: 10px;
      height: 10px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .state-dot {
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background: var(--pv-idle);
    }

    .job-box[data-state="pending"]   .state-dot { background: var(--pv-pending);   border-radius: 2px; }
    .job-box[data-state="succeeded"] .state-dot { background: var(--pv-succeeded); border-radius: 50%; }
    .job-box[data-state="failed"]    .state-dot { background: var(--pv-failed);    border-radius: 2px; }

    /* Spinner — shown when running, hidden otherwise */
    .spinner {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1.5px solid rgba(245,166,35,0.25);
      border-top-color: #f5a623;
      position: absolute;
      opacity: 0;
    }
    .job-box[data-state="running"] .spinner  { opacity: 1; }
    .job-box[data-state="running"] .state-dot { opacity: 0; }

    .job-name {
      font-size: 10px;
      font-weight: 600;
      color: var(--pv-subtle);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 92px;
    }
    .job-box[data-state="running"]   .job-name { color: var(--pv-running);   }
    .job-box[data-state="succeeded"] .job-name { color: var(--pv-text);      }
    .job-box[data-state="failed"]    .job-name { color: var(--pv-failed);    }

    /* ── STEPS ───────────────────────────────────────── */
    .job-steps {
      padding: 4px 6px;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .step-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 3px;
      border-radius: 3px;
      opacity: 0.25;
    }

    /* Tier 3 drives opacity, but CSS provides fallbacks */
    .step-row[data-state="running"]   { opacity: 1; background: rgba(255,255,255,0.03); }
    .step-row[data-state="done"]      { opacity: 1; }
    .step-row[data-state="failed"]    { opacity: 1; }

    .step-indicator {
      width: 7px;
      height: 7px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .rc-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .task-dot {
      width: 5px;
      height: 5px;
      border-radius: 1px;
      background: var(--pv-idle);
      flex-shrink: 0;
      margin: 1px;
    }

    .gate-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      border: 1.5px solid #fbbf24;
      background: transparent;
      flex-shrink: 0;
    }

    .step-check { font-size: 8px; color: var(--pv-succeeded); line-height: 1; }
    .step-fail  { font-size: 8px; color: var(--pv-failed);    line-height: 1; }

    .step-label {
      font-size: 8px;
      color: var(--pv-subtle);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 98px;
    }
    .step-row[data-state="running"] .step-label { color: var(--pv-text);  }
    .step-row[data-state="done"]    .step-label { color: var(--pv-muted); }
    .step-row[data-state="failed"]  .step-label { color: var(--pv-failed);}

    /* ── CONNECTORS (linear layout) ──────────────────── */
    .connector {
      display: flex;
      align-items: center;
      margin-top: 18px;
      flex-shrink: 0;
    }

    /* The actual line — Tier 3 animates stroke-dashoffset here
       as a free alternative to DrawSVG */
    .conn-line {
      display: block;
      width: 20px;
      height: 2px;
      background: var(--pv-idle);
      position: relative;
      overflow: hidden;
    }

    /* Parallel group label */
    .parallel-label {
      position: absolute;
      top: -10px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 7px;
      letter-spacing: 1px;
      color: var(--pv-subtle);
      pointer-events: none;
    }

    /* ── LEGEND ──────────────────────────────────────── */
    .legend {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 6px 14px;
      background: var(--pv-surface-high);
      border-top: 1px solid var(--pv-border);
      font-size: 9px;
    }
    .leg-title { color: var(--pv-subtle); text-transform: uppercase; letter-spacing: .06em; }
    .leg-item  { display: flex; align-items: center; gap: 4px; }
    .leg-dot   { width: 7px; height: 7px; border-radius: 2px; }
    .leg-dot.round { border-radius: 50%; }
    .leg-item span { color: var(--pv-subtle); }
  `

  constructor() {
    super()
    this.data  = null
    this.team  = 'team'
    this.color = '#10b981'
    this._jobStates  = {}
    this._stepStates = {}
  }

  // ── PUBLIC API (called by Tier 3) ─────────────────────────────────

  /** Set job state and emit event */
  setJobState(jobName, state) {
    const from = this._jobStates[jobName] || STATES.IDLE
    if (from === state) return
    this._jobStates = { ...this._jobStates, [jobName]: state }

    // Update DOM attribute immediately (Tier 3 reads this)
    const el = this.shadowRoot?.querySelector(`[data-job="${jobName}"]`)
    if (el) el.dataset.state = state

    this._emit('pv:state-change', { job: jobName, step: null, from, to: state })
  }

  /** Set step state and emit event */
  setStepState(jobName, stepIndex, state) {
    const key  = `${jobName}:${stepIndex}`
    const from = this._stepStates[key] || STATES.IDLE
    if (from === state) return
    this._stepStates = { ...this._stepStates, [key]: state }

    const el = this.shadowRoot?.querySelector(
      `[data-job="${jobName}"] [data-step="${stepIndex}"]`
    )
    if (el) el.dataset.state = state

    this._emit('pv:state-change', { job: jobName, step: stepIndex, from, to: state })
  }

  /** Get DOM element for a job box */
  getJobEl(jobName) {
    return this.shadowRoot?.querySelector(`[data-job="${jobName}"]`) || null
  }

  /** Get DOM element for a specific step */
  getStepEl(jobName, stepIndex) {
    return this.shadowRoot?.querySelector(
      `[data-job="${jobName}"] [data-step="${stepIndex}"]`
    ) || null
  }

  /** Get all connector elements */
  getConnectorEls() {
    return [...(this.shadowRoot?.querySelectorAll('.conn-line') || [])]
  }

  /** Get pipeline jobs in render order */
  getJobs() {
    return this.data?.jobs || []
  }

  /** Reset all states to idle */
  resetStates() {
    this._jobStates  = {}
    this._stepStates = {}
    this.shadowRoot?.querySelectorAll('[data-state]').forEach(el => {
      el.dataset.state = 'idle'
    })
  }

  // ── INTERNAL HELPERS ──────────────────────────────────────────────

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles:    true,
      composed:   true,
    }))
  }

  _jobState(name)         { return this._jobStates[name]              || STATES.IDLE }
  _stepState(name, index) { return this._stepStates[`${name}:${index}`] || STATES.IDLE }

  _hasParallel() {
    return this.data?.jobs?.some(j => j.parallelGroup || j.fanOutGroup)
  }

  // ── RENDER ────────────────────────────────────────────────────────

  firstUpdated() {
    this._emit('pv:ready', { jobs: this.data?.jobs || [] })
  }

  updated(changed) {
    if (changed.has('data')) {
      this._jobStates  = {}
      this._stepStates = {}
      this._emit('pv:data-changed', { jobs: this.data?.jobs || [] })
    }
  }

  _renderStepIndicator(step, jobName, index) {
    const state = this._stepState(jobName, index)
    if (step.type === 'resource') {
      const color = RC_COLORS[step.resource_type] || RC_COLORS.unknown
      return html`<div class="rc-dot" style="background:${color}"></div>`
    }
    if (state === STATES.RUNNING) {
      return html`<div class="task-dot" style="background:#f5a623"></div>`
    }
    if (state === STATES.SUCCEEDED || state === 'done') {
      return html`<span class="step-check">✓</span>`
    }
    if (state === STATES.FAILED) {
      return html`<span class="step-fail">✗</span>`
    }
    if (step.type === 'gate') {
      return html`<div class="gate-dot"></div>`
    }
    return html`<div class="task-dot"></div>`
  }

  _renderJobBox(job) {
    const state = this._jobState(job.name)
    return html`
      <div class="job-box"
        data-job="${job.name}"
        data-state="${state}">
        <div class="job-header">
          <div class="state-icon">
            <div class="spinner"></div>
            <div class="state-dot"></div>
          </div>
          <span class="job-name">${job.name}</span>
        </div>
        <div class="job-steps">
          ${(job.steps || []).map((step, i) => html`
            <div class="step-row"
              data-step="${i}"
              data-state="${this._stepState(job.name, i)}">
              ${this._renderStepIndicator(step, job.name, i)}
              <span class="step-label">${step.label}</span>
            </div>
          `)}
        </div>
      </div>
    `
  }

  _renderLinear() {
    const jobs = this.data?.jobs || []
    return html`
      <div class="jobs-row">
        <div class="lead-line"></div>
        ${jobs.map((job, ji) => html`
          ${ji > 0 ? html`
            <div class="connector" data-conn="${ji}">
              <div class="conn-line"></div>
            </div>
          ` : nothing}
          ${this._renderJobBox(job)}
        `)}
      </div>
    `
  }

  _renderParallelSVG() {
    // For parallel layout, Tier 2 renders a lightweight SVG scaffold
    // Tier 3 (GSAP) drives all the actual motion on top of it
    // The SVG here provides stable elements with data-* attributes
    const jobs = this.data?.jobs || []

    const JW = 134, JH_BASE = 20, STEP_H = 11, JH_MIN = 44
    const CGAP = 64, RGAP = 18, RC = 6, PX = 36, PY = 28

    function jobHeight(job) {
      return Math.max(JH_MIN, JH_BASE + (job.steps?.length || 0) * STEP_H + 4)
    }

    // Group into columns
    const colMap = {}
    jobs.forEach((j, ji) => {
      const g = j.parallelGroup || j.fanOutGroup || `_s${ji}`
      if (!colMap[g]) colMap[g] = []
      colMap[g].push({ job: j, ji })
    })
    const colTypeMap = {}
    jobs.forEach((j, ji) => {
      const g = j.parallelGroup || j.fanOutGroup || `_s${ji}`
      if (!colTypeMap[g]) colTypeMap[g] = j.parallelGroup ? 'parallel' : j.fanOutGroup ? 'fanout' : 'sequential'
    })
    const colTypes = Object.values(colTypeMap)
    const cols = Object.values(colMap)
    const maxRows = Math.max(...cols.map(c => c.length), 1)
    const maxJH = Math.max(...jobs.map(j => jobHeight(j)), JH_MIN)
    const innerH = maxRows * maxJH + (maxRows - 1) * RGAP
    const H = innerH + PY * 2
    const W = PX + RC * 2 + CGAP + cols.length * (JW + CGAP) + RC * 2 + PX

    const colX = ci => PX + RC * 2 + CGAP + ci * (JW + CGAP)
    const srcX = PX + RC, srcY = H / 2

    // Job Y positions
    const jobY = {}
    cols.forEach((col, ci) => {
      const totalH = col.length * maxJH + (col.length - 1) * RGAP
      const startY = H / 2 - totalH / 2
      col.forEach(({ ji }, ri) => { jobY[ji] = startY + ri * (maxJH + RGAP) })
    })

    const foreignJobBoxes = jobs.map((job, ji) => {
      const x = colX(cols.findIndex(c => c.some(e => e.ji === ji)))
      const y = jobY[ji]
      const h = jobHeight(job)
      return { job, ji, x, y, h }
    })

    return html`
      <div class="svg-scroll">
        <svg width="${W}" height="${H}">

          <!-- Source resource circle -->
          <circle data-rc="source" cx="${srcX}" cy="${srcY}" r="${RC}"
            fill="#3d3d3d" style="transition:fill .3s" />

          <!-- Connector paths — Tier 3 animates stroke-dashoffset -->
          ${cols.map((col, ci) => col.map(({ job, ji }) => {
            const jy = jobY[ji] + maxJH / 2
            const fromX = ci === 0 ? srcX + RC : colX(ci) - CGAP / 2 + RC
            const fromY = srcY
            const toX = colX(ci)
            const mx = fromX + (toX - fromX) * 0.5
            const d = `M ${fromX} ${fromY} C ${mx} ${fromY}, ${mx} ${jy}, ${toX} ${jy}`
            const pathLen = 60 // approximate — Tier 3 measures actual pathLength

            return html`
              <path data-conn-in="${job.name}"
                d="${d}" fill="none"
                stroke="#3d3d3d" stroke-width="2"
                stroke-dasharray="${pathLen}"
                stroke-dashoffset="${pathLen}"
                style="transition:stroke .3s" />
            `
          }))}

          <!-- Merge paths -->
          ${cols.map((col, ci) => {
            if (ci >= cols.length - 1 || colTypes[ci] === 'fanout') return nothing
            const mx = colX(ci) + JW + CGAP / 2
            return col.map(({ job, ji }) => {
              const jy = jobY[ji] + maxJH / 2
              const fromX = colX(ci) + JW
              const toX = mx - RC
              const bx = fromX + (toX - fromX) * 0.5
              const d = `M ${fromX} ${jy} C ${bx} ${jy}, ${bx} ${srcY}, ${toX} ${srcY}`
              const pathLen = 60
              return html`
                <path data-conn-out="${job.name}"
                  d="${d}" fill="none"
                  stroke="#3d3d3d" stroke-width="2"
                  stroke-dasharray="${pathLen}"
                  stroke-dashoffset="${pathLen}"
                  style="transition:stroke .3s" />
              `
            })
          })}

          <!-- Merge + trail resource circles -->
          ${cols.slice(0, -1).map((col, ci) => {
            if (colTypes[ci] === 'fanout') return nothing
            const mx = colX(ci) + JW + CGAP / 2
            return html`
              <circle data-rc="merge-${ci}" cx="${mx}" cy="${srcY}" r="${RC}"
                fill="#3d3d3d" style="transition:fill .3s,filter .3s" />
              <line data-conn-bridge="${ci}"
                x1="${mx + RC}" y1="${srcY}"
                x2="${colX(ci + 1)}" y2="${srcY}"
                stroke="#3d3d3d" stroke-width="2"
                style="transition:stroke .3s" />
            `
          })}

          <!-- Fan-out: individual outgoing connectors, no merge -->
          ${cols.map((col, ci) => {
            if (colTypes[ci] !== 'fanout') return nothing
            const tx = colX(ci) + JW + CGAP / 2
            return col.map(({ job, ji }) => {
              const jy = jobY[ji] + maxJH / 2
              const bx = colX(ci) + JW + (tx - RC - (colX(ci) + JW)) * 0.5
              const d = `M ${colX(ci) + JW} ${jy} C ${bx} ${jy}, ${bx} ${srcY}, ${tx - RC} ${srcY}`
              return html`<path data-conn-out="${job.name}" d="${d}" fill="none" stroke="#3d3d3d" stroke-width="2" stroke-dasharray="60" stroke-dashoffset="60" style="transition:stroke .3s" />`
            })
          })}

          <!-- Trail circle (after last col) -->
          <circle data-rc="trail"
            cx="${colX(cols.length - 1) + JW + CGAP / 2}"
            cy="${srcY}" r="${RC}"
            fill="#3d3d3d" style="transition:fill .3s" />

          <!-- Job boxes as foreignObject (to reuse job-box CSS) -->
          ${foreignJobBoxes.map(({ job, ji, x, y, h }) => html`
            <foreignObject x="${x}" y="${y}" width="${JW}" height="${h}">
              <div xmlns="http://www.w3.org/1999/xhtml">
                ${this._renderJobBox(job)}
              </div>
            </foreignObject>
            ${job.parallelGroup && job.row === 0 ? html`
              <text x="${x + JW / 2}" y="${y - 8}"
                text-anchor="middle" font-size="7"
                font-family="JetBrains Mono, monospace"
                fill="#71717a" letter-spacing="1">PARALLEL</text>
            ` : nothing}
            ${job.fanOutGroup && job.row === 0 ? html`
              <text x="${x + JW / 2}" y="${y - 8}"
                text-anchor="middle" font-size="7"
                font-family="JetBrains Mono, monospace"
                fill="#a78bfa" letter-spacing="1">FAN-OUT</text>
            ` : nothing}
            ${job.gate && !job.parallelGroup ? html`
              <text x="${x + JW / 2}" y="${y - 8}"
                text-anchor="middle" font-size="7"
                font-family="JetBrains Mono, monospace"
                fill="#fbbf24">${job.gate === 'approval' ? '⏸ APPROVAL' : '⏱ SCHEDULED'}</text>
            ` : nothing}
          `)}
        </svg>
      </div>
    `
  }

  render() {
    if (!this.data?.jobs?.length) {
      return html`<div style="padding:16px;color:#71717a;font-size:12px">No pipeline data</div>`
    }

    return html`
      <div class="pipeline-block">
        <div class="pipeline-header">
          <div class="pl-indicator" data-rc="pl-indicator"
            style="background: ${this.color}"></div>
          <span class="pl-team">${this.team || this.data.team || 'team'}</span>
          <span class="pl-sep">/</span>
          <span class="pl-name">${this.data.name || 'pipeline'}</span>
        </div>

        ${this._hasParallel()
          ? this._renderParallelSVG()
          : this._renderLinear()
        }

        <!-- Legend -->
        <div class="legend">
          <span class="leg-title">states:</span>
          ${[
            ['idle','#3d3d3d'],['pending','#8b572a'],['gate','#fbbf24'],
            ['running','#f5a623'],['succeeded','#11c560'],['failed','#ed4b35']
          ].map(([label, color]) => html`
            <div class="leg-item">
              <div class="leg-dot" style="background:${color}"></div>
              <span>${label}</span>
            </div>
          `)}
          <span class="leg-title" style="margin-left:8px">resources:</span>
          ${[['git','#f5a623'],['image','#38bdf8'],['s3','#fbbf24']].map(([label,color]) => html`
            <div class="leg-item">
              <div class="leg-dot round" style="background:${color}"></div>
              <span>${label}</span>
            </div>
          `)}
        </div>
      </div>
    `
  }
}

customElements.define('pipeline-viz', PipelineViz)
export { PipelineViz, STATES }
