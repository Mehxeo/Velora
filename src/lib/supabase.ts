import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined)

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string | undefined)

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

export async function shareConversation(
  conversation: unknown,
  sharedByEmail?: string,
): Promise<{ token: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('shared_conversations')
    .insert({ conversation, shared_by_email: sharedByEmail ?? null })
    .select('id')
    .single()
  if (error) return { error: error.message }
  return { token: data.id as string }
}

export async function fetchSharedConversation(
  token: string,
): Promise<{ conversation: unknown } | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('shared_conversations')
    .select('conversation')
    .eq('id', token.trim())
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Share code not found. Double-check and try again.' }
  return { conversation: data.conversation }
}
