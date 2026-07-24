interface AlbumArtProps {
  coverArtUrl: string | null;
  alt: string;
}

export function AlbumArt({ coverArtUrl, alt }: AlbumArtProps) {
  return (
    <div className="flex aspect-square w-full max-w-xs items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 shadow-xl">
      {coverArtUrl ? (
        <img src={coverArtUrl} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-20 w-20 text-slate-600"
          aria-hidden="true"
        >
          <path
            d="M9 18V5l12-2v13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}
