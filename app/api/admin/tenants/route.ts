import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// Force Next.js not to cache this secure route
export const dynamic = 'force-dynamic';

// 1. The God-Mode Client (Bypasses RLS)
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2. The Bouncer (Reads the token sent from the frontend)
async function verifySuperAdmin(request: Request) {
  // Read the authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  
  const token = authHeader.replace('Bearer ', '');

  // Verify the token securely using the Admin client
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return false;

  // Find this user's workspace profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!profile?.tenant_id) return false;

  // Ensure their workspace is actually the 'Master' account
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('subscription_status')
    .eq('id', profile.tenant_id)
    .single();

  return tenant?.subscription_status === 'Master';
}

export async function GET(request: Request) {
  // Security Check
  const isSuperAdmin = await verifySuperAdmin(request);
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Access Denied: Master Admin Only' }, { status: 401 });
  }

  // Fetch Data
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ tenants: data });
}

export async function PATCH(request: Request) {
  // Security Check
  const isSuperAdmin = await verifySuperAdmin(request);
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Access Denied: Master Admin Only' }, { status: 401 });
  }

  const { tenantId, updates } = await request.json();

  // Update Data
  const { error } = await supabaseAdmin
    .from('tenants')
    .update(updates)
    .eq('id', tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}