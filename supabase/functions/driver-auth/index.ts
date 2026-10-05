import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createDriverHandler } from "./handler.mjs";
Deno.serve(
  createDriverHandler({
    createClient,
    env: (name: string) => Deno.env.get(name),
  }),
);
