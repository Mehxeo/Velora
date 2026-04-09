import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

type MultiModelResponse = { gpt: string; claude: string; gemini: string }
type Props = { responses: MultiModelResponse | null; isLoading: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mdComponents: Record<string, (props: any) => React.ReactElement> = {
  code({ children, className, node: _n, ref: _r, ...rest }: {
    children?: React.ReactNode; className?: string; node?: unknown; ref?: unknown; [key: string]: unknown
  }) {
    const match = /language-(\w+)/.exec(className ?? '')
    if (match) {
      return (
        <SyntaxHighlighter PreTag="div" language={match[1]} style={vscDarkPlus}>
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      )
    }
    return <code className={className} {...rest}>{children}</code>
  },
}

type CardModel = { title: string; body: string; accentFrom: string; accentTo: string }

const ResponseCard = memo(function ResponseCard({ title, body, accentFrom, accentTo }: CardModel) {
  return (
    <article className="velora-panel rounded-2xl p-4 flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full" style={{ background: accentFrom }} />
        <h4 className="text-sm font-bold" style={{
          background: `linear-gradient(130deg, ${accentFrom}, ${accentTo})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {title}
        </h4>
      </div>
      <div className="flex-1 max-h-52 overflow-y-auto custom-scrollbar prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:p-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {body}
        </ReactMarkdown>
      </div>
    </article>
  )
})

const MODEL_CARDS: Omit<CardModel, 'body'>[] = [
  { title: 'GPT-4o Mini',       accentFrom: '#60a5fa', accentTo: '#818cf8' },
  { title: 'Claude 3.5 Sonnet', accentFrom: '#fb923c', accentTo: '#f59e0b' },
  { title: 'Gemini 2.5 Flash',  accentFrom: '#34d399', accentTo: '#06b6d4' },
]

export const MultiModelSplitView = memo(function MultiModelSplitView({ responses, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="velora-panel rounded-2xl p-6 flex flex-col items-center justify-center gap-3 h-32">
        <div className="flex items-center gap-2">
          {MODEL_CARDS.map((m) => (
            <span key={m.title} className="h-2.5 w-2.5 rounded-full animate-pulse"
              style={{ background: m.accentFrom, animationDelay: MODEL_CARDS.indexOf(m) * 150 + 'ms' }} />
          ))}
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
          Evaluating across all models...
        </p>
      </div>
    )
  }

  if (!responses) {
    return (
      <div className="velora-panel rounded-2xl p-5 flex flex-col items-center justify-center gap-1.5 h-28">
        <p className="text-sm font-semibold">Multi-model compare is active</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Send a prompt to compare GPT-4o Mini, Claude 3.5 Sonnet, and Gemini 2.5 Flash side-by-side.
        </p>
      </div>
    )
  }

  const bodies: Record<string, string> = {
    'GPT-4o Mini': responses.gpt,
    'Claude 3.5 Sonnet': responses.claude,
    'Gemini 2.5 Flash': responses.gemini,
  }

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {MODEL_CARDS.map((card) => (
        <ResponseCard key={card.title} {...card} body={bodies[card.title] ?? ''} />
      ))}
    </section>
  )
})
