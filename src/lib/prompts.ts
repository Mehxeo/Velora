export const quickActions = [
  { id: 'explain', label: 'Explain', template: 'Explain this clearly in simple language.' },
  { id: 'solve', label: 'Solve', template: 'Solve this step-by-step and include your full reasoning. Show each step clearly.' },
  { id: 'code', label: 'Code', template: 'Write clean, production-ready code to solve this. Provide a brief explanation of your approach and include inline comments where helpful.' },
  { id: 'interview', label: 'Interview', template: 'Answer this as if you are in a technical interview. Be concise, structured, and impressive. Use the STAR method if behavioral, or explain your reasoning clearly if technical. Keep it under 2 minutes to say aloud.' },
  { id: 'homework', label: 'Homework', template: 'Help me understand and complete this step-by-step. Explain each step clearly so I learn the concept — do not just give the answer, teach me how to arrive at it.' },
  { id: 'summarize', label: 'Summarize', template: 'Summarize this into the most important key points. Use bullet points.' },
  { id: 'simplify', label: 'Simplify', template: 'Rewrite this so a beginner can understand it quickly. Use simple words and a clear analogy if helpful.' },
] as const

export type QuickActionId = (typeof quickActions)[number]['id']

type PromptContext = {
  memoryNotes?: string[]
  personalization?: {
    preferredName?: string
    responseTone?: string
    learningGoal?: string
    customInstructions?: string
  }
}

export function buildPrompt(action: QuickActionId, input: string, context?: PromptContext): string {
  const selected = quickActions.find((item) => item.id === action)
  if (!selected) {
    return input
  }

  const preamble: string[] = []

  if (context?.personalization?.preferredName) {
    preamble.push(`Address the user as ${context.personalization.preferredName}.`)
  }
  if (context?.personalization?.responseTone) {
    preamble.push(`Response tone: ${context.personalization.responseTone}.`)
  }
  if (context?.personalization?.learningGoal) {
    preamble.push(`Learning goal: ${context.personalization.learningGoal}.`)
  }
  if (context?.personalization?.customInstructions) {
    preamble.push(`Custom instructions: ${context.personalization.customInstructions}`)
  }
  if (context?.memoryNotes?.length) {
    preamble.push(`Relevant memory:\n- ${context.memoryNotes.join('\n- ')}`)
  }

  return [selected.template, preamble.join('\n'), `Input:\n${input}`].filter(Boolean).join('\n\n')
}
