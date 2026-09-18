// Cookies posés par le produit (mission #047). La mesure d'audience n'y figure
// plus : depuis la mission #049 elle tourne sans rien écrire sur l'appareil
// (lib/analytics/client.ts, cookieless_mode « always »), et le test échoue si un
// cookie de mesure réapparaît. Chaque nom est vérifié contre
// les constantes du code par tests/purge.test.tsx (page /confidentialite) : un cookie ajouté sans être
// annoncé ici fait échouer le test.
export const COOKIES = [
  "sb_access_token et sb_refresh_token — garder ta session de connexion ouverte — illisibles par les scripts de la page — 30 jours, effacés à la déconnexion.",
  "sb_pkce_verifier — sécuriser le lien de connexion envoyé par email — 15 minutes, envoyé seulement aux adresses de connexion.",
  "deal_anon_token — rattacher à ce navigateur une analyse lancée sans compte, et compter l'analyse gratuite — illisible par les scripts de la page — 30 jours, effacé à la connexion.",
  "ns_session — indiquer à l'affichage qu'une session est ouverte dans ce navigateur, sans identifiant ni email — 30 jours, effacé à la déconnexion.",
  "ns_proprio — afficher, pour l'administrateur du site seulement, un lien vers ses pages de suivi, sans identifiant ni email ; il ne donne accès à rien — 30 jours, effacé à la déconnexion.",
  "ns_gratuit — indiquer à l'affichage que l'analyse gratuite de ce navigateur est déjà utilisée, sans identifiant — 30 jours. Il n'est lu que par ton navigateur : comme tout cookie, il accompagne les requêtes vers le site, qui ne le lit ni ne l'enregistre.",
  "ns_flash — afficher une fois « Connexion réussie » ou « Déconnexion réussie » — 60 secondes au plus, effacé dès l'affichage.",
  "negoscore_niveau — retenir le niveau choisi pour le calcul des tarifs — 12 mois.",
] as const;
