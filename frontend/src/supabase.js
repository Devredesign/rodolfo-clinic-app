import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SB_URL,
  import.meta.env.VITE_SB_PUBLIC
)
