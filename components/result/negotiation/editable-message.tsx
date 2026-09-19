"use client";

import { useId, useState } from "react";
import { CopyButton } from "@/components/result/copy-button";

// Mission #080, F6 — le message proposé est modifiable avant d'être copié, et
// l'écran le dit. Les modifications restent dans la page : elles ne sont ni
// enregistrées ni envoyées, et c'est écrit aussi.
export function EditableMessage({ text, label = "Message à envoyer" }: { text: string; label?: string }) {
  const [value, setValue] = useState(text);
  const id = useId();
  const hintId = useId();
  const edited = value !== text;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-small font-semibold text-encre">
        {label}
      </label>
      <p id={hintId} className="text-small text-attenue">
        Tu peux le modifier avant de l&apos;envoyer : l&apos;outil ne l&apos;envoie jamais à ta place. Tes modifications ne
        sont pas enregistrées, copie-le une fois prêt.
      </p>
      <textarea
        id={id}
        aria-describedby={hintId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={Math.min(18, Math.max(6, text.split("\n").length + 1))}
        className="w-full rounded-control border-2 border-encre bg-creme px-3 py-2 text-base leading-relaxed text-encre"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <CopyButton text={value} />
        {edited ? (
          <button type="button" onClick={() => setValue(text)} className="link w-fit text-small">
            Revenir au message proposé
          </button>
        ) : null}
      </div>
    </div>
  );
}
