# GOAL

Enregistrer le nom de domaine du référent sur chaque événement de visite, et l'afficher dans `/admin`, pour savoir d'où viennent les visites qui arrivent sans paramètres utm.

# DONE WHEN

1. Une colonne « Référent » apparaît dans le tableau de `/admin/evenements`, entre la colonne « Source · Campagne · Contenu » et la colonne « Interne ».
2. Dans le bloc « Acquisition » de `/admin`, la ligne `non_attribue` est ventilée par domaine de référent, une sous-ligne par domaine, avec ses visites, ses analyses et ses achats. Les lignes attribuées par utm s'affichent exactement comme aujourd'hui.
3. Une phrase sous le tableau dit que les visites antérieures à cette mission n'ont pas de référent enregistré et apparaissent comme inconnues. Aucune valeur n'est reconstituée rétroactivement.
4. La page de politique de confidentialité mentionne le domaine de référent.
5. Les scripts de test, de build et de vérification de types trouvés à l'étape 0 passent tous.
6. Le rapport final donne le SQL de la migration prêt à coller, la liste des fichiers touchés, et le résultat des trois scripts.
