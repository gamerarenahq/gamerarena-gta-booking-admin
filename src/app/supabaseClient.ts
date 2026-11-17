import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vvctggnzrypeexyqnzsl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2Y3RnZ256cnlwZWV4eXFuenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Nzg3MjksImV4cCI6MjA5MDI1NDcyOX0.w4zYuRE1QNd2UqeD5u6loOOwd_ctwMIKHDAGFnkuC0c';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);