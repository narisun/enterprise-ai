/**
 * HelpGuide.jsx — User guide for the Quantitix platform.
 *
 * Rendered as a full-page in the HELP phase. Covers:
 *   • Platform overview
 *   • Working with agents
 *   • Understanding data sources
 *   • Running a session
 *   • Reading results
 *   • Tips & keyboard shortcuts
 *
 * Props:
 *   onBack  {function} — return to the previous phase
 */

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ id, icon, title, children }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">{icon}</span>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      </div>
      <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

// ── Callout box ────────────────────────────────────────────────────────────────
function Callout({ type = 'info', children }) {
  const styles = {
    info:    'bg-blue-50   border-blue-200   text-blue-900',
    tip:     'bg-emerald-50 border-emerald-200 text-emerald-900',
    warning: 'bg-amber-50  border-amber-200  text-amber-900',
  }
  const icons = { info: 'ℹ️', tip: '💡', warning: '⚠️' }
  return (
    <div className={`flex gap-3 border rounded-lg px-4 py-3 ${styles[type]}`}>
      <span className="text-base shrink-0 mt-0.5">{icons[type]}</span>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  )
}

// ── Step row ───────────────────────────────────────────────────────────────────
function Step({ n, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <p className="font-semibold text-slate-800 mb-0.5">{title}</p>
        <p className="text-sm text-slate-600 leading-relaxed">{children}</p>
      </div>
    </div>
  )
}

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
function Kbd({ keys, label }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-xs font-mono text-slate-700"
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  )
}

// ── Table of contents ─────────────────────────────────────────────────────────
const TOC = [
  { id: 'overview',      icon: '🧭', label: 'Platform Overview'      },
  { id: 'agents',        icon: '🤖', label: 'Working with Agents'     },
  { id: 'datasources',   icon: '🗄️', label: 'Data Sources & Schemas'  },
  { id: 'session',       icon: '▶️', label: 'Running a Session'        },
  { id: 'results',       icon: '📋', label: 'Reading Results'          },
  { id: 'personas',      icon: '🧪', label: 'Test Personas (Dev)'      },
  { id: 'shortcuts',     icon: '⌨️', label: 'Tips & Shortcuts'         },
]

// ── Main component ─────────────────────────────────────────────────────────────
export default function HelpGuide({ onBack }) {
  return (
    <div className="flex h-full overflow-hidden bg-white">

      {/* ── Left nav (table of contents) ───────────────────────────────── */}
      <nav className="w-52 shrink-0 border-r border-slate-200 overflow-y-auto py-6 px-4 hidden md:block">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-2">
          Contents
        </p>
        <ul className="space-y-0.5">
          {TOC.map(({ id, icon, label }) => (
            <li key={id}>
              <button
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors text-left"
              >
                <span className="text-base">{icon}</span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-8 py-4 flex items-center gap-4 z-10">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors group"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h1 className="text-base font-bold text-slate-900">Quantitix User Guide</h1>
            <p className="text-xs text-slate-500">Agentic AI for regulated financial services</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-8 max-w-3xl space-y-12">

          {/* ── 1. Overview ─────────────────────────────────────────────── */}
          <Section id="overview" icon="🧭" title="Platform Overview">
            <p>
              Quantitix is a multi-agent AI platform purpose-built for regulated financial services.
              It gives relationship managers, compliance teams, and treasury professionals access to
              specialist AI workers — each with defined data access, role-based authorization, and
              an auditable reasoning trail.
            </p>
            <p>
              Unlike general-purpose chat tools, every agent in Quantitix has a fixed scope: it
              knows which systems to query, which OPA policies govern its data access, and how to
              structure its output for its specific workflow. Agents never access data directly —
              they delegate to MCP tool servers that enforce row-level and column-level controls
              before any data reaches the model.
            </p>

            <div className="border border-slate-200 rounded-xl overflow-hidden mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Layer</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">What it does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ['This UI',          'Agent selection, prompt configuration, output review'],
                    ['Agent API',        'Receives requests, manages sessions, enforces auth'],
                    ['Orchestrator',     'LangGraph workflow — plans steps, delegates to specialists'],
                    ['MCP Tool Servers', 'Thin data adapters — OPA-gated, never bypassed'],
                    ['Data backends',    'PostgreSQL, Salesforce, web search APIs'],
                  ].map(([layer, desc]) => (
                    <tr key={layer}>
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-700 font-semibold whitespace-nowrap">{layer}</td>
                      <td className="px-4 py-2.5 text-slate-600">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── 2. Agents ───────────────────────────────────────────────── */}
          <Section id="agents" icon="🤖" title="Working with Agents">
            <p>
              The main screen shows your <strong className="text-slate-800">Intelligence Team</strong> — AI workers
              grouped by department. Each card shows the agent's functional name, role, a short description,
              and the data sources it can access.
            </p>

            <div className="space-y-3 mt-1">
              <Step n={1} title="Pick an agent">
                Browse the team directory and click <strong className="text-slate-800">Work with [Agent Name]</strong> on
                any active (green) card to open the configuration screen for that agent.
              </Step>
              <Step n={2} title="Fill in the prompt template">
                Each agent presents a structured form tailored to its workflow — for example, the RM Prep
                Agent asks for a client account name and meeting context. Fill in the fields and click
                <strong className="text-slate-800"> Run</strong>.
              </Step>
              <Step n={3} title="Review the output">
                The output canvas shows the agent's work in real time: thinking steps, tool calls,
                and the final structured result. You can ask follow-up questions in the same session.
              </Step>
            </div>

            <Callout type="info">
              Agents marked <strong>In Development</strong> are not yet active. Their cards are greyed out
              and non-interactive. Watch this space — they are added as their MCP tool servers are deployed.
            </Callout>

            <p className="mt-2">
              The breadcrumb at the top always shows your current position. Click
              <strong className="text-slate-800"> Quantitix</strong> at any point to return to the team directory,
              or click the agent name to go back to the configuration screen.
            </p>
          </Section>

          {/* ── 3. Data Sources ─────────────────────────────────────────── */}
          <Section id="datasources" icon="🗄️" title="Data Sources & Schemas">
            <p>
              Every agent card shows coloured chips for the data sources it uses. These chips are
              clickable — click any chip on an agent card or in the left sidebar to open the
              <strong className="text-slate-800"> Data Source detail page</strong>, which shows:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>MCP server name, port, and transport protocol</li>
              <li>Full database schema: tables, columns, types, and field descriptions</li>
              <li>OPA masking rules — columns requiring elevated <code className="font-mono text-xs bg-slate-100 px-1 rounded">compliance_clearance</code> are flagged</li>
              <li>Which agents use this source</li>
              <li>Connection details for local development</li>
            </ul>

            <Callout type="warning">
              Columns marked <strong>OPA</strong> in red are redacted at runtime for standard-clearance
              users. The data never leaves the MCP server unmasked — OPA policy is enforced at the tool
              layer before results reach the agent.
            </Callout>

            <p>
              Data sources with status <strong className="text-emerald-700">Live</strong> are connected
              and queryable. Sources marked <strong className="text-amber-600">Coming Soon</strong> have
              MCP servers in development — their schema details will be published when activated.
            </p>
          </Section>

          {/* ── 4. Running a Session ────────────────────────────────────── */}
          <Section id="session" icon="▶️" title="Running a Session">
            <p>
              A <strong className="text-slate-800">session</strong> is a conversation thread tied to a
              specific agent. Session IDs persist in your browser so that multi-turn follow-ups stay in
              context across page refreshes (during development).
            </p>

            <div className="space-y-3">
              <Step n={1} title="Your RM name">
                Your name is shown at the bottom of the sidebar. Click it to edit — this is passed to
                the agent as the requesting RM identity and is included in the
                <code className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">AgentContext</code>
                for every tool call.
              </Step>
              <Step n={2} title="Submit a prompt">
                Complete the agent's form and click <strong className="text-slate-800">Run</strong>.
                The agent begins streaming its response immediately. You can see each tool call
                and thinking step as it happens.
              </Step>
              <Step n={3} title="Ask follow-ups">
                Once a result is shown, a refinement input appears at the bottom of the output canvas.
                Type a follow-up question and press <strong className="text-slate-800">Enter</strong> — the agent
                retains the full session context.
              </Step>
              <Step n={4} title="Start fresh">
                Click <strong className="text-slate-800">↺ New Session</strong> in the sidebar to reset
                the session ID and return to the agent directory. Previous session history is cleared.
              </Step>
            </div>

            <Callout type="tip">
              If an agent returns an error, check that the backend services are running with
              <code className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">make dev-up</code>
              and that the selected test persona has the required role for the agent you are using.
            </Callout>
          </Section>

          {/* ── 5. Results ──────────────────────────────────────────────── */}
          <Section id="results" icon="📋" title="Reading Results">
            <p>
              The output canvas has two panes — a step-by-step execution rail on the left and the
              formatted result on the right.
            </p>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Element</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">What it means</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ['Thinking block',   'The model\'s internal reasoning — shows how it plans its approach'],
                    ['Tool call step',   'Each MCP tool the agent invoked, with the query it sent'],
                    ['Status pill',      'Running (blue) / Ready (green) / Error (red) in the top bar'],
                    ['Result body',      'The final structured output: sections, tables, recommendations'],
                    ['Refinement bar',   'Appears after a result — type to ask follow-up questions'],
                  ].map(([el, desc]) => (
                    <tr key={el}>
                      <td className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{el}</td>
                      <td className="px-4 py-2.5 text-slate-600">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Callout type="tip">
              If the status pill stays on <strong>Running</strong> for more than 60 seconds, the agent
              may be waiting on a slow tool call. This is normal for the first call after a cold start
              as MCP server connections are established.
            </Callout>
          </Section>

          {/* ── 6. Test Personas ────────────────────────────────────────── */}
          <Section id="personas" icon="🧪" title="Test Personas (Dev)">
            <p>
              In local and development environments, a <strong className="text-slate-800">Test Persona</strong> selector
              appears at the bottom of the sidebar. It lets you switch the JWT identity used for
              every agent request — without logging in — so you can test RBAC enforcement across
              different roles.
            </p>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Persona</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Access level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    ['manager',   'rm_manager',  'Full book access, all tools, AML clearance'],
                    ['senior_rm', 'senior_rm',   'Large book (50 accounts), standard clearance'],
                    ['rm',        'rm',          'Small book (10 accounts), standard clearance'],
                    ['readonly',  'readonly',    'Read-only, no tool calls, no CRM write'],
                  ].map(([name, role, access]) => (
                    <tr key={name}>
                      <td className="px-4 py-2.5 font-mono text-xs text-purple-700 font-semibold">{name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{role}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{access}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Callout type="info">
              The Test Persona selector is hidden in production — the
              <code className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">/auth/personas</code>
              endpoint returns 403 and the component stays hidden automatically.
            </Callout>
          </Section>

          {/* ── 7. Shortcuts ────────────────────────────────────────────── */}
          <Section id="shortcuts" icon="⌨️" title="Tips & Shortcuts">
            <p>A few things that speed up everyday use:</p>

            <div className="border border-slate-200 rounded-xl px-4 py-1 mt-1">
              <Kbd keys={['Enter']}        label="Submit prompt (when form is focused)" />
              <Kbd keys={['Shift', 'Enter']} label="New line in refinement input" />
              <Kbd keys={['Esc']}           label="Cancel streaming response" />
              <Kbd keys={['Tab']}           label="Move between form fields" />
            </div>

            <p className="mt-4 font-semibold text-slate-700">Tips</p>
            <ul className="list-disc list-inside space-y-2 ml-1">
              <li>Click any data source chip on an agent card to explore its schema before running the agent.</li>
              <li>The <strong className="text-slate-800">Quantitix</strong> logo and breadcrumb link always return you to the team directory.</li>
              <li>Your RM name at the bottom of the sidebar is editable inline — changes take effect on the next run.</li>
              <li>
                Run <code className="font-mono text-xs bg-slate-100 px-1 rounded">make dev-up</code> from the
                repo root to start all services. Use
                <code className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">make logs</code> to tail service logs.
              </li>
              <li>
                OPA policies live in <code className="font-mono text-xs bg-slate-100 px-1 rounded">platform/opa/policies/</code>.
                Changes are hot-reloaded — no restart needed.
              </li>
            </ul>
          </Section>

          {/* Bottom padding */}
          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
