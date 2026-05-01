/**
 * pipeline-anim.js — Tier 3: Animation
 *
 * Responsibilities:
 *   - Build and run GSAP timelines for pipeline animations
 *   - Listen to custom events from Tier 2 (<pipeline-viz>)
 *   - Drive visual motion: colors, opacity, stroke, transforms
 *   - Expose speed control (timeScale), pause, resume, scrub
 *   - Emit no events — purely a consumer
 *
 * Does NOT know about:
 *   - Concourse YAML or viz.json shape
 *   - Job/step state machine logic
 *   - Which framework renders the component
 *
 * Interface with Tier 2:
 *   Reads:   data-job, data-step, data-state attributes
 *            data-conn-in, data-conn-out, data-rc on SVG elements
 *   Listens: 'pv:ready', 'pv:state-change', 'pv:pipeline-done'
 *   Calls:   component.setJobState(), component.setStepState()
 *
 * Free GSAP features used (no Club GreenSock required):
 *   gsap.timeline()     — sequenced animation
 *   gsap.to/from/set()  — property animation
 *   tl.timeScale()      — speed control (replaces our speed prop)
 *   tl.addPause()       — manual step-through mode
 *   tl.call()           — callbacks at timeline points
 *   stagger             — sequential element animation
 *   ScrollTrigger       — viewport-triggered replay (free plugin)
 *
 *   stroke-dashoffset   — connector line draw animation
 *   (free replacement for DrawSVG paid plugin)
 */

import { gsap } from 'https://cdn.jsdelivr.net/npm/gsap@3/index.js'
import { ScrollTrigger } from 'https://cdn.jsdelivr.net/npm/gsap@3/ScrollTrigger.js'

gsap.registerPlugin(ScrollTrigger)

// ── STATE → VISUAL MAPPING ────────────────────────────────────────
// What each Concourse state looks like visually
const STATE_COLORS = {
  idle:      { border: '#3d3d3d', header: 'rgba(0,0,0,0.2)',       name: '#71717a' },
  pending:   { border: '#8b572a', header: 'rgba(139,87,42,0.10)',   name: '#8b572a' },
  gate:      { border: '#fbbf24', header: 'rgba(251,191,36,0.10)',  name: '#fbbf24' },
  running:   { border: '#f5a623', header: 'rgba(245,166,35,0.10)',  name: '#f5a623' },
  succeeded: { border: '#11c560', header: 'rgba(17,197,96,0.08)',   name: '#f4f4f5' },
  failed:    { border: '#ed4b35', header: 'rgba(237,75,53,0.08)',   name: '#ed4b35' },
  blocked:   { border: '#3d3d3d', header: 'rgba(0,0,0,0.2)',        name: '#3d3d3d' },
}

const RC_COLORS = {
  git:     '#f5a623',
  image:   '#38bdf8',
  s3:      '#fbbf24',
  semver:  '#a78bfa',
  notify:  '#10b981',
  unknown: '#71717a',
}

// ── TIMING TOKENS ─────────────────────────────────────────────────
// Semantic duration tokens — jobs use timing:'slow' instead of duration:2200
// Raw duration still works as an override: duration takes precedence over timing
const TIMING_TOKENS = {
  flash:   400,   // trigger, notify, get resource
  quick:   800,   // simple task, status post, semver bump
  steady: 1400,   // build, publish, changelog
  slow:   2200,   // test suite, compile+test
  crawl:  3000,   // security scan, heavy analysis
}

// ── TIMING DEFAULTS ───────────────────────────────────────────────
const T = {
  jobStart:    0.3,   // s — job header color transition
  stepReveal:  0.12,  // s — per-step opacity reveal
  stepStagger: 0.15,  // s — gap between step reveals
  connDraw:    0.5,   // s — connector line draw
  jobSuccess:  0.25,  // s — job border flash on success
  jobFail:     0.35,  // s — job border turn red
  rcPulse:     0.4,   // s — resource circle color change
}

// ── PIPELINE ANIMATOR ─────────────────────────────────────────────
export class PipelineAnimator {

  /**
   * @param {HTMLElement} component — the <pipeline-viz> element (Tier 2)
   * @param {Object} opts
   *   speed:       number  — initial timeScale (1=normal, 2=fast, 0.5=slow)
   *   mode:        'auto' | 'manual'
   *   replayDelay: number  — ms before auto-replay
   *   onDone:      fn      — called when pipeline completes
   */
  constructor(component, opts = {}) {
    this.component    = component
    this.speed        = opts.speed       ?? 1.0
    this.mode         = opts.mode        ?? 'auto'
    this.replayDelay  = opts.replayDelay ?? 3500
    this.onDone       = opts.onDone      ?? null

    this._masterTl = null   // the main GSAP timeline
    this._running  = false

    // Bind so we can removeEventListener later
    this._onReady = this._onReady.bind(this)
    component.addEventListener('pv:ready', this._onReady)
  }

  // ── PUBLIC API ────────────────────────────────────────────────────

  /** Set playback speed — wraps GSAP timeScale */
  setSpeed(multiplier) {
    this.speed = multiplier
    if (this._masterTl) this._masterTl.timeScale(multiplier)
  }

  /** Pause the animation at current position */
  pause() {
    this._masterTl?.pause()
  }

  /** Resume from current position */
  resume() {
    this._masterTl?.resume()
  }

  /** Scrub to a specific time in seconds */
  seek(seconds) {
    this._masterTl?.seek(seconds)
  }

  /** Advance one step (manual mode) */
  advance() {
    this._masterTl?.resume()
  }

  /** Restart the entire animation */
  replay() {
    this._masterTl?.kill()
    this.component.resetStates()
    this._buildAndPlay()
  }

  /** Destroy and clean up */
  destroy() {
    this._masterTl?.kill()
    this.component.removeEventListener('pv:ready', this._onReady)
  }

  // ── INTERNAL ──────────────────────────────────────────────────────

  _onReady() {
    this._buildAndPlay()
  }

  _buildAndPlay() {
    const jobs = this.component.getJobs()
    if (!jobs.length) return

    this._masterTl = this._buildTimeline(jobs)
    this._masterTl.timeScale(this.speed)
    this._masterTl.play()
  }

  // ── CONNECTOR LINE DRAW (free DrawSVG alternative) ─────────────────
  // Uses stroke-dashoffset — standard SVG, no plugin needed
  _drawConnector(el, duration = T.connDraw) {
    if (!el) return null
    // Measure the actual path length
    const len = el.getTotalLength ? el.getTotalLength() : 60

    return gsap.fromTo(el,
      { strokeDasharray: len, strokeDashoffset: len },
      { strokeDashoffset: 0, duration, ease: 'power2.inOut' }
    )
  }

  // ── JOB VISUAL TRANSITIONS ────────────────────────────────────────
  _animJobState(jobName, state) {
    const el = this.component.getJobEl(jobName)
    if (!el) return

    // Kill gate pulse when leaving gate state
    if (state !== 'gate' && el._gatePulse) {
      el._gatePulse.kill()
      delete el._gatePulse
      gsap.set(el, { boxShadow: 'none' })
    }

    const colors = STATE_COLORS[state] || STATE_COLORS.idle

    const tl = gsap.timeline()

    // Border color
    tl.to(el, {
      borderColor: colors.border,
      duration: T.jobStart,
      ease: 'power2.out',
    }, 0)

    // Header background
    const header = el.querySelector('.job-header')
    if (header) {
      tl.to(header, {
        backgroundColor: colors.header,
        duration: T.jobStart,
        ease: 'power2.out',
      }, 0)
    }

    // Job name color
    const nameEl = el.querySelector('.job-name')
    if (nameEl) {
      tl.to(nameEl, {
        color: colors.name,
        duration: T.jobStart,
        ease: 'power2.out',
      }, 0)
    }

    // Spinner visibility
    const spinner = el.querySelector('.spinner')
    const dot     = el.querySelector('.state-dot')
    if (spinner && dot) {
      if (state === 'running') {
        tl.to(spinner, { opacity: 1, duration: 0.15 }, 0)
        tl.to(dot,     { opacity: 0, duration: 0.15 }, 0)
        // Start spinner rotation via CSS animation class
        spinner.style.animation = 'pv-spin 0.7s linear infinite'
      } else {
        tl.to(spinner, { opacity: 0, duration: 0.15 }, 0)
        tl.to(dot,     { opacity: 1, duration: 0.15 }, 0)
        spinner.style.animation = ''
        // Dot color
        tl.to(dot, { backgroundColor: colors.border, duration: T.jobStart }, 0)
      }
    }

    // Gate pulse — amber glow
    if (state === 'gate') {
      el._gatePulse = gsap.to(el, {
        boxShadow: '0 0 14px rgba(251,191,36,.6)',
        repeat: -1, yoyo: true, duration: 0.6, ease: 'sine.inOut'
      })
    }

    // On succeeded: brief scale pulse
    if (state === 'succeeded') {
      tl.to(el, { scale: 1.02, duration: 0.1, ease: 'power2.out' })
      tl.to(el, { scale: 1.0,  duration: 0.2, ease: 'elastic.out(1, 0.5)' })
    }

    // On failed: shake
    if (state === 'failed') {
      tl.to(el, { x: -3, duration: 0.05 })
      tl.to(el, { x:  3, duration: 0.05 })
      tl.to(el, { x: -2, duration: 0.05 })
      tl.to(el, { x:  0, duration: 0.05 })
    }

    return tl
  }

  _animStepState(jobName, stepIndex, state, resourceType) {
    const el = this.component.getStepEl(jobName, stepIndex)
    if (!el) return

    const tl = gsap.timeline()

    if (state === 'running') {
      tl.to(el, { opacity: 1, backgroundColor: 'rgba(255,255,255,0.03)', duration: 0.15 }, 0)
      // Step label color
      const lbl = el.querySelector('.step-label')
      if (lbl) tl.to(lbl, { color: '#f4f4f5', duration: 0.15 }, 0)
    }
    else if (state === 'done') {
      tl.to(el, { opacity: 1, backgroundColor: 'transparent', duration: 0.15 }, 0)
      const lbl = el.querySelector('.step-label')
      if (lbl) tl.to(lbl, { color: '#a1a1aa', duration: 0.15 }, 0)
      // Resource dot glow on done
      if (resourceType) {
        const dot = el.querySelector('.rc-dot')
        const color = RC_COLORS[resourceType] || RC_COLORS.unknown
        if (dot) {
          tl.to(dot, {
            boxShadow: `0 0 5px ${color}`,
            duration: 0.2,
          }, 0)
        }
      }
    }
    else if (state === 'failed') {
      tl.to(el, { opacity: 1, backgroundColor: 'rgba(237,75,53,0.06)', duration: 0.15 }, 0)
      const lbl = el.querySelector('.step-label')
      if (lbl) tl.to(lbl, { color: '#ed4b35', duration: 0.15 }, 0)
    }

    return tl
  }

  // ── SVG ELEMENT ANIMATORS ─────────────────────────────────────────
  _animRC(selector, color, glow = false) {
    const el = this.component.shadowRoot?.querySelector(`[data-rc="${selector}"]`)
    if (!el) return
    gsap.to(el, {
      fill: color,
      filter: glow ? `drop-shadow(0 0 4px ${color})` : 'none',
      duration: T.rcPulse,
      ease: 'power2.out',
    })
  }

  // ── MAIN TIMELINE BUILDER ─────────────────────────────────────────
  _buildTimeline(jobs) {
    const tl = gsap.timeline({ paused: true })

    // Build dependency map
    const jobMap = {}
    jobs.forEach((j, i) => { jobMap[j.name] = i })

    // Track when each job ends (in timeline seconds) for dep calculation
    const jobEndTime = {}

    // Parallel group start alignment
    const groupStart = {}
    jobs.forEach(j => {
      const grpKey = j.parallelGroup || j.fanOutGroup
      if (!grpKey) return
      let gs = 0.4
      for (const dep of (j.depends_on || [])) {
        const di = jobMap[dep]
        if (di !== undefined && jobEndTime[di] !== undefined) {
          gs = Math.max(gs, jobEndTime[di] + 0.3)
        }
      }
      if (groupStart[grpKey] === undefined || gs > groupStart[grpKey]) {
        groupStart[grpKey] = gs
      }
    })

    let cursor = 0.4

    jobs.forEach((job, ji) => {
      // Determine start time
      let jstart = cursor

      const grpKey = job.parallelGroup || job.fanOutGroup
      if (grpKey) {
        jstart = groupStart[grpKey] ?? cursor
      } else {
        for (const dep of (job.depends_on || [])) {
          const di = jobMap[dep]
          if (di !== undefined && jobEndTime[di] !== undefined) {
            jstart = Math.max(jstart, jobEndTime[di] + 0.3)
          }
        }
      }

      // Check deps — if any dep failed, block this job
      const hasFail = (job.depends_on || []).some(dep => {
        const di = jobMap[dep]
        return di !== undefined && (job._depFailed?.[dep])
      })

      const stepCount  = job.steps?.length || 0
      const jobDur     = (job.duration || TIMING_TOKENS[job.timing] || (300 + stepCount * 480)) / 1000  // convert ms→s
      const failAtStep = job.failAtStep ?? -1
      const isRollback = !!job.triggeredByFailure

      // Gate delay extends the job timeline
      const gateDelaySec = job.gate ? (job.gateDelay || TIMING_TOKENS[job.gateTiming] || 2000) / 1000 : 0
      const runStart = jstart + gateDelaySec

      // ── Pending ──────────────────────────────────────────────────
      tl.call(() => {
        // Re-check at runtime whether deps failed
        const depFailed = (job.depends_on || []).some(dep => {
          const di = jobMap[dep]
          if (di === undefined) return false
          return this.component._jobStates?.[jobs[di]?.name] !== 'succeeded'
        })
        const rollbackOk = !isRollback || (
          this.component._jobStates?.[job.triggeredByFailure] === 'failed'
        )
        if (!depFailed && (!isRollback || rollbackOk)) {
          this.component.setJobState(job.name, 'pending')
          this._animJobState(job.name, 'pending')
        }
      }, [], jstart - 0.2)

      // ── Draw incoming connector (free DrawSVG alternative) ──────
      tl.call(() => {
        const depFailed = (job.depends_on || []).some(dep => {
          const di = jobMap[dep]
          return di !== undefined &&
            this.component._jobStates?.[jobs[di]?.name] !== 'succeeded'
        })
        const rollbackOk = !isRollback || (
          this.component._jobStates?.[job.triggeredByFailure] === 'failed'
        )
        if (!depFailed && (!isRollback || rollbackOk)) {
          const sr = this.component.shadowRoot
          const connInEl  = sr?.querySelector(`[data-conn-in="${job.name}"]`)
          const linearConn = sr?.querySelector(`.connector[data-conn="${ji}"] .conn-line`)
          const connEl = connInEl || linearConn
          if (connEl) {
            this._drawConnector(connEl, T.connDraw)
            gsap.to(connEl, { stroke: '#f5a623', duration: T.connDraw })
          }
        }
      }, [], jstart - 0.1)

      // ── Running ──────────────────────────────────────────────────
      const runLabel = `job-${job.name}-run`

      if (job.gate) {
        const gateStepIdx = (job.steps || []).findIndex(s => s.type === 'gate')
        // Enter gate state
        tl.call(() => {
          const depFailed = (job.depends_on || []).some(dep => {
            const di = jobMap[dep]
            return di !== undefined && this.component._jobStates?.[jobs[di]?.name] !== 'succeeded'
          })
          const rollbackOk = !isRollback || (this.component._jobStates?.[job.triggeredByFailure] === 'failed')
          if (!depFailed && (!isRollback || rollbackOk)) {
            this.component.setJobState(job.name, 'gate')
            this._animJobState(job.name, 'gate')
            if (gateStepIdx >= 0) {
              this.component.setStepState(job.name, gateStepIdx, 'running')
              this._animStepState(job.name, gateStepIdx, 'running')
            }
          }
        }, [], jstart)

        if (failAtStep === gateStepIdx) {
          // Gate rejected
          tl.call(() => {
            if (this.component._jobStates?.[job.name] === 'gate') {
              if (gateStepIdx >= 0) {
                this.component.setStepState(job.name, gateStepIdx, 'failed')
                this._animStepState(job.name, gateStepIdx, 'failed')
              }
              this.component.setJobState(job.name, 'failed')
              this._animJobState(job.name, 'failed')
            }
          }, [], jstart + gateDelaySec * 0.5)
        } else {
          // Gate approved
          tl.call(() => {
            if (this.component._jobStates?.[job.name] === 'gate') {
              if (gateStepIdx >= 0) {
                this.component.setStepState(job.name, gateStepIdx, 'done')
                this._animStepState(job.name, gateStepIdx, 'done')
              }
              this.component.setJobState(job.name, 'running')
              this._animJobState(job.name, 'running')
            }
          }, [], runStart)
        }
      } else {
        // Regular running (no gate)
        tl.call(() => {
          const depFailed = (job.depends_on || []).some(dep => {
            const di = jobMap[dep]
            return di !== undefined &&
              this.component._jobStates?.[jobs[di]?.name] !== 'succeeded'
          })
          const rollbackOk = !isRollback || (
            this.component._jobStates?.[job.triggeredByFailure] === 'failed'
          )
          if (!depFailed && (!isRollback || rollbackOk)) {
            this.component.setJobState(job.name, 'running')
            this._animJobState(job.name, 'running')
          }
        }, [], jstart)
      }

      // In manual mode: pause after each job starts (except first)
      if (this.mode === 'manual' && ji > 0) {
        tl.addPause(jstart + 0.05)
      }

      // ── Steps ─────────────────────────────────────────────────────
      let stepCursor = runStart + 0.2
      const stepDur  = (jobDur - 0.3) / Math.max(stepCount, 1)

      const stepsToAnimate = (job.steps || []).map((s, i) => ({step: s, si: i}))
        .filter(({step}) => !(job.gate && step.type === 'gate'))

      stepsToAnimate.forEach(({step, si}) => {
        const isFailStep = si === failAtStep

        // Step running
        tl.call(() => {
          if (this.component._jobStates?.[job.name] === 'running') {
            this.component.setStepState(job.name, si, 'running')
            this._animStepState(job.name, si, 'running', step.resource_type)
          }
        }, [], stepCursor)

        stepCursor += stepDur * 0.65

        if (isFailStep) {
          // Step and job fail
          tl.call(() => {
            this.component.setStepState(job.name, si, 'failed')
            this._animStepState(job.name, si, 'failed', step.resource_type)
            this.component.setJobState(job.name, 'failed')
            this._animJobState(job.name, 'failed')
            // Update RC color to failed
            const sr = this.component.shadowRoot
            const connInEl = sr?.querySelector(`[data-conn-out="${job.name}"]`)
            if (connInEl) gsap.to(connInEl, { stroke: '#ed4b35', duration: 0.3 })
          }, [], stepCursor)

        } else if (failAtStep >= 0 && si > failAtStep) {
          // Skip remaining steps after failure
        } else {
          // Step done
          tl.call(() => {
            if (this.component._jobStates?.[job.name] === 'running') {
              this.component.setStepState(job.name, si, 'done')
              this._animStepState(job.name, si, 'done', step.resource_type)
            }
          }, [], stepCursor)
          stepCursor += stepDur * 0.35
        }
      })

      // ── Succeed ──────────────────────────────────────────────────
      const jobEndAt = jstart + gateDelaySec + jobDur
      jobEndTime[ji] = jobEndAt

      if (failAtStep < 0) {
        tl.call(() => {
          const depFailed = (job.depends_on || []).some(dep => {
            const di = jobMap[dep]
            return di !== undefined &&
              this.component._jobStates?.[jobs[di]?.name] !== 'succeeded'
          })
          if (!depFailed || isRollback) {
            this.component.setJobState(job.name, 'succeeded')
            this._animJobState(job.name, 'succeeded')

            // Update merge/trail resource circles
            const sr = this.component.shadowRoot

            // Linear: color the outgoing connector
            const outConn = sr?.querySelector(`.connector[data-conn="${ji+1}"] .conn-line`)
            if (outConn) {
              gsap.to(outConn, { backgroundColor: '#11c560', duration: 0.3 })
            }

            // Parallel: color outgoing bezier
            const bezOut = sr?.querySelector(`[data-conn-out="${job.name}"]`)
            if (bezOut) {
              gsap.to(bezOut, { stroke: '#11c560', duration: 0.3 })
            }

            // Check if all jobs in parallel group succeeded → animate merge circle
            if (job.parallelGroup && !job.fanOutGroup) {
              const groupJobs = jobs.filter(j => j.parallelGroup === job.parallelGroup)
              const allOk = groupJobs.every(gj =>
                this.component._jobStates?.[gj.name] === 'succeeded'
              )
              const anyFail = groupJobs.some(gj =>
                this.component._jobStates?.[gj.name] === 'failed'
              )
              const allDone = groupJobs.every(gj =>
                ['succeeded','failed'].includes(this.component._jobStates?.[gj.name])
              )
              // Guard: only evaluate merge when all siblings have finished
              if (!allDone) return
              const colIdx = this._getColumnIndex(jobs, groupJobs[0])
              if (allOk && !anyFail) {
                this._animRC(`merge-${colIdx}`, '#11c560', true)
                // Draw bridge to next column
                const bridge = sr?.querySelector(`[data-conn-bridge="${colIdx}"]`)
                if (bridge) {
                  gsap.to(bridge, { stroke: '#11c560', duration: T.connDraw })
                }
              }
              // anyFail merge already handled by fail callback
            }
          }
        }, [], jobEndAt)
      }

      // Advance cursor for sequential jobs
      if (!job.parallelGroup && !job.fanOutGroup) cursor = jstart + 0.2
    })

    // ── Pipeline complete ──────────────────────────────────────────
    const totalEnd = Math.max(...Object.values(jobEndTime), cursor) + 0.4

    tl.call(() => {
      const anyFail = Object.values(this.component._jobStates || {}).some(s => s === 'failed')

      // Trail circle
      this._animRC('trail', anyFail ? '#ed4b35' : '#38bdf8', !anyFail)

      this.component.dispatchEvent(new CustomEvent('pv:pipeline-done', {
        detail: { success: !anyFail },
        bubbles: true, composed: true,
      }))

      if (this.onDone) this.onDone({ success: !anyFail })

      // Auto-replay
      if (this.mode === 'auto') {
        setTimeout(() => this.replay(), this.replayDelay)
      }
    }, [], totalEnd)

    return tl
  }

  _getColumnIndex(jobs, job) {
    const seen = {}
    let ci = 0
    for (const j of jobs) {
      const g = j.parallelGroup || j.fanOutGroup || `_s${jobs.indexOf(j)}`
      if (!(g in seen)) { seen[g] = ci++ }
      if (j.name === job.name) return seen[g]
    }
    return 0
  }
}

// ── CONVENIENCE FACTORY ───────────────────────────────────────────
/**
 * animate(component, opts) → PipelineAnimator
 *
 * Simplest possible usage:
 *   const anim = animate(document.querySelector('pipeline-viz'))
 *   anim.setSpeed(2)
 *   anim.replay()
 */
export function animate(component, opts = {}) {
  return new PipelineAnimator(component, opts)
}
