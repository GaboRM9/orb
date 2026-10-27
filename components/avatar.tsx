export const Avatar = ({ name, size = "h-12 w-12 text-lg" }: { name: string; size?: string }) => (
  <div className={`flex shrink-0 items-center justify-center rounded-full border border-line bg-surface font-semibold ${size}`}>{name[0]?.toUpperCase()}</div>
);
