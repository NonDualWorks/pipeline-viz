// Pipeline Viz — shared engine (Tier 2 + Tier 3 + wiring)
// Each demo page loads via <script src="shared.js"> then calls PV.boot(scenarios, default)
// Works from file:// — no ES module CORS issues.

// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════
const RC_COLORS = {
  git:'#f5a623', image:'#38bdf8', 's3':'#fbbf24',
  semver:'#a78bfa', notify:'#10b981', unknown:'#71717a'
}

const TIMING_TOKENS = {
  flash:   400,
  quick:   800,
  steady: 1400,
  slow:   2200,
  crawl:  3000,
}

// ══════════════════════════════════════════════════════════════════
// TIER 2 — COMPONENT (plain JS DOM builder)
// ══════════════════════════════════════════════════════════════════
function createPipelineComponent(host) {
  const GATE_ICONS = { approval:'\u23F8', scheduled:'\u23F1', conditional:'\u26A1', manual:'\uD83D\uDD12' }

  return {
    _data: null,
    _js: {},
    _ss: {},

    setJobState(name, state) {
      const from = this._js[name] || 'idle'
      if (from === state) return
      this._js[name] = state
      const el = document.querySelector(`[data-job="${name}"]`)
      if (el) el.dataset.state = state
      host.dispatchEvent(new CustomEvent('pv:state-change', {
        detail:{ job:name, step:null, from, to:state }, bubbles:true
      }))
    },

    setStepState(name, si, state) {
      const key = `${name}:${si}`
      const from = this._ss[key] || 'idle'
      if (from === state) return
      this._ss[key] = state
      const el = document.querySelector(`[data-job="${name}"] [data-step="${si}"]`)
      if (el) el.dataset.state = state
      host.dispatchEvent(new CustomEvent('pv:state-change', {
        detail:{ job:name, step:si, from, to:state }, bubbles:true
      }))
    },

    getJobEl(name)     { return document.querySelector(`[data-job="${name}"]`) },
    getStepEl(name,si) { return document.querySelector(`[data-job="${name}"] [data-step="${si}"]`) },
    getJobs()          { return this._data?.jobs || [] },

    resetStates() {
      this._js = {}; this._ss = {}
      document.querySelectorAll('[data-state]').forEach(el => el.dataset.state='idle')
    },

    render(data) {
      this._data = data; this._js = {}; this._ss = {}
      host.innerHTML = ''
      const root = document.createElement('div')
      root.className = 'pv-root'
      root.innerHTML = this._buildHTML(data)
      host.appendChild(root)
      host.dispatchEvent(new CustomEvent('pv:ready', { detail:{ jobs:data.jobs }, bubbles:true }))
    },

    _buildHTML(data) {
      const jobs = data.jobs || []
      const zones = data.zones || []
      const hasZones = zones.length > 0
      const JW=134, STEP_H=11, JH_BASE=20, JH_MIN=44, CGAP=64, RGAP=18, RC=6, PX=36, PY=28
      const ZONE_GAP = hasZones ? 36 : 0
      const ZONE_H = hasZones ? 26 : 0
      const jh = j => Math.max(JH_MIN, JH_BASE + (j.steps?.length||0)*STEP_H + 4)

      const seen={}; const cols=[]; const colType=[]
      jobs.forEach((j,ji) => {
        const g = j.parallelGroup || j.fanOutGroup || `_${ji}`
        if(!(g in seen)){
          seen[g]=cols.length;cols.push([])
          colType.push(j.parallelGroup?'parallel':j.fanOutGroup?'fanout':'sequential')
        }
        cols[seen[g]].push({job:j,ji})
      })

      const colZone = cols.map(col => col[0].job.zone || '')
      const zoneBreaks = []
      if (hasZones) {
        for (let i = 1; i < colZone.length; i++) {
          if (colZone[i] !== colZone[i-1]) zoneBreaks.push(i)
        }
      }
      const zoneGapBefore = ci => {
        let gaps = 0
        for (const bi of zoneBreaks) { if (ci >= bi) gaps++ }
        return gaps * ZONE_GAP
      }

      const maxJH = Math.max(...jobs.map(j=>jh(j)), JH_MIN)
      const maxRows = Math.max(...cols.map(c=>c.length),1)
      const innerH = maxRows*maxJH + (maxRows-1)*RGAP
      const totalZoneGaps = zoneBreaks.length * ZONE_GAP
      const H = innerH + PY*2 + ZONE_H
      const W = PX + RC*2 + CGAP + cols.length*(JW+CGAP) + RC*2 + PX + totalZoneGaps
      const colX = ci => PX + RC*2 + CGAP + ci*(JW+CGAP) + zoneGapBefore(ci)
      const srcX = PX+RC
      const srcY = ZONE_H + (innerH + PY*2)/2

      const jobY = {}
      cols.forEach((col,ci)=>{
        const tH = col.length*maxJH + (col.length-1)*RGAP
        const sY = srcY - tH/2
        col.forEach(({ji},ri) => { jobY[ji] = sY + ri*(maxJH+RGAP) })
      })

      const jobBoxHTML = (job,ji,x,y,h) => `
        <div class="job-box" data-job="${job.name}" data-state="idle"
          style="width:${JW}px;height:${h}px;position:absolute;left:0;top:0">
          <div class="job-header">
            <div class="state-wrap">
              <div class="spinner-j"></div>
              <div class="s-dot-j"></div>
            </div>
            <span class="job-name-j">${job.name}</span>
          </div>
          <div class="job-steps-j">
            ${(job.steps||[]).map((step,si)=>`
              <div class="step-row-j" data-step="${si}" data-state="idle">
                ${step.type==='resource'
                  ? `<div class="rc-dot-j" style="background:${RC_COLORS[step.resource_type]||'#71717a'}"></div>`
                  : step.type==='gate'
                    ? `<div class="g-dot-j"></div>`
                    : `<div class="t-dot-j"></div>`}
                <span class="step-lbl-j">${step.label}</span>
              </div>`).join('')}
          </div>
        </div>`

      let pathsSVG = ''
      pathsSVG += `<circle data-rc="source" cx="${srcX}" cy="${srcY}" r="${RC}" fill="#3d3d3d"/>`

      cols.forEach((col,ci) => {
        const cx = colX(ci)
        const isFanout = colType[ci]==='fanout'
        col.forEach(({job,ji}) => {
          const jy = jobY[ji] + maxJH/2
          const fromX = ci===0 ? srcX+RC : colX(ci)-CGAP/2+RC
          const fromY = srcY
          const mx = fromX + (cx-fromX)*0.5
          const d = `M ${fromX} ${fromY} C ${mx} ${fromY}, ${mx} ${jy}, ${cx} ${jy}`
          pathsSVG += `<path data-conn-in="${job.name}" d="${d}" fill="none" stroke="#3d3d3d" stroke-width="2" stroke-dasharray="80" stroke-dashoffset="80"/>`
        })

        if (ci < cols.length-1 && !isFanout) {
          const mx = cx + JW + CGAP/2
          col.forEach(({job,ji}) => {
            const jy = jobY[ji] + maxJH/2
            const bx = cx+JW + (mx-RC-(cx+JW))*0.5
            const d = `M ${cx+JW} ${jy} C ${bx} ${jy}, ${bx} ${srcY}, ${mx-RC} ${srcY}`
            pathsSVG += `<path data-conn-out="${job.name}" d="${d}" fill="none" stroke="#3d3d3d" stroke-width="2" stroke-dasharray="80" stroke-dashoffset="80"/>`
          })
          pathsSVG += `<circle data-rc="merge-${ci}" cx="${mx}" cy="${srcY}" r="${RC}" fill="#3d3d3d"/>`
          pathsSVG += `<line data-conn-bridge="${ci}" x1="${mx+RC}" y1="${srcY}" x2="${colX(ci+1)}" y2="${srcY}" stroke="#3d3d3d" stroke-width="2"/>`
        } else {
          const tx = cx+JW+CGAP/2
          col.forEach(({job,ji}) => {
            const jy = jobY[ji] + maxJH/2
            const bx = cx+JW + (tx-RC-(cx+JW))*0.5
            const d = `M ${cx+JW} ${jy} C ${bx} ${jy}, ${bx} ${srcY}, ${tx-RC} ${srcY}`
            pathsSVG += `<path data-conn-out="${job.name}" d="${d}" fill="none" stroke="#3d3d3d" stroke-width="2" stroke-dasharray="80" stroke-dashoffset="80"/>`
          })
          if(ci===cols.length-1 || isFanout)
            pathsSVG += `<circle data-rc="trail" cx="${tx}" cy="${srcY}" r="${RC}" fill="#3d3d3d"/>`
        }
      })

      let zoneSVG = ''
      if (hasZones) {
        const zoneRanges = {}
        colZone.forEach((z, ci) => {
          if (!z) return
          if (!zoneRanges[z]) zoneRanges[z] = { first: ci, last: ci }
          else zoneRanges[z].last = ci
        })
        zones.forEach(zone => {
          const range = zoneRanges[zone.id]
          if (!range) return
          const x1 = colX(range.first) - 10
          const x2 = colX(range.last) + JW + 10
          const zw = x2 - x1
          zoneSVG += `<rect x="${x1}" y="3" width="${zw}" height="20" rx="4" fill="${zone.color}" opacity="0.06"/>`
          zoneSVG += `<line x1="${x1}" y1="23" x2="${x2}" y2="23" stroke="${zone.color}" stroke-width="1.5" opacity="0.4"/>`
          zoneSVG += `<text x="${x1+8}" y="16" font-size="8" font-family="JetBrains Mono,monospace" fill="${zone.color}" font-weight="600" letter-spacing="0.5" opacity="0.8">${zone.label.toUpperCase()}</text>`
        })
      }

      let foSVG = ''
      jobs.forEach((job,ji) => {
        const ci = cols.findIndex(c=>c.some(e=>e.ji===ji))
        const x=colX(ci), y=jobY[ji], h=jh(job)
        foSVG += `<foreignObject x="${x}" y="${y}" width="${JW}" height="${h}">
          <div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${JW}px;height:${h}px">
            ${jobBoxHTML(job,ji,x,y,h)}
          </div>
        </foreignObject>`
        if (job.parallelGroup && job.row===0) {
          foSVG += `<text x="${x+JW/2}" y="${y-8}" text-anchor="middle" font-size="7" font-family="JetBrains Mono,monospace" fill="#71717a" letter-spacing="1">PARALLEL</text>`
        }
        if (job.fanOutGroup && job.row===0) {
          foSVG += `<text x="${x+JW/2}" y="${y-8}" text-anchor="middle" font-size="7" font-family="JetBrains Mono,monospace" fill="#a78bfa" letter-spacing="1">FAN-OUT</text>`
        }
        if (job.gate && !job.parallelGroup) {
          if (job.gateActor) {
            foSVG += `<text x="${x+JW/2}" y="${y-8}" text-anchor="middle" font-size="7" font-family="JetBrains Mono,monospace" fill="${job.gateActorColor||'#fbbf24'}" letter-spacing="1">\u{1F464} ${job.gateActor.toUpperCase()}</text>`
          } else {
            const icon = GATE_ICONS[job.gate] || '\u23F8'
            foSVG += `<text x="${x+JW/2}" y="${y-8}" text-anchor="middle" font-size="7" font-family="JetBrains Mono,monospace" fill="#fbbf24" letter-spacing="1">${icon} ${job.gate.toUpperCase()}</text>`
          }
        }
      })

      const legendHTML = `<div class="pv-legend">
        <span class="leg-t">states:</span>
        ${[['idle','#3d3d3d'],['pending','#8b572a'],['gate','#fbbf24'],['running','#f5a623'],['succeeded','#11c560'],['failed','#ed4b35']].map(([l,c])=>
          `<div class="leg-i"><div class="leg-d" style="background:${c}"></div><span>${l}</span></div>`).join('')}
        <span class="leg-t" style="margin-left:8px">resources:</span>
        ${[['git','#f5a623'],['image','#38bdf8'],['s3','#fbbf24']].map(([l,c])=>
          `<div class="leg-i"><div class="leg-d rnd" style="background:${c}"></div><span>${l}</span></div>`).join('')}
      </div>`

      return `
        <div class="pv-header">
          <div class="pv-dot" style="background:${data.color||'#10b981'}"></div>
          <span class="pv-team">${data.team||'team'}</span>
          <span class="pv-sep">/</span>
          <span class="pv-name">${data.name||'pipeline'}</span>
        </div>
        <div class="pv-svg-scroll">
          <svg width="${W}" height="${H}">
            ${zoneSVG}${pathsSVG}${foSVG}
            <style>@keyframes pv-spin{to{transform:rotate(360deg)}}</style>
          </svg>
        </div>
        ${legendHTML}`
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// TIER 3 — ANIMATION (GSAP)
// ══════════════════════════════════════════════════════════════════
const VIS = {
  idle:      {border:'#3d3d3d',header:'rgba(0,0,0,0.2)',      name:'#71717a'},
  pending:   {border:'#8b572a',header:'rgba(139,87,42,0.10)',  name:'#8b572a'},
  gate:      {border:'#fbbf24',header:'rgba(251,191,36,0.10)', name:'#fbbf24'},
  running:   {border:'#f5a623',header:'rgba(245,166,35,0.10)', name:'#f5a623'},
  succeeded: {border:'#11c560',header:'rgba(17,197,96,0.08)',  name:'#f4f4f5'},
  failed:    {border:'#ed4b35',header:'rgba(237,75,53,0.08)',  name:'#ed4b35'},
}

function animJob(comp, name, state) {
  const el = comp.getJobEl(name); if(!el) return
  const v = VIS[state]||VIS.idle
  if(state!=='gate'&&el._gatePulse){el._gatePulse.kill();delete el._gatePulse;gsap.set(el,{boxShadow:'none'})}
  gsap.to(el, {borderColor:v.border, duration:.25, ease:'power2.out'})
  const hdr=el.querySelector('.job-header')
  if(hdr) gsap.to(hdr,{backgroundColor:v.header,duration:.25})
  const nm=el.querySelector('.job-name-j')
  if(nm)  gsap.to(nm,{color:v.name,duration:.25})
  const sp=el.querySelector('.spinner-j'), dot=el.querySelector('.s-dot-j')
  if(sp&&dot){
    if(state==='running'){gsap.to(sp,{opacity:1,duration:.15});gsap.to(dot,{opacity:0,duration:.15})}
    else{gsap.to(sp,{opacity:0,duration:.15});gsap.to(dot,{opacity:1,duration:.15,backgroundColor:v.border})}
  }
  if(state==='gate'){
    el._gatePulse=gsap.to(el,{boxShadow:'0 0 14px rgba(251,191,36,.6)',repeat:-1,yoyo:true,duration:.6,ease:'sine.inOut'})
  }
  if(state==='succeeded'){
    gsap.timeline().to(el,{scale:1.02,duration:.1,ease:'power2.out'}).to(el,{scale:1,duration:.2,ease:'elastic.out(1,.5)'})
  }
  if(state==='failed'){
    gsap.timeline().to(el,{x:-3,duration:.05}).to(el,{x:3,duration:.05}).to(el,{x:-2,duration:.05}).to(el,{x:0,duration:.05})
  }
}

function animStep(comp, name, si, state) {
  const el=comp.getStepEl(name,si); if(!el) return
  if(state==='running'){
    gsap.to(el,{opacity:1,backgroundColor:'rgba(255,255,255,0.03)',duration:.12})
    const lb=el.querySelector('.step-lbl-j'); if(lb) gsap.to(lb,{color:'#f4f4f5',duration:.12})
  } else if(state==='done'){
    gsap.to(el,{opacity:1,backgroundColor:'transparent',duration:.12})
    const lb=el.querySelector('.step-lbl-j'); if(lb) gsap.to(lb,{color:'#a1a1aa',duration:.12})
  } else if(state==='failed'){
    gsap.to(el,{opacity:1,backgroundColor:'rgba(237,75,53,0.06)',duration:.12})
    const lb=el.querySelector('.step-lbl-j'); if(lb) gsap.to(lb,{color:'#ed4b35',duration:.12})
  }
}

function drawConn(selector, color, duration=0.5) {
  const el = document.querySelector(selector); if(!el) return
  const len = el.getTotalLength ? el.getTotalLength() : 80
  gsap.set(el,{strokeDasharray:len,strokeDashoffset:len})
  gsap.to(el,{strokeDashoffset:0,stroke:color,duration,ease:'power2.inOut'})
}

function animRC(selector, color, glow=false) {
  const el=document.querySelector(`[data-rc="${selector}"]`); if(!el) return
  gsap.to(el,{fill:color,filter:glow?`drop-shadow(0 0 5px ${color})`:'none',duration:.4})
}

function buildTimeline(comp, jobs, mode, speed, replayDelay, onDone, startAnimFn) {
  const tl = gsap.timeline({paused:true})
  const jmap={}; jobs.forEach((j,i)=>jmap[j.name]=i)
  const jEnd={}
  const gStart={}
  let cursor=0.4

  jobs.forEach(j=>{
    const grpKey=j.parallelGroup||j.fanOutGroup
    if(!grpKey) return
    let gs=0.4
    for(const dep of(j.depends_on||[])){
      const di=jmap[dep]; if(di!==undefined&&jEnd[di]!==undefined) gs=Math.max(gs,jEnd[di]+0.3)
    }
    if(gStart[grpKey]===undefined||gs>gStart[grpKey]) gStart[grpKey]=gs
  })

  jobs.forEach((job,ji)=>{
    const grpKey=job.parallelGroup||job.fanOutGroup
    let jstart = grpKey?(gStart[grpKey]??cursor):cursor
    for(const dep of(job.depends_on||[])){
      const di=jmap[dep]; if(di!==undefined&&jEnd[di]!==undefined) jstart=Math.max(jstart,jEnd[di]+0.3)
    }
    const sc=job.steps?.length||0
    const jdur=(job.duration||TIMING_TOKENS[job.timing]||(300+sc*480))/1000
    const failAt=job.failAtStep??-1

    const gateDelaySec=job.gate?(job.gateDelay||TIMING_TOKENS[job.gateTiming]||2000)/1000:0
    const runStart=jstart+gateDelaySec
    jEnd[ji]=jstart+gateDelaySec+jdur

    const depFailed=()=>(job.depends_on||[]).some(d=>{const di=jmap[d];return di!==undefined&&comp._js?.[jobs[di]?.name]!=='succeeded'})

    tl.call(()=>{
      if(!depFailed()){comp.setJobState(job.name,'pending');animJob(comp,job.name,'pending')}
    },[],jstart-.2)

    tl.call(()=>{
      if(!depFailed()) drawConn(`[data-conn-in="${job.name}"]`,'#f5a623',0.5)
    },[],jstart-.1)

    if(job.gate){
      const gateStepIdx=(job.steps||[]).findIndex(s=>s.type==='gate')

      tl.call(()=>{
        if(!depFailed()){
          comp.setJobState(job.name,'gate');animJob(comp,job.name,'gate')
          if(gateStepIdx>=0){comp.setStepState(job.name,gateStepIdx,'running');animStep(comp,job.name,gateStepIdx,'running')}
        }
      },[],jstart)

      if(failAt===gateStepIdx){
        tl.call(()=>{
          if(comp._js?.[job.name]==='gate'){
            if(gateStepIdx>=0){comp.setStepState(job.name,gateStepIdx,'failed');animStep(comp,job.name,gateStepIdx,'failed')}
            comp.setJobState(job.name,'failed');animJob(comp,job.name,'failed')
            gsap.to(document.querySelector(`[data-conn-out="${job.name}"]`),{stroke:'#ed4b35',duration:.3})
            if(job.parallelGroup){
              const _seen={}; let _ci=0
              for(const _j of jobs){const _g=_j.parallelGroup||_j.fanOutGroup||`_${jobs.indexOf(_j)}`;if(!(_g in _seen)){_seen[_g]=_ci++}
                if(_j.name===job.name){animRC(`merge-${_seen[_g]-1}`,'#ed4b35',true);break}
              }
            }
          }
        },[],jstart+gateDelaySec*0.5)
      } else {
        tl.call(()=>{
          if(comp._js?.[job.name]==='gate'){
            if(gateStepIdx>=0){comp.setStepState(job.name,gateStepIdx,'done');animStep(comp,job.name,gateStepIdx,'done')}
            comp.setJobState(job.name,'running');animJob(comp,job.name,'running')
          }
        },[],runStart)
      }
    } else {
      tl.call(()=>{
        if(!depFailed()){comp.setJobState(job.name,'running');animJob(comp,job.name,'running')}
      },[],jstart)
    }

    if(mode==='manual'&&ji>0) tl.addPause(jstart+.05)

    let sc2=runStart+.2
    const nonGateSteps=(job.steps||[]).map((s,i)=>({step:s,si:i})).filter(({step})=>!(job.gate&&step.type==='gate'))
    const sd=(jdur-.3)/Math.max(nonGateSteps.length,1)
    nonGateSteps.forEach(({step,si})=>{
      const isFailStep=si===failAt
      tl.call(()=>{
        if(comp._js?.[job.name]==='running'){comp.setStepState(job.name,si,'running');animStep(comp,job.name,si,'running')}
      },[],sc2)
      sc2+=sd*.65
      if(isFailStep){
        tl.call(()=>{
          comp.setStepState(job.name,si,'failed');animStep(comp,job.name,si,'failed')
          comp.setJobState(job.name,'failed');animJob(comp,job.name,'failed')
          gsap.to(document.querySelector(`[data-conn-out="${job.name}"]`),{stroke:'#ed4b35',duration:.3})
          if(job.parallelGroup){
            const seen={}; let ci2=0
            for(const j2 of jobs){
              const g2=j2.parallelGroup||j2.fanOutGroup||`_${jobs.indexOf(j2)}`
              if(!(g2 in seen)){seen[g2]=ci2++}
              if(j2.name===job.name){
                const idx=seen[g2]-1
                animRC(`merge-${idx}`,'#ed4b35',true)
                const mergeEl=document.querySelector(`[data-rc="merge-${idx}"]`)
                if(mergeEl){
                  const svg=mergeEl.closest('svg')
                  if(svg&&!svg.querySelector('[data-blocked]')){
                    const cx=parseFloat(mergeEl.getAttribute('cx'))
                    const cy=parseFloat(mergeEl.getAttribute('cy'))
                    const txt=document.createElementNS('http://www.w3.org/2000/svg','text')
                    txt.setAttribute('x',cx); txt.setAttribute('y',cy+15)
                    txt.setAttribute('text-anchor','middle'); txt.setAttribute('font-size','7')
                    txt.setAttribute('font-family','JetBrains Mono,monospace')
                    txt.setAttribute('fill','#ed4b35'); txt.setAttribute('data-blocked','1')
                    txt.textContent='blocked'
                    svg.appendChild(txt)
                    gsap.from(txt,{opacity:0,duration:.3})
                  }
                }
                const bridge=document.querySelector(`[data-conn-bridge="${idx}"]`)
                if(bridge) gsap.to(bridge,{stroke:'#3d3d3d',duration:.1})
                break
              }
            }
          }
        },[],sc2)
      } else if(failAt>=0&&si>failAt){
        // skip — already failed
      } else {
        tl.call(()=>{
          if(comp._js?.[job.name]==='running'){comp.setStepState(job.name,si,'done');animStep(comp,job.name,si,'done')}
        },[],sc2)
        sc2+=sd*.35
      }
    })

    if(failAt<0){
        tl.call(()=>{
          if(depFailed()) return
          comp.setJobState(job.name,'succeeded');animJob(comp,job.name,'succeeded')
          drawConn(`[data-conn-out="${job.name}"]`,'#11c560',0.5)
          if(job.parallelGroup && !job.fanOutGroup){
            const grp=jobs.filter(j=>j.parallelGroup===job.parallelGroup)
            const allOk=grp.every(g=>comp._js?.[g.name]==='succeeded')
            const anyFail=grp.some(g=>comp._js?.[g.name]==='failed')
            const allDone=grp.every(g=>['succeeded','failed'].includes(comp._js?.[g.name]))
            if(!allDone) return
            const seen={}; let ci=0
            for(const j of jobs){
              const g=j.parallelGroup||j.fanOutGroup||`_${jobs.indexOf(j)}`
              if(!(g in seen)){seen[g]=ci++}
              if(j.name===job.name){
                const idx=seen[g]-1
                if(allOk&&!anyFail){
                  animRC(`merge-${idx}`,'#11c560',true)
                  gsap.to(document.querySelector(`[data-conn-bridge="${idx}"]`),{stroke:'#11c560',duration:.4})
                }
                break
              }
            }
          }
        },[],jEnd[ji])
    }

    if(!job.parallelGroup && !job.fanOutGroup) cursor=jstart+.2
  })

  const totalEnd=Math.max(...Object.values(jEnd),cursor)+.4
  tl.call(()=>{
    const anyFail=Object.values(comp._js||{}).some(s=>s==='failed')
    animRC('trail',anyFail?'#ed4b35':'#38bdf8',!anyFail)
    if(onDone) onDone({success:!anyFail})
    if(mode==='auto') setTimeout(startAnimFn,replayDelay)
  },[],totalEnd)

  return tl
}

// ══════════════════════════════════════════════════════════════════
// BOOT — wires everything together for each demo page
// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// PUBLIC API — window.PV
// ══════════════════════════════════════════════════════════════════
window.PV = { RC_COLORS, TIMING_TOKENS, boot }

function boot(scenarios, defaultScenario) {
  const host = document.getElementById('pl-wrap')
  const comp = createPipelineComponent(host)

  let currentScenario = defaultScenario
  let currentMode = 'auto'
  let currentSpeed = 1.0
  let masterTl = null

  const evlog = document.getElementById('evlog')
  const statusEl = document.getElementById('status')
  const sDot = document.getElementById('s-dot')
  const sTxt = document.getElementById('s-txt')
  const advBtn = document.getElementById('adv-btn')

  function setStatus(state, text) {
    sTxt.textContent = text
    statusEl.className = 'status ' + (state==='succeeded'?'ok':state==='failed'?'fail':'')
    const c = {idle:'#3d3d3d',running:'#f5a623',succeeded:'#11c560',failed:'#ed4b35'}[state]||'#3d3d3d'
    gsap.to(sDot, {backgroundColor:c, duration:.3})
    sDot.style.animation = state==='running' ? 'pv-pulse .8s ease-in-out infinite' : ''
  }

  function logEv(detail) {
    const entry = document.createElement('div')
    const c = detail.to==='running'?'#f5a623':detail.to==='succeeded'?'#11c560':detail.to==='failed'?'#ed4b35':'#71717a'
    const what = detail.step!=null ? `${detail.job} step[${detail.step}]` : detail.job
    const t = new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})
    entry.innerHTML = `<span style="color:#71717a">${t}</span>  <span style="color:${c}">${detail.to}</span>  <span style="color:#a1a1aa">${what}</span>`
    if(evlog.children.length===1&&evlog.children[0].style?.color) evlog.innerHTML=''
    evlog.appendChild(entry)
    evlog.scrollTop = evlog.scrollHeight
  }

  function startAnim() {
    masterTl?.kill()
    comp.resetStates()
    setStatus('running','running\u2026')
    advBtn.classList.remove('show')
    const jobs = comp.getJobs()
    masterTl = buildTimeline(comp, jobs, currentMode, currentSpeed, 3500, ({success})=>{
      if(success){
        setStatus('succeeded','\u2713 pipeline succeeded')
      } else {
        const failed = Object.entries(comp._js||{}).filter(([,v])=>v==='failed').map(([k])=>k)
        setStatus('failed',`\u2717 ${failed.join(', ')} failed \u00B7 full feedback collected \u00B7 fix and re-run`)
      }
    }, startAnim)
    masterTl.timeScale(currentSpeed).play()
  }

  function loadScenario(key) {
    currentScenario = key
    comp.render(scenarios[key])
  }

  // Events from Tier 2
  host.addEventListener('pv:ready', () => startAnim())
  host.addEventListener('pv:state-change', e => {
    logEv(e.detail)
    if(e.detail.to==='running' && e.detail.step===null) setStatus('running','running\u2026')
  })

  // Manual advance
  advBtn.addEventListener('click', () => { masterTl?.resume(); advBtn.classList.remove('show') })

  // Speed slider
  const spdEl = document.getElementById('spd')
  const spdVal = document.getElementById('spd-val')
  spdEl.addEventListener('input', e => {
    currentSpeed = parseFloat(e.target.value)
    spdVal.textContent = `${currentSpeed.toFixed(1)}\u00D7`
    masterTl?.timeScale(currentSpeed)
    const pct = ((currentSpeed-.2)/(3-.2))*100
    e.target.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--surface-high) ${pct}%)`
    document.querySelectorAll('#spd-presets .pill').forEach(b => b.classList.remove('on'))
  })
  document.querySelectorAll('#spd-presets .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = parseFloat(btn.dataset.v)
      currentSpeed = v; spdEl.value = v; spdVal.textContent = `${v}\u00D7`
      const pct = ((v-.2)/(3-.2))*100
      spdEl.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--surface-high) ${pct}%)`
      masterTl?.timeScale(v)
      document.querySelectorAll('#spd-presets .pill').forEach(b => b.classList.remove('on'))
      btn.classList.add('on')
    })
  })

  // Mode
  document.querySelectorAll('#mode-grp .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.m
      document.querySelectorAll('#mode-grp .pill').forEach(b => b.classList.remove('on'))
      btn.classList.add('on')
      startAnim()
    })
  })

  // Manual mode: show advance button when paused
  setInterval(() => {
    if(currentMode==='manual' && masterTl && masterTl.paused() && !masterTl.isActive()){
      advBtn.classList.add('show')
    }
  }, 200)

  // Scenario tabs
  function activateScenarioTab(tab) {
    document.querySelectorAll('.sc-tabs .sc-tab').forEach(t => t.classList.remove('on'))
    tab.classList.add('on')
    loadScenario(tab.dataset.s)
  }
  document.querySelectorAll('.sc-tabs .sc-tab').forEach(tab => {
    tab.addEventListener('click', () => activateScenarioTab(tab))
  })

  // Replay
  document.getElementById('replay-btn').addEventListener('click', startAnim)

  // Bootstrap
  loadScenario(defaultScenario)
}
