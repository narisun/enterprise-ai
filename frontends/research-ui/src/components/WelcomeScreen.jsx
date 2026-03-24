import { Search, BarChart3, Globe, FileText } from 'lucide-react'

const SUGGESTIONS = [
  {
    icon: Search,
    label: 'Research a company',
    prompt: 'Research Stripe and give me a comprehensive overview of their business, recent news, and competitive position.',
  },
  {
    icon: BarChart3,
    label: 'Market analysis',
    prompt: 'Analyze the current state of the AI infrastructure market. Who are the key players and what are the trends?',
  },
  {
    icon: Globe,
    label: 'Industry deep dive',
    prompt: 'Give me a deep dive into the renewable energy sector in Europe — key companies, regulations, and investment trends.',
  },
  {
    icon: FileText,
    label: 'Competitive memo',
    prompt: 'Write a competitive analysis memo comparing Datadog, New Relic, and Splunk for enterprise observability.',
  },
]

export function WelcomeScreen({ onSuggestionClick }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 mb-2">
            <Search size={28} />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Enterprise Research Agent
          </h2>
          <p className="text-slate-500 max-w-md mx-auto">
            Ask a research question and watch the agent plan, gather data,
            and synthesize a comprehensive analysis.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => onSuggestionClick(s.prompt)}
              className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 text-left transition-all group"
            >
              <div className="flex-shrink-0 mt-0.5">
                <s.icon size={18} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
              </div>
              <div>
                <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors">
                  {s.label}
                </span>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                  {s.prompt}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
