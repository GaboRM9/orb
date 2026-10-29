// The page shell while a route's server work runs. Its presence also lets <Link> prefetch these dynamic routes.
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-14 md:px-10" aria-busy>
      <div className="h-10 w-40 rounded-md bg-surface" />
      <div className="h-24 rounded-lg bg-surface" />
    </div>
  );
}
