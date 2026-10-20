<script lang="ts">
  // Interactive board with a move tree. In puzzle mode you first have to find a
  // good move from one of your own mistakes; after that (or straight away in
  // free mode) you play the position out against Stockfish. Every move you make
  // is graded and explained, and you can jump back to any earlier move and try
  // something else, which grows a new branch.

  import { Chess } from 'chess.js'
  import type { DrawShape } from 'chessground/draw'
  import type { Key } from 'chessground/types'
  import Board from './Board.svelte'
  import EvalBar from './EvalBar.svelte'
  import { analyseLive } from '../lib/engine'
  import { winFor } from '../lib/accuracy'
  import { classify, CLS_INFO } from '../lib/analysis'
  import { explain, numbered, playUci, pvToSan } from '../lib/explain'
  import type { Cls, Color, PosEval, Puzzle } from '../lib/types'

  interface Props {
    startFen: string
    userColor: Color
    puzzle?: Puzzle
    onResolved?: (clean: boolean) => void
    onNext?: () => void
    nextLabel?: string
  }
  let { startFen, userColor, puzzle, onResolved, onNext, nextLabel = 'Next puzzle ▶' }: Props = $props()

  const DEPTH = 14

  interface Node {
    id: number
    parent: number | null
    fen: string
    uci?: string
    san?: string
    children: number[]
    eval?: PosEval
    grade?: { cls: Cls; text: string; ok: boolean }
    byEngine?: boolean
  }

  // svelte-ignore state_referenced_locally
  let nodes = $state<Node[]>([{ id: 0, parent: null, fen: startFen, children: [] }])
  let cur = $state(0)
  type Phase = 'solve' | 'checking' | 'wrong' | 'solved' | 'revealed' | 'play'
  // svelte-ignore state_referenced_locally
  let phase = $state<Phase>(puzzle ? 'solve' : 'play')
  let hint = $state(0)
  let tries = $state(0)
  let resolved = false
  let thinking = $state(false)

  const node = $derived(nodes[cur])
  const chess = $derived(new Chess(node.fen))
  const turn = $derived(chess.turn())
  const over = $derived(chess.isGameOver())
  /** How many moves from the puzzle position the current node is. */
  const depth = $derived.by(() => {
    let d = 0
    for (let n = node; n.parent !== null; n = nodes[n.parent]) d++
    return d
  })
  const nearStart = $derived(depth <= 2)
  const lastUserNode = $derived.by(() => {
    let n: Node | undefined = node
    while (n && (n.byEngine || !n.uci)) n = n.parent !== null ? nodes[n.parent] : undefined
    return n
  })

  // ---- engine, one request at a time ----

  let chain: Promise<unknown> = Promise.resolve()
  function evalOf(n: Node): Promise<PosEval> {
    if (n.eval) return Promise.resolve(n.eval)
    const c = new Chess(n.fen)
    if (c.isGameOver()) {
      const cp = c.isCheckmate() ? (c.turn() === 'w' ? -10000 : 10000) : 0
      n.eval = { fen: n.fen, depth: 0, lines: [{ score: { cp }, pv: [] }] }
      return Promise.resolve(n.eval)
    }
    const p = chain.then(async () => {
      if (!n.eval) n.eval = await analyseLive(n.fen, DEPTH, 1)
      return n.eval
    })
    chain = p.catch(() => {})
    return p
  }

  // Warm up the root so the first answer is graded instantly.
  // svelte-ignore state_referenced_locally
  evalOf(nodes[0])
  // Starting on the opponent's turn: let the engine make their move first.
  // svelte-ignore state_referenced_locally
  if (!puzzle && new Chess(startFen).turn() !== userColor) engineReply(nodes[0])

  function addChild(parent: Node, uci: string, byEngine = false): Node {
    const existing = parent.children.map((i) => nodes[i]).find((c) => c.uci === uci)
    if (existing) return existing
    const c = new Chess(parent.fen)
    const m = playUci(c, uci)
    const n: Node = { id: nodes.length, parent: parent.id, fen: c.fen(), uci: m.lan, san: m.san, children: [], byEngine }
    nodes.push(n)
    parent.children.push(n.id)
    return nodes[n.id]
  }

  async function grade(parent: Node, child: Node) {
    const [pe, ce] = await Promise.all([evalOf(parent), evalOf(child)])
    const best = puzzle && parent.id === 0 ? puzzle.bestUci : pe.lines[0]?.pv[0]
    const before = winFor(pe.lines[0].score, userColor)
    const after = winFor(ce.lines[0].score, userColor)
    const isBest = child.uci === best
    const drop = isBest ? 0 : Math.max(0, before - after)
    const cls: Cls = isBest ? 'best' : classify(drop)
    let text = ''
    if (drop >= 5) {
      text = explain({
        fenBefore: parent.fen,
        played: child.uci!,
        best: pe.lines[0].pv,
        bestScore: pe.lines[0].score,
        reply: ce.lines[0]?.pv ?? [],
        afterScore: ce.lines[0].score,
        winBefore: before,
        winAfter: after,
      }).text
    } else if (isBest) text = 'That’s the engine’s top move.'
    else if (drop < 2) text = `Excellent, nearly as strong as the best move${best ? ` (${pvToSan(parent.fen, [best])[0]})` : ''}.`
    else text = `Good enough. ${best ? pvToSan(parent.fen, [best])[0] : 'Another move'} was a little stronger.`
    child.grade = { cls, text, ok: drop < 5 }
    return child.grade
  }

  async function engineReply(n: Node) {
    if (new Chess(n.fen).isGameOver()) return
    thinking = true
    try {
      const e = await evalOf(n)
      const reply = e.lines[0]?.pv[0]
      if (!reply) return
      await new Promise((r) => setTimeout(r, 250))
      const child = addChild(n, reply, true)
      if (cur === n.id) cur = child.id
      evalOf(child)
    } catch {
      // cancelled; fine
    } finally {
      thinking = false
    }
  }

  async function onMove(uci: string) {
    const parent = node
    const child = addChild(parent, uci)
    cur = child.id

    if (phase === 'solve' && parent.id === 0) {
      phase = 'checking'
      tries++
      const g = await grade(parent, child)
      if (g.ok) {
        // The right answer becomes the main line; wrong tries stay as side branches.
        parent.children = [child.id, ...parent.children.filter((i) => i !== child.id)]
        phase = 'solved'
        resolve(tries === 1 && hint === 0)
        engineReply(child)
      } else {
        phase = 'wrong'
        // Show the punishment.
        engineReply(child)
      }
      return
    }
    if (phase === 'wrong' && parent.id === 0) {
      phase = 'solve'
      return onMove(uci)
    }
    thinking = true
    await grade(parent, child)
    thinking = false
    engineReply(child)
  }

  function resolve(clean: boolean) {
    if (resolved) return
    resolved = true
    onResolved?.(clean)
  }

  function retry() {
    cur = 0
    phase = 'solve'
  }

  function reveal() {
    if (!puzzle) return
    resolve(false)
    const child = addChild(nodes[0], puzzle.bestUci)
    nodes[0].children = [child.id, ...nodes[0].children.filter((i) => i !== child.id)]
    child.grade = { cls: 'best', text: puzzle.explanation ? 'This was the move.' : 'The engine’s top move.', ok: true }
    cur = child.id
    phase = 'revealed'
    engineReply(child)
  }

  function select(id: number) {
    cur = id
    if (phase === 'solve' || phase === 'wrong') {
      if (id === 0) phase = 'solve'
    }
    const n = nodes[id]
    const c = new Chess(n.fen)
    if (phase !== 'solve' && phase !== 'wrong' && c.turn() !== userColor && !n.children.length && n.uci) engineReply(n)
  }

  function back() {
    let n = node
    // Step back to the last position where it was your move.
    do {
      if (n.parent === null) break
      n = nodes[n.parent]
    } while (new Chess(n.fen).turn() !== userColor)
    // Started on the opponent's turn: land on their first move instead of the empty start.
    if (new Chess(n.fen).turn() !== userColor && n.children.length) n = nodes[n.children[0]]
    cur = n.id
    if (n.id === 0 && (phase === 'wrong' || phase === 'checking')) phase = 'solve'
  }

  // ---- board decorations ----

  const shapes = $derived.by(() => {
    const out: DrawShape[] = []
    if (puzzle && cur === 0 && (phase === 'solve' || phase === 'wrong') && hint > 0) {
      const b = puzzle.bestUci
      out.push(hint === 1 ? { orig: b.slice(0, 2) as Key, brush: 'green' } : { orig: b.slice(0, 2) as Key, dest: b.slice(2, 4) as Key, brush: 'green' })
    }
    const g = node.grade
    if (g && node.uci) {
      const info = CLS_INFO[g.cls]
      out.push({
        orig: node.uci.slice(2, 4) as Key,
        customSvg: {
          html: `<circle cx="82" cy="18" r="17" fill="${info.color}" stroke="#fff" stroke-width="3"/><text x="82" y="25" font-size="${info.glyph.length > 1 ? 18 : 22}" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Tahoma,sans-serif">${info.glyph}</text>`,
        },
      })
    }
    // After a wrong try, point at what the opponent will do about it.
    if (phase === 'wrong' && node.parent === 0 && node.eval?.lines[0]?.pv[0]) {
      const r = node.eval.lines[0].pv[0]
      out.push({ orig: r.slice(0, 2) as Key, dest: r.slice(2, 4) as Key, brush: 'red' })
    }
    return out
  })

  const canMove = $derived(
    !over && turn === userColor && phase !== 'checking' && !(phase === 'wrong' && cur !== 0) && !(phase === 'solve' && cur !== 0),
  )

  // ---- move tree as inline tokens: 12. Nf3 Nc6 (12... d5 13. exd5) 13. Bb5 ----

  type Tok = { t: 'm'; id: number; label: string } | { t: '(' } | { t: ')' }
  function label(n: Node, forceNum: boolean) {
    const p = nodes[n.parent!]
    const [, side, , , , full] = p.fen.split(' ')
    if (side === 'w') return `${full}. ${n.san}`
    return forceNum ? `${full}... ${n.san}` : n.san!
  }
  function line(from: number, first: boolean): Tok[] {
    const out: Tok[] = []
    let p = from
    let num = first
    while (nodes[p].children.length) {
      const [main, ...vars] = nodes[p].children
      out.push({ t: 'm', id: main, label: label(nodes[main], num) })
      num = false
      for (const v of vars) {
        out.push({ t: '(' }, { t: 'm', id: v, label: label(nodes[v], true) }, ...line(v, false), { t: ')' })
        num = true
      }
      p = main
    }
    return out
  }
  const toks = $derived(line(0, true))

  const orientation = $derived(userColor === 'w' ? 'white' : 'black')
  const feedback = $derived(lastUserNode?.grade)
  const status = $derived.by(() => {
    if (over) {
      if (chess.isCheckmate()) return turn === userColor ? 'Checkmate. You lost this line.' : 'Checkmate! You won this line.'
      return 'Draw.'
    }
    if (thinking || phase === 'checking') return 'Thinking…'
    if (turn === userColor) return 'Your move.'
    return node.children.length ? 'Step forward or pick another move in the tree.' : 'Opponent to move…'
  })
</script>

<div class="layout">
  <section class="win">
    <div class="title">
      <span>{puzzle && (phase === 'solve' || phase === 'wrong' || phase === 'checking') ? 'Find a better move' : 'Practice board'}</span>
      <span class="spacer"></span>
      <span style="font-weight:normal">You play {userColor === 'w' ? 'White' : 'Black'}</span>
    </div>
    <div class="body">
      <div class="board-row">
        <EvalBar score={phase === 'solve' || phase === 'wrong' ? undefined : node.eval?.lines[0]?.score} flipped={userColor === 'b'} />
        <div class="grow">
          <Board fen={node.fen} {orientation} lastMove={node.uci} {shapes} movable={canMove ? orientation : undefined} {onMove} />
        </div>
      </div>
      <div class="row controls">
        <button class="btn" onclick={back} disabled={cur === 0}>◀ Take back</button>
        <button class="btn" onclick={() => node.parent !== null && select(node.parent)} disabled={cur === 0}>◀</button>
        <button class="btn" onclick={() => node.children.length && select(node.children[0])} disabled={!node.children.length}>▶</button>
        <span class="grow"></span>
        <span class="muted">{status}</span>
      </div>
    </div>
  </section>

  <div class="side stack">
    <section class="win">
      <div class="title">Coach</div>
      <div class="body stack coach">
        {#if puzzle && (phase === 'solve' || (phase === 'checking' && !feedback))}
          <p class="big">
            {puzzle.cls === 'miss' ? 'You had a big chance here and missed it.' : 'You went wrong in this position.'}
            What's the best move for {userColor === 'w' ? 'White' : 'Black'}?
          </p>
          {#if tries > 0}<p class="muted">Try {tries + 1}. Take your time: check every capture and every check first.</p>{/if}
          <div class="row">
            <button class="btn" onclick={() => (hint = Math.min(2, hint + 1))} disabled={hint >= 2}>
              💡 {hint === 0 ? 'Hint' : 'Bigger hint'}
            </button>
            <button class="btn" onclick={reveal}>Show answer</button>
          </div>
          {#if hint === 1}<p class="muted">The green circle marks the piece to move.</p>{/if}
          {#if hint === 2}<p class="muted">The arrow shows the move.</p>{/if}
        {:else if phase === 'wrong' && feedback}
          <p class="big bad">✗ Not quite.</p>
          <p>{feedback.text}</p>
          <div class="row">
            <button class="btn primary" onclick={retry}>↺ Try again</button>
            <button class="btn" onclick={() => { retry(); hint = Math.min(2, hint + 1) }}>💡 Hint</button>
            <button class="btn" onclick={reveal}>Show answer</button>
          </div>
        {:else}
          {#if phase === 'solved' && nearStart}
            <p class="big good">✓ {tries === 1 && hint === 0 ? 'Correct!' : 'Got it.'}</p>
          {:else if phase === 'revealed' && nearStart}
            <p class="big">The answer was <b>{puzzle?.bestSan}</b>.</p>
          {/if}
          {#if puzzle && nearStart && (phase === 'solved' || phase === 'revealed')}
            <p class="muted">
              In the game you played <b>{puzzle.playedSan}</b>{puzzle.explanation ? `: ${puzzle.explanation}` : '.'}
            </p>
          {/if}
          {#if feedback && !(puzzle && nearStart)}
            <p>
              <span class="glyph" style:background={CLS_INFO[feedback.cls].color}>{CLS_INFO[feedback.cls].glyph}</span>
              <b>{lastUserNode?.san}</b>: {feedback.text}
            </p>
          {:else if !feedback && !puzzle}
            <p>Play a move. The engine answers as your opponent and grades every move you make.</p>
          {/if}
          {#if puzzle}
            <p class="muted">Keep playing the line to see how the game should continue, or go back and try other moves.</p>
          {/if}
          {#if onNext}
            <div class="row"><button class="btn primary" onclick={onNext}>{nextLabel}</button></div>
          {/if}
        {/if}
      </div>
    </section>

    <section class="win">
      <div class="title">Your lines</div>
      <div class="tree sunken">
        {#if !toks.length}<span class="muted">Moves you try will show up here, with branches for each new idea.</span>{/if}
        {#each toks as t, i (i)}
          {#if t.t === 'm'}
            {@const n = nodes[t.id]}
            <button class="tm" class:sel={cur === t.id} class:eng={n.byEngine} onclick={() => select(t.id)}>
              {t.label}{#if n.grade && !['best', 'excellent', 'good'].includes(n.grade.cls)}<span style:color={CLS_INFO[n.grade.cls].color}>{CLS_INFO[n.grade.cls].glyph}</span>{/if}
            </button>
          {:else if t.t === '('}
            <span class="paren">(</span>
          {:else}
            <span class="paren">)</span>
          {/if}
        {/each}
      </div>
      {#if node.eval?.lines[0] && phase !== 'solve' && phase !== 'wrong' && !over}
        <div class="pv muted">Engine: {numbered(node.fen, pvToSan(node.fen, node.eval.lines[0].pv, 6))}</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .board-row {
    display: flex;
    gap: 6px;
  }
  .controls {
    margin-top: 8px;
  }
  .coach p {
    margin: 0;
    font-size: 14px;
  }
  .coach .big {
    font-size: 16px;
    font-weight: bold;
  }
  .good {
    color: var(--good);
  }
  .bad {
    color: var(--bad);
  }
  .tree {
    margin: 0 3px 3px;
    padding: 6px;
    min-height: 80px;
    max-height: 260px;
    overflow: auto;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.9;
  }
  .tm {
    border: 0;
    background: none;
    font: inherit;
    padding: 1px 3px;
    cursor: pointer;
    font-weight: bold;
  }
  .tm.eng {
    font-weight: normal;
  }
  .tm:hover {
    background: #dde4f2;
  }
  .tm.sel {
    background: var(--sel);
    color: #fff;
  }
  .paren {
    color: var(--muted);
  }
  .pv {
    padding: 4px 8px 6px;
    font-family: var(--mono);
    font-size: 12px;
  }
</style>
