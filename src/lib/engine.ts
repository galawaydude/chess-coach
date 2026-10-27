// Stockfish wrapper. Two ways to use it:
//
//  - `pool`: several single-threaded engines analysing different positions at
//    once. A game review is embarrassingly parallel (every position is
//    independent), so N workers give close to N× throughput, which beats one
//    multi-threaded engine whose lazy-SMP threads mostly duplicate work at
//    fixed depth.
//  - `interactive`: one engine for the coach/board. Multi-threaded when the page
//    is cross-origin isolated, single-threaded otherwise. A new request cancels
//    the previous one so the UI never waits on stale work.

import type { Score, Line, PosEval } from './types'
import { db, evalKey } from './db'

const BASE = import.meta.env.BASE_URL + 'engine/'
const SINGLE = BASE + 'stockfish-19-lite-single.js'
const MULTI = BASE + 'stockfish-19-lite.js'

export const cores = Math.max(1, navigator.hardwareConcurrency || 4)
const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
const lowMemory = ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3
export const threaded = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated

interface Job {
  fen: string
  depth: number
  multipv: number
  onInfo?: (e: PosEval) => void
  resolve: (e: PosEval) => void
  reject: (err: unknown) => void
}

class Engine {
  private w: Worker
  private ready: Promise<void>
  private job: Job | null = null
  private lines: Line[] = []
  private depth = 0
  private done: Promise<void> = Promise.resolve()
  private finish: () => void = () => {}
  private multipv = 1
  private seq = 0

  constructor(url: string, threads = 1, hashMb = 16) {
    this.w = new Worker(url)
    this.ready = new Promise((res) => {
      let stage = 0
      this.w.onmessage = (e) => {
        const line = String(e.data)
        if (stage === 0 && line === 'uciok') {
          stage = 1
          if (threads > 1) this.send(`setoption name Threads value ${threads}`)
          this.send(`setoption name Hash value ${hashMb}`)
          this.send('isready')
        } else if (stage === 1 && line === 'readyok') {
          stage = 2
          this.w.onmessage = (ev) => this.onLine(String(ev.data))
          res()
        }
      }
      this.send('uci')
    })
  }

  private send(cmd: string) {
    this.w.postMessage(cmd)
  }

  private onLine(line: string) {
    const job = this.job
    if (!job) return
    if (line.startsWith('info ') && line.includes(' pv ')) {
      if (/ (lower|upper)bound/.test(line)) return
      const d = +line.match(/ depth (\d+)/)![1]
      const k = +(line.match(/ multipv (\d+)/)?.[1] ?? 1)
      const sc = line.match(/ score (cp|mate) (-?\d+)/)
      if (!sc) return
      const white = job.fen.split(' ')[1] === 'w'
      const v = +sc[2] * (white ? 1 : -1)
      const score: Score = sc[1] === 'cp' ? { cp: v } : { mate: v }
      const pv = line.split(' pv ')[1].trim().split(' ')
      if (k === 1 && d > this.depth) this.depth = d
      this.lines[k - 1] = { score, pv }
      if (job.onInfo && k === Math.min(this.multipv, this.lines.length)) job.onInfo(this.result())
    } else if (line.startsWith('bestmove')) {
      const res = this.result()
      this.job = null
      this.finish()
      job.resolve(res)
    }
  }

  private result(): PosEval {
    return { fen: this.job!.fen, depth: this.depth, lines: this.lines.filter(Boolean).slice(0, this.multipv) }
  }

  async analyse(fen: string, depth: number, multipv: number, onInfo?: (e: PosEval) => void): Promise<PosEval> {
    await this.ready
    // Several callers can be waiting for the same search to stop; only the
    // newest one gets to run, the rest are cancelled.
    const my = ++this.seq
    while (this.job) {
      this.send('stop')
      await this.done
    }
    if (my !== this.seq) throw new Error('cancelled')
    return new Promise((resolve, reject) => {
      this.job = { fen, depth, multipv, onInfo, resolve, reject }
      this.lines = []
      this.depth = 0
      this.done = new Promise((r) => (this.finish = r))
      if (multipv !== this.multipv) {
        this.multipv = multipv
        this.send(`setoption name MultiPV value ${multipv}`)
      }
      this.send(`position fen ${fen}`)
      this.send(`go depth ${depth}`)
    })
  }

  /** Abandon whatever is running; its promise rejects. */
  cancel() {
    if (!this.job) return
    const j = this.job
    j.resolve = () => {}
    j.onInfo = undefined
    j.reject(new Error('cancelled'))
    this.send('stop')
  }

  terminate() {
    this.cancel()
    this.w.terminate()
  }
}

class Pool {
  private engines: Engine[] = []
  private idle: Engine[] = []
  private waiters: ((e: Engine) => void)[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  // Phones get fewer workers: each one holds its own copy of the engine in memory.
  readonly size = Math.min(mobile ? Math.min(4, lowMemory ? 2 : 4) : 8, Math.max(1, cores - 1))

  private acquire(): Promise<Engine> {
    clearTimeout(this.timer)
    const e = this.idle.pop()
    if (e) return Promise.resolve(e)
    if (this.engines.length < this.size) {
      const ne = new Engine(SINGLE)
      this.engines.push(ne)
      return Promise.resolve(ne)
    }
    return new Promise((r) => this.waiters.push(r))
  }

  private release(e: Engine) {
    const w = this.waiters.shift()
    if (w) return w(e)
    this.idle.push(e)
    // Free the workers' memory once nothing has been queued for a while.
    if (this.idle.length === this.engines.length) {
      this.timer = setTimeout(() => {
        for (const x of this.engines) x.terminate()
        this.engines = []
        this.idle = []
      }, 60_000)
    }
  }

  async analyse(fen: string, depth: number, multipv: number): Promise<PosEval> {
    const e = await this.acquire()
    try {
      return await e.analyse(fen, depth, multipv)
    } finally {
      this.release(e)
    }
  }
}

export const pool = new Pool()

let inter: Engine | null = null
function interactiveEngine() {
  inter ??= threaded ? new Engine(MULTI, Math.min(4, Math.max(1, cores >> 1)), 64) : new Engine(SINGLE, 1, 32)
  return inter
}

/** Analyse with the interactive engine. Cancels any previous interactive request. */
export function analyseLive(fen: string, depth: number, multipv = 1, onInfo?: (e: PosEval) => void) {
  const e = interactiveEngine()
  e.cancel()
  return e.analyse(fen, depth, multipv, onInfo)
}

/**
 * Pool analysis with a persistent position cache. Openings repeat across games
 * constantly, so most early positions are never analysed twice.
 */
export async function analyseCached(fen: string, depth: number, multipv: number): Promise<PosEval> {
  const key = evalKey(fen)
  const hit = await db.evals.get(key)
  if (hit && hit.depth >= depth && hit.lines.length >= 1) return { ...hit, fen }
  const res = await pool.analyse(fen, depth, multipv)
  await db.evals.put({ key, depth: res.depth, lines: res.lines })
  return res
}
