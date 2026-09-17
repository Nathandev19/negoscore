// Types de lien email reconnus par Supabase, d'après la définition EmailOtpType
// de supabase/auth-js (src/lib/types.ts) :
//   'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'
// La documentation (guide « Passwordless email logins », section PKCE) utilise
// type=email dans le modèle et dans verifyOtp.
//
// Seuls les types qui ouvrent une session de connexion sont acceptés par
// /auth/confirm : « email », et « magiclink » / « signup » pour un modèle qui
// les utiliserait encore. invite, recovery et email_change correspondent à des
// parcours qui n'existent pas sur le site (pas de mot de passe, pas
// d'invitation, pas de changement d'email) : ils sont refusés.
export const SUPABASE_EMAIL_OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const;
export const SIGN_IN_OTP_TYPES = ["email", "magiclink", "signup"] as const;
export type SignInOtpType = (typeof SIGN_IN_OTP_TYPES)[number];
