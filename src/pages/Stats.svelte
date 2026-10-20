<script lang="ts">
  import LineChart from '../components/LineChart.svelte'
  import { db } from '../lib/db'
  import { live } from '../lib/live.svelte'
  import { settings, go } from '../lib/state.svelte'
  import { MASTERED_BOX } from '../lib/srs'
  import type { Game, Phase, Puzzle, Tag } from '../lib/types'

  const data = live(
    () => settings.username.toLowerCase(),
    async (u) => ({
      games: await db.games.where('[user+endTime]').between([u, 0], [u, Infinity]).toArray(),
      puzzles: await db.puzzles.where('user').equals(u).toArray(),
    }),
    { games: [] as Game[], puzzles: [] as Puzzle[] },
  )

  const games = $derived(data.value.games)
  const analysed = $derived(games.filter((g) => g.analysis))
  const myAcc = (g: Game) => g.analysis!.accuracy[g.userColor]

  // ---- headline numbers ----
  const recent = $derived(analysed.slice(-20))
  const avgAcc = $derived(recent.length ? recent.reduce((s, g) => s + myAcc(g), 0) / recent.length : 0)
  const myMoves = $derived(analysed.flatMap((g) => g.analysis!.moves.filter((m) => m.color === g.userColor)))
  const blundersPerGame = $derived(analysed.length ? myMoves.filter((m) => m.cls === 'blunder').length / analysed.length : 0)
  const record = $derived({
    w: games.filter((g) => g.result === 'win').length,
    d: games.filter((g) => g.result === 'draw').length,
    l: games.filter((g) => g.result === 'loss').length,
  })

  // ---- trends ----
  const accPoints = $derived(
    analysed.map((g) => ({
      x: g.endTime,
      y: myAcc(g),
      label: `${new Date(g.endTime).toLocaleDateString()} vs ${(g.userColor === 'w' ? g.black : g.white).username}`,
    })),
  )
  const classes = $derived(
    [...new Set(games.map((g) => g.timeClass))].sort(
      (a, b) => games.filter((g) => g.timeClass === b).length - games.filter((g) => g.timeClass === a).length,
    ),
  )
  let tc = $state('')
  const activeTc = $derived(tc || classes[0] || '')
  const ratingPoints = $derived(
    games
      .filter((g) => g.timeClass === activeTc && g.rated)
      .map((g) => ({
        x: g.endTime,
        y: (g.userColor === 'w' ? g.white : g.black).rating,
        label: new Date(g.endTime).toLocaleDateString(),
      })),
  )

  // ---- where the mistakes happen ----
  const BADS = ['mistake', 'blunder', 'miss']
  const phases: Phase[] = ['opening', 'middlegame', 'endgame']
  const byPhase = $derived(
    phases.map((p) => {
      const ms = myMoves.filter((m) => m.phase === p)
      const bad = ms.filter((m) => BADS.includes(m.cls)).length
      return {
        p,
        bad,
        perGame: analysed.length ? bad / analysed.length : 0,
        acc: ms.length ? ms.reduce((s, m) => s + m.accuracy, 0) / ms.length : 0,
      }
    }),
  )
  const maxPhase = $derived(Math.max(0.01, ...byPhase.map((b) => b.perGame)))

  const TAGS: Record<Tag, { label: string; tip: string }> = {
    'hung-piece': { label: 'Left a piece hanging', tip: 'Before every move ask: after this, what can my opponent capture?' },
    'missed-capture': { label: 'Missed a free piece', tip: 'Every turn, look at what your opponent just left undefended.' },
    'allowed-mate': { label: 'Walked into checkmate', tip: 'Check your king’s safety: which checks can they give next move?' },
    'missed-mate': { label: 'Missed a checkmate', tip: 'Look at every check you have, every move. Checks first, then captures.' },
    'allowed-fork': { label: 'Walked into a fork', tip: 'Watch out for knights and queens that can attack two of your pieces.' },
    'missed-fork': { label: 'Missed a fork', tip: 'Look for squares where one piece attacks two enemy pieces.' },
    'allowed-tactic': { label: 'Allowed a tactic', tip: 'Before you move, list every check, capture and threat your opponent will have.' },
    'missed-tactic': { label: 'Missed a tactic', tip: 'Every move, scan for checks, captures and threats you can make. In that order.' },
    'ignored-threat': { label: 'Ignored a threat', tip: 'After every opponent move, ask: what is that move attacking?' },
    'allowed-pin': { label: 'Got pinned or skewered', tip: 'Avoid lining up your king or queen with other pieces on lines the enemy bishops, rooks and queen can reach.' },
    'missed-pin': { label: 'Missed a pin or skewer', tip: 'Look for enemy pieces lined up with their king or queen. Your bishops and rooks love that.' },
    'king-safety': { label: 'King safety', tip: 'Castle early, and don\u2019t push the pawns in front of your castled king.' },
    'opening-principle': { label: 'Opening principles', tip: 'In the first 10 moves: knights and bishops out, control the centre, castle. Don\u2019t move the queen or the same piece twice.' },
    'endgame-technique': { label: 'Endgame technique', tip: 'In endgames: activate your king, push passed pawns, and stop your opponent\u2019s.' },
    'bad-trade': { label: 'Bad trade', tip: 'Count: what you take vs what you lose. A queen is worth 9 pawns.' },
    positional: { label: 'Weaker plan / slow move', tip: 'Develop pieces, castle early, and control the centre.' },
  }
  const byTag = $derived.by(() => {
    const c = new Map<Tag, number>()
    for (const m of myMoves) if (m.tag && BADS.includes(m.cls)) c.set(m.tag, (c.get(m.tag) ?? 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1])
  })
  const maxTag = $derived(Math.max(1, ...byTag.map((t) => t[1])))

  // ---- openings ----
  const openings = $derived.by(() => {
    const m = new Map<string, { name: string; color: string; n: number; w: number; d: number; l: number; acc: number[] }>()
    for (const g of games) {
      const full = g.opening?.name ?? g.analysis?.opening?.name ?? g.ecoName
      if (!full) continue
      const name = full.split(':')[0].trim()
      const k = name + g.userColor
      const e = m.get(k) ?? { name, color: g.userColor === 'w' ? 'White' : 'Black', n: 0, w: 0, d: 0, l: 0, acc: [] }
      e.n++
      e[g.result === 'win' ? 'w' : g.result === 'draw' ? 'd' : 'l']++
      if (g.analysis) e.acc.push(myAcc(g))
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 15)
  })

  const puzzles = $derived(data.value.puzzles)
  const mastered = $derived(puzzles.filter((p) => p.box >= MASTERED_BOX).length)
</script>

<div class="stack">
  {#if !settings.username}
    <section class="win"><div class="title">Patterns</div><div class="body">Load your games first. <a href="#/games">Go to games</a></div></section>
  {:else}
    <div class="tiles">
      {#snippet tile(label: string, value: string, sub: string)}
        <div class="win tile">
          <div class="title">{label}</div>
          <div class="body"><div class="big">{value}</div><div class="muted">{sub}</div></div>
        </div>
      {/snippet}
      {@render tile('Accuracy', analysed.length ? avgAcc.toFixed(1) + '%' : '–', `avg of last ${recent.length} analysed`)}
      {@render tile('Blunders', analysed.length ? blundersPerGame.toFixed(1) : '–', 'per game')}
      {@render tile('Record', `${record.w}-${record.d}-${record.l}`, `${games.length} games (W-D-L)`)}
      {@render tile('Puzzles', `${mastered}/${puzzles.length}`, 'mastered')}
    </div>

    {#if !analysed.length}
      <section class="win">
        <div class="title">Not enough data</div>
        <div class="body">
          Analyse a few games and your patterns will show up here.
          <button class="btn" onclick={() => go('/games')}>Go to games</button>
        </div>
      </section>
    {/if}

    <div class="grid">
      {#if accPoints.length > 1}
        <section class="win">
          <div class="title">Your accuracy, game by game</div>
          <div class="body"><LineChart points={accPoints} yMin={0} yMax={100} /></div>
        </section>
      {/if}

      {#if ratingPoints.length > 1}
        <section class="win">
          <div class="title">
            Rating
            <span class="spacer"></span>
            <select value={activeTc} onchange={(e) => (tc = e.currentTarget.value)} aria-label="Time control" class="tc">
              {#each classes as c (c)}<option value={c}>{c}</option>{/each}
            </select>
          </div>
          <div class="body"><LineChart points={ratingPoints} /></div>
        </section>
      {/if}

      {#if analysed.length}
        <section class="win">
          <div class="title">Where you lose points</div>
          <div class="body stack">
            {#each byPhase as b (b.p)}
              <div class="bar-row">
                <span class="bl cap">{b.p}</span>
                <div class="track sunken"><div class="fill" style:width="{(b.perGame / maxPhase) * 100}%"></div></div>
                <span class="num bv">{b.perGame.toFixed(1)}/game</span>
              </div>
            {/each}
            <p class="muted small">Mistakes, blunders and misses per game in each phase.
              {#if byPhase.length}
                {@const worst = [...byPhase].sort((a, b) => b.perGame - a.perGame)[0]}
                {#if worst.bad}Your weakest phase is the <b>{worst.p}</b>.{/if}
              {/if}
            </p>
          </div>
        </section>

        <section class="win">
          <div class="title">Your most common mistakes</div>
          <div class="body stack">
            {#each byTag as [t, n] (t)}
              <div>
                <div class="bar-row">
                  <span class="bl">{TAGS[t].label}</span>
                  <div class="track sunken"><div class="fill" style:width="{(n / maxTag) * 100}%"></div></div>
                  <span class="num bv">{n}</span>
                </div>
              </div>
            {/each}
            {#if byTag.length}
              <div class="advice sunken">
                <b>Coach's tip:</b> {TAGS[byTag[0][0]].tip}
              </div>
            {/if}
          </div>
        </section>
      {/if}
    </div>

    {#if openings.length}
      <section class="win">
        <div class="title">Your openings</div>
        <div class="body">
          <div class="sunken" style="padding:2px; overflow:auto">
            <table class="list">
              <thead>
                <tr><th>Opening</th><th>As</th><th class="num">Games</th><th class="num">Win %</th><th class="num">W / D / L</th><th class="num">Avg accuracy</th></tr>
              </thead>
              <tbody>
                {#each openings as o (o.name + o.color)}
                  <tr>
                    <td>{o.name}</td>
                    <td>{o.color}</td>
                    <td class="num">{o.n}</td>
                    <td class="num" class:win-txt={o.w / o.n >= 0.6} class:loss-txt={o.w / o.n < 0.35}>{Math.round((o.w / o.n) * 100)}%</td>
                    <td class="num">{o.w} / {o.d} / {o.l}</td>
                    <td class="num">{o.acc.length ? (o.acc.reduce((a, b) => a + b, 0) / o.acc.length).toFixed(1) : '–'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .tile .big {
    font-size: 28px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 12px;
    align-items: start;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 160px 1fr 70px;
    gap: 8px;
    align-items: center;
  }
  .cap {
    text-transform: capitalize;
  }
  .track {
    height: 18px;
    padding: 3px;
  }
  .fill {
    height: 100%;
    background: #0a246a;
    border-radius: 0 4px 4px 0;
  }
  .small {
    font-size: 12px;
    margin: 0;
  }
  .advice {
    padding: 8px 10px;
    background: #ffffe1;
  }
  .tc {
    min-height: 0;
    padding: 0 4px;
    font-size: 12px;
    color: #000;
  }
  @media (max-width: 480px) {
    .bar-row {
      grid-template-columns: 110px 1fr 60px;
    }
  }
</style>
