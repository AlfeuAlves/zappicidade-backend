const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

// Cliente público (anon key) — para operações do cidadão
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// Cliente admin (service role) — para operações privilegiadas
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = { supabase, supabaseAdmin }
