/**
 * parser.js — Tier 1: Data
 *
 * Input:  Concourse pipeline YAML string
 * Output: { resources, jobs } — viz.json shape
 *
 * Pure function. Zero side effects. No DOM. No animation.
 * Depends only on js-yaml.
 *
 * Usage:
 *   import { parsePipeline } from './parser.js'
 *   const viz = parsePipeline(yamlString)
 */

// js-yaml loaded as global (CDN) or imported as module
const yaml = (typeof jsyaml !== 'undefined') ? jsyaml
  : (await import('https://cdn.jsdelivr.net/npm/js-yaml@4/dist/js-yaml.mjs')).default

// ── RESOURCE TYPE LOOKUP ──────────────────────────────────────────
// Maps Concourse resource type names to semantic tokens
// used by Tier 2 for visual styling
const RESOURCE_TOKENS = {
  'git':                 'git',
  'registry-image':      'image',
  'docker-image':        'image',
  's3':                  's3',
  'semver':              'semver',
  'time':                'time',
  'slack-notification':  'notify',
  'github-release':      'git',
  'cf':                  'deploy',
  'kubernetes':          'deploy',
  'helm-release':        'deploy',
  'concourse-pipeline':  'pipeline',
}

function resourceToken(type) {
  return RESOURCE_TOKENS[type] || 'unknown'
}

// ── STEP EXTRACTOR ────────────────────────────────────────────────
// Recursively extracts steps from a Concourse plan array.
// Handles: get, put, task, in_parallel, do, try, set_pipeline, across
function extractSteps(plan, resourceTypes) {
  const steps = []

  for (const step of (plan || [])) {
    if (!step) continue

    if (step.get !== undefined) {
      steps.push({
        label:         `get: ${step.get}`,
        type:          'resource',
        resource_type: resourceToken(resourceTypes[step.get] || 'unknown'),
        raw_type:      resourceTypes[step.get] || 'unknown',
        trigger:       step.trigger || false,
      })
    }
    else if (step.put !== undefined) {
      steps.push({
        label:         `put: ${step.put}`,
        type:          'resource',
        resource_type: resourceToken(resourceTypes[step.put] || 'unknown'),
        raw_type:      resourceTypes[step.put] || 'unknown',
      })
    }
    else if (step.task !== undefined) {
      steps.push({
        label: `task: ${step.task}`,
        type:  'task',
      })
    }
    else if (step.set_pipeline !== undefined) {
      steps.push({
        label: `set_pipeline: ${step.set_pipeline}`,
        type:  'task',
      })
    }
    else if (step.in_parallel !== undefined) {
      const inner = Array.isArray(step.in_parallel)
        ? step.in_parallel
        : (step.in_parallel.steps || [])
      steps.push(...extractSteps(inner, resourceTypes))
    }
    else if (step.do !== undefined) {
      steps.push(...extractSteps(step.do, resourceTypes))
    }
    else if (step.try !== undefined) {
      const inner = step.try.step ? [step.try.step] : [step.try]
      steps.push(...extractSteps(inner, resourceTypes))
    }
    else if (step.across !== undefined) {
      steps.push({ label: 'across: (parallel vars)', type: 'task' })
    }
    else if (step.load_var !== undefined) {
      steps.push({ label: `load_var: ${step.load_var}`, type: 'task' })
    }
    else if (step.gate !== undefined) {
      steps.push({
        label: `gate: ${step.gate}`,
        type: 'gate',
      })
    }
  }

  return steps
}

// ── DEPENDENCY EXTRACTOR ──────────────────────────────────────────
// Reads `passed: [...]` from get steps to infer job dependencies.
// No manual annotation needed — it's already in the YAML.
function extractDependencies(plan) {
  const deps = new Set()

  for (const step of (plan || [])) {
    if (!step) continue

    if (step.get !== undefined && step.passed) {
      for (const d of step.passed) deps.add(d)
    }

    // Recurse
    const inner = step.in_parallel
      ? (Array.isArray(step.in_parallel) ? step.in_parallel : step.in_parallel.steps || [])
      : step.do || []

    if (inner.length) {
      for (const d of extractDependencies(inner)) deps.add(d)
    }
  }

  return [...deps]
}

// ── TOPOLOGICAL SORT ──────────────────────────────────────────────
// Orders jobs so that dependencies always come before dependents.
// Enables left-to-right rendering in Tier 2.
function topoSort(jobs) {
  const result  = []
  const visited = new Set()
  const nameMap = {}
  jobs.forEach(j => nameMap[j.name] = j)

  function visit(job) {
    if (visited.has(job.name)) return
    visited.add(job.name)
    for (const dep of (job.depends_on || [])) {
      if (nameMap[dep]) visit(nameMap[dep])
    }
    result.push(job)
  }

  jobs.forEach(j => visit(j))
  return result
}

// ── PARALLEL GROUP DETECTION ──────────────────────────────────────
// Jobs with no dependency between them that share a downstream
// dependent are candidates for parallel grouping.
// Assigns parallelGroup + row for Tier 2 layout.
function assignParallelGroups(jobs) {
  const nameMap = {}
  jobs.forEach((j, i) => nameMap[j.name] = i)

  // Find downstream dependents per job
  const downstreamOf = {}
  jobs.forEach(j => {
    for (const dep of (j.depends_on || [])) {
      if (!downstreamOf[dep]) downstreamOf[dep] = []
      downstreamOf[dep].push(j.name)
    }
  })

  // Group jobs that share the exact same set of downstream dependents
  // and have no dependency between each other
  const groups = {}
  jobs.forEach(j => {
    const downs = (downstreamOf[j.name] || []).sort().join(',')
    if (!downs) return  // terminal job — no grouping
    if (!groups[downs]) groups[downs] = []
    groups[downs].push(j.name)
  })

  // Assign parallelGroup + row only when group has 2+ members
  const assigned = {}
  Object.entries(groups).forEach(([key, members]) => {
    if (members.length < 2) return
    members.forEach((name, row) => {
      assigned[name] = { parallelGroup: key, row }
    })
  })

  return jobs.map(j => assigned[j.name]
    ? { ...j, ...assigned[j.name] }
    : j
  )
}

// ── MAIN PARSER ───────────────────────────────────────────────────
/**
 * parsePipeline(yamlString) → viz
 *
 * viz = {
 *   name:      string | null,
 *   resources: { [name]: type },
 *   jobs: [{
 *     name:          string,
 *     steps:         Step[],
 *     depends_on:    string[],
 *     parallelGroup: string | undefined,
 *     row:           number | undefined,
 *   }]
 * }
 */
export function parsePipeline(yamlString) {
  if (!yamlString?.trim()) throw new Error('Empty YAML')

  const pipeline = yaml.load(yamlString)
  if (!pipeline)            throw new Error('Could not parse YAML')
  if (!pipeline.jobs?.length) throw new Error('No "jobs" array found')

  // Build resource type map
  const resourceTypes = {}
  for (const r of (pipeline.resources || [])) {
    if (r.name && r.type) resourceTypes[r.name] = r.type
  }

  // Parse jobs
  const rawJobs = pipeline.jobs.map(job => ({
    name:       job.name,
    steps:      extractSteps(job.plan || [], resourceTypes),
    depends_on: extractDependencies(job.plan || []),
    // Gate/fan-out annotations (passed through for Tier 2/3)
    ...(job.gate && { gate: job.gate }),
    ...(job.gate_delay && { gateDelay: job.gate_delay }),
    ...(job.gate_label && { gateLabel: job.gate_label }),
    ...(job.fan_out_group && { fanOutGroup: job.fan_out_group }),
  }))

  // Sort and group
  const sorted  = topoSort(rawJobs)
  const grouped = assignParallelGroups(sorted)

  return {
    name:      pipeline.name || null,
    resources: resourceTypes,
    jobs:      grouped,
  }
}

// ── SERIALISE TO JS MODULE ────────────────────────────────────────
/**
 * toJsModule(viz, opts) → string
 *
 * Produces a .js file ready to drop into
 * pipeline-viz-slides/data/ and import in Slidev.
 */
export function toJsModule(viz, opts = {}) {
  const {
    varName  = 'myPipeline',
    name     = viz.name || 'my-pipeline',
    team     = 'my-team',
    color    = '#10b981',
  } = opts

  const data = { name, team, color, resources: viz.resources, jobs: viz.jobs }

  return [
    `// Generated by pipeline-viz parser`,
    `// Drop in pipeline-viz-slides/data/ and import in slides.md`,
    ``,
    `export const ${varName} = ${JSON.stringify(data, null, 2)};`,
  ].join('\n')
}
