import { createClient } from '@supabase/supabase-js'

const client = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const originalInvoke = client.functions.invoke.bind(client.functions)

client.functions.invoke = async (functionName, options) => {
  const result = await originalInvoke(functionName, options)

  if (functionName === 'finance-email-poll' && result.error) {
    const invokeError = result.error

    try {
      const response = invokeError.context
      if (response?.clone) {
        const payload = await response.clone().json()
        const message = payload?.error || payload?.message || invokeError.message || 'Error desconocido al procesar Gmail.'
        const status = response.status ? `Error ${response.status}` : invokeError.name || 'Error'
        return {
          data: { error: `${status}: ${message}` },
          error: null
        }
      }
    } catch (parseError) {
      console.error('No se pudo leer el body del error de finance-email-poll', parseError)
    }

    const errorType = invokeError.name || invokeError.constructor?.name || 'Error'
    const errorMessage = invokeError.message || 'No se pudo conectar con la Edge Function.'
    return {
      data: { error: `${errorType}: ${errorMessage}` },
      error: null
    }
  }

  return result
}

export const supabase = client
