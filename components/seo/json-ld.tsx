// Bloc de données structurées (mission #051). Le contenu vient de lib/seo.ts,
// jamais d'une donnée d'utilisateur : les chevrons sont tout de même échappés,
// pour qu'aucune valeur ne puisse fermer la balise.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }}
    />
  );
}
