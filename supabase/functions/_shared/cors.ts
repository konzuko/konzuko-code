const DEFAULT_ORIGIN = '*';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || DEFAULT_ORIGIN;

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Max-Age': '86400',  // Cache for 24 hours
};

// Catch-all for OPTIONS requests
export const handleCors = (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        'Access-Control-Expose-Headers': corsHeaders['Access-Control-Allow-Headers']
      },
      status: 204  // No content
    });
  }
  return null;
};
