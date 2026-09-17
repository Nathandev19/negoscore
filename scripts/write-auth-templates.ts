import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { authTemplates } from "@/lib/email/auth-templates";

// Écrit supabase/templates/*.html depuis lib/email/auth-templates.ts : les
// gabarits à coller dans le tableau de bord Supabase. Aucun envoi, aucun réseau.
//
// pnpm email:templates

for (const template of authTemplates()) {
  const file = path.join(process.cwd(), template.file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, template.html);
  console.log(`${template.file} — ${template.dashboardEntry} — objet : ${template.subject} — ${Buffer.byteLength(template.html)} octets`);
}
