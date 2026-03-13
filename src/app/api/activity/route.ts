// Importing necessary modules
import { createClient } from '@supabase/supabase-js';

// Create a single supabase client for interacting with your database
const supabaseUrl = 'your-supabase-url';
const supabaseKey = 'your-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function getActivity(userId: string) {
  // Fetch data from ab_users array in your Supabase table
  const { data, error } = await supabase
    .from('ab_users')
    .select('*')
    .eq('id', userId);

  if (error) {
    console.error('Error fetching activity:', error);
    return null;
  }

  return data ? data[0] : null; // Access the first element safely
}