import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient'; 

// 1. The God-Mode Client (Bypasses RLS)
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2. The Bouncer (Checks who is knocking on the API door)
async function verifySuperAdmin() {
  // 👇 Removed the createClient() line because supabase is already imported above
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_super_admin === true;
}

export async function GET() {
  // Security Check
  const isSuperAdmin = await verifySuperAdmin();
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
  const isSuperAdmin = await verifySuperAdmin();
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