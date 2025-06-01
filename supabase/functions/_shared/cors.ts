// Simple CORS helper shared by all Edge Functions
const DEFAULT_ORIGIN = '*';                                   // fallback
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? DEFAULT_ORIGIN;

export const corsHeaders = {
  'Access-Control-Allow-Origin'     : ALLOWED_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods'    : 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers'    : 'authorization, x-client-info, apikey, content-type',
} as const;
