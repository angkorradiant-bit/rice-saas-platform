import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json();
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !user_id) {
      return NextResponse.json({ error: 'Unauthorized or missing user ID' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !callerUser) throw new Error('Unauthorized');

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (!callerProfile || callerProfile.role !== 'admin') {
      throw new Error('Forbidden: Admins only');
    }

    if (callerUser.id === user_id) {
      throw new Error('You cannot delete your own active account.');
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // 1. Manually delete from profiles table first to prevent Foreign Key blocks
    await adminClient.from('profiles').delete().eq('id', user_id);
    
    // 2. Permanently delete their login from Supabase Auth
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);

    if (deleteErr) throw deleteErr;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}