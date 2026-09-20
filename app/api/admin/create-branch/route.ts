import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // 1. Verify the requester session
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !callerUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch their profile to prove they are an admin and get their tenant_id
    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role, tenant_id')
      .eq('id', callerUser.id)
      .single();

    if (!callerProfile || callerProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admins only' }, { status: 403 });
    }

    // 3. Create the new branch securely linked to their tenant_id
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: newBranch, error: insertError } = await adminClient
      .from('branches')
      .insert([
        { 
          name: name, 
          tenant_id: callerProfile.tenant_id 
        }
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, branch: newBranch });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create branch' }, { status: 500 });
  }
}