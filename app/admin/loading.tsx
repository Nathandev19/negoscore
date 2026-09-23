export default function AdminLoading() {
  return <main id="contenu" aria-busy="true" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-10 sm:px-6">
    <p className="text-small font-semibold uppercase tracking-widest text-marque">Chargement du cockpit</p>
    <div className="h-12 w-72 animate-pulse bg-filet" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({length:8},(_,index)=><div key={index} className="h-28 animate-pulse bg-filet" />)}</div>
  </main>;
}
