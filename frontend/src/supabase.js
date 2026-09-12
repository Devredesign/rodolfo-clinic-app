import { createClient, FunctionsHttpError } from '@supabase/supabase-js'

const client = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const originalInvoke = client.functions.invoke.bind(client.functions)

client.functions.invoke = async (functionName, options) => {
  const result = await originalInvoke(functionName, options)

  if (functionName === 'finance-email-poll' && result.error instanceof FunctionsHttpError) {
    try {
      const response = result.error.context
      const payload = await response.clone().json()
      const message = payload?.error || payload?.message || result.error.message || 'Error desconocido al procesar Gmail.'
      return {
        data: { error: `Error ${response.status}: ${message}` },
        error: null
      }
    } catch (parseError) {
      console.error('No se pudo leer el error de finance-email-poll', parseError)
    }
  }

  return result
}

export const supabase = client
