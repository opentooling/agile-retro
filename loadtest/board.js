/**
 * k6 load test: people in retros, over the real socket.
 *
 * Each virtual user is one person: they load the board page, open the live
 * connection, join the board, and add a card every 20–40 seconds for a
 * 90-second session, then reconnect (a refresh, a new tab). Two scenarios:
 *
 *   SCENARIO=teams     200 people across 20 boards — many teams at once
 *   SCENARIO=allhands  200 people on one board   — the worst case for fan-out
 *
 * The headline number is card_broadcast_ms: from sending a card to seeing it
 * come back in the board update — what everyone in the room waits for.
 *
 * Socket.IO is spoken by hand over k6's WebSocket (Engine.IO v4 framing): the
 * server opens with "0{...}", we connect the namespace with "40", events are
 * '42["name", payload]', and pings ("2") are answered with pongs ("3").
 */
import http from 'k6/http'
import ws from 'k6/ws'
import { check } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const data = JSON.parse(open('./data.json'))
const BASE = __ENV.BASE_URL || 'http://agile-retro:3000'
const SCENARIO = __ENV.SCENARIO || 'teams'
const HOLD = __ENV.HOLD || '3m'
const PEAK = Number(__ENV.PEAK || 200)
const SESSION_MS = 90_000

const cardRtt = new Trend('card_broadcast_ms', true)
const joinState = new Trend('join_to_state_ms', true)
const sessionOk = new Rate('ws_session_ok')
const cardsSent = new Counter('cards_sent')
const cardsSeen = new Counter('cards_seen')
const bytesIn = new Counter('ws_bytes_in')
const updatesIn = new Counter('board_updates_received')

export const options = {
  scenarios: {
    retro: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: PEAK },
        { duration: HOLD, target: PEAK },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    'http_req_duration{name:board page}': ['p(95)<2000'],
    card_broadcast_ms: ['p(95)<1000'],
    ws_session_ok: ['rate>0.99'],
    checks: ['rate>0.99'],
  },
}

function boardFor(vu) {
  return SCENARIO === 'allhands' ? data.allhands : data.teams[(vu - 1) % data.teams.length]
}

export default function retroSession() {
  const token = data.tokens[(__VU - 1) % data.tokens.length]
  const board = boardFor(__VU)
  const cookie = `authjs.session-token=${token}`

  const page = http.get(`${BASE}/retro/${board.id}`, {
    headers: { Cookie: cookie },
    redirects: 0,
    tags: { name: 'board page' },
  })
  check(page, { 'board page is 200': (r) => r.status === 200 })

  const url = `${BASE.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`
  let joined = false
  let joinedAt = 0
  let gotState = false
  const pending = {}
  let n = 0

  const res = ws.connect(url, { headers: { Cookie: cookie } }, (socket) => {
    socket.on('message', (msg) => {
      bytesIn.add(msg.length)
      if (msg === '2') return socket.send('3') // Engine.IO ping
      if (msg.startsWith('0')) return socket.send('40') // open → connect namespace
      if (msg.startsWith('40')) {
        joined = true
        joinedAt = Date.now()
        socket.send(`42${JSON.stringify(['join-retro', { retroId: board.id }])}`)
        return
      }
      if (msg.startsWith('42["retro-updated"')) {
        updatesIn.add(1)
        if (!gotState) {
          gotState = true
          joinState.add(Date.now() - joinedAt)
        }
        for (const content in pending) {
          if (msg.indexOf(content) !== -1) {
            cardRtt.add(Date.now() - pending[content])
            cardsSeen.add(1)
            delete pending[content]
          }
        }
      }
    })

    const addCard = () => {
      if (!joined) return
      const content = `lt ${__VU}-${__ITER}-${n++}-${Date.now()}`
      pending[content] = Date.now()
      cardsSent.add(1)
      const column = board.columns[n % board.columns.length]
      socket.send(`42${JSON.stringify(['add-item', { retroId: board.id, columnId: column, content }])}`)
    }
    // First card soon after joining, then every 20–40 s.
    socket.setTimeout(addCard, 3000 + Math.random() * 5000)
    const schedule = () => socket.setTimeout(() => { addCard(); schedule() }, 20_000 + Math.random() * 20_000)
    schedule()
    socket.setTimeout(() => socket.close(), SESSION_MS)
  })

  sessionOk.add(res && res.status === 101 && joined)
}

/** One line of JSON with the numbers that matter, for the run log. */
export function handleSummary(summary) {
  const m = summary.metrics
  const pick = (name, stats = ['avg', 'med', 'p(90)', 'p(95)', 'max']) =>
    m[name] ? Object.fromEntries(stats.filter((s) => m[name].values[s] !== undefined).map((s) => [s, Math.round(m[name].values[s])])) : null
  const out = {
    scenario: SCENARIO,
    peakVUs: PEAK,
    page_ms: pick('http_req_duration{name:board page}'),
    card_broadcast_ms: pick('card_broadcast_ms'),
    join_to_state_ms: pick('join_to_state_ms'),
    cards_sent: m.cards_sent ? m.cards_sent.values.count : 0,
    cards_seen: m.cards_seen ? m.cards_seen.values.count : 0,
    board_updates_received: m.board_updates_received ? m.board_updates_received.values.count : 0,
    ws_mb_in: m.ws_bytes_in ? Math.round(m.ws_bytes_in.values.count / 1e6) : 0,
    ws_session_ok: m.ws_session_ok ? m.ws_session_ok.values.rate : null,
    checks_ok: m.checks ? m.checks.values.rate : null,
    thresholds: Object.fromEntries(Object.entries(m).filter(([, v]) => v.thresholds).map(([k, v]) => [k, Object.values(v.thresholds).every((t) => t.ok)])),
  }
  return { stdout: `\nK6_SUMMARY ${JSON.stringify(out)}\n` }
}
