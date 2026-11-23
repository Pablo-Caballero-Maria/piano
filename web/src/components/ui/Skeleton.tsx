/** A placeholder with the shape of what is loading (a skeleton loader): a softly pulsing block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-[10px] bg-raised ${className}`} />;
}
