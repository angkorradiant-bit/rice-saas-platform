import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { company_name, full_name, email, password } = await request.json();

    if (!company_name || !full_name || !email || !password) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    // We MUST use the Service Role Key here to bypass security and provision top-level accounts
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Provision the New Company (Tenant) with a "Pending" status for your approval
    const { data: tenant, error: tenantErr } = await adminClient
      .from('tenants')
      .insert([{ name: company_name, subscription_status: 'Pending' }])
      .select()
      .single();

    if (tenantErr) throw new Error(`Tenant Error: ${tenantErr.message}`);

    // 2. Provision their first physical store location (Branch)
    const { data: branch, error: branchErr } = await adminClient
      .from('branches')
      .insert([{ name: 'Main Branch', tenant_id: tenant.id }])
      .select()
      .single();

    if (branchErr) throw new Error(`Branch Error: ${branchErr.message}`);

    // 3. Register the User Login & inject their new workspace IDs
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'admin', // Make them the Master Admin of their own new company
        tenant_id: tenant.id,
        branch_id: branch.id
      }
    });

    if (authErr) throw new Error(`Auth Error: ${authErr.message}`);

    // (Your PostgreSQL trigger 'handle_new_user' will automatically catch this 
    // and securely create their profile row in public.profiles!)

    return NextResponse.json({ success: true, user: authData.user });
  } catch (err: any) {
    console.error('Registration API Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create workspace' }, { status: 500 });
  }
}