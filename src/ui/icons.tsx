import type { JSX, SVGAttributes } from 'preact';

type P = { size?: number } & SVGAttributes<SVGSVGElement>;

const make = (paths: JSX.Element) =>
  function Icon({ size = 18, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...rest}>
        {paths}
      </svg>
    );
  };

export const IUndo = make(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const IRedo = make(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>);
export const IDownload = make(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>);
export const ILink = make(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>);
export const IFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />);
export const ISliders = make(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const IHelp = make(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><path d="M12 17h.01" /></>);
export const ISun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IMoon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const IAuto = make(<><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" /></>);
export const IPlus = make(<path d="M12 5v14M5 12h14" />);
export const IMinus = make(<path d="M5 12h14" />);
export const IFit = make(<><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></>);
export const IPointer = make(<path d="m5 3 14 8-6 1.5L10 19Z" />);
export const IArrowTool = make(<><path d="M6 6c0 9 5 13 12 13" /><path d="m14 15 4 4-4 4" transform="translate(0 -4)" /></>);
export const ICcommand = make(<><circle cx="12" cy="5" r="2" /><path d="M12 7 6 13M12 7l6 6" /><path d="M14 16h7l-3.5 6Z" fill="currentColor" stroke="none" opacity=".5" /><circle cx="6" cy="15" r="2" /></>);
export const IDominance = make(<><circle cx="12" cy="5" r="2" /><path d="m12 7-6 8h12Z" fill="currentColor" opacity=".25" /><path d="m12 7-6 8h12Z" /></>);
export const IEdit = make(<><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>);
export const IChild = make(<><rect x="8" y="3" width="8" height="5" rx="1" /><path d="M12 8v5" /><rect x="8" y="13" width="8" height="5" rx="1" stroke-dasharray="2 2" /><path d="M19 15.5h4M21 13.5v4" /></>);
export const ISister = make(<><rect x="2" y="9" width="8" height="5" rx="1" /><rect x="13" y="9" width="8" height="5" rx="1" stroke-dasharray="2 2" /><path d="M17 3v4M15 5h4" /></>);
export const ITrash = make(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const ITriangle = make(<path d="M12 4 3 20h18Z" />);
export const IPalette = make(<><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z" /><circle cx="7.5" cy="11" r="1.2" fill="currentColor" /><circle cx="10" cy="7" r="1.2" fill="currentColor" /><circle cx="15" cy="7.5" r="1.2" fill="currentColor" /></>);
export const IStar = make(<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7Z" />);
export const IMove = make(<><path d="M5 5c0 9 6 14 14 14" stroke-dasharray="3 3" /><path d="m15 15 4 4-4 4" transform="translate(0 -4)" /></>);
export const IClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IChevron = make(<path d="m6 9 6 6 6-6" />);
export const ICopy = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>);
export const IBook = make(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z" /><path d="M4 19V5" /><path d="M8 7h7M8 11h5" /></>);
export const IKeyboard = make(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
export const ISave = make(<><path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></>);
export const IScales = make(<><path d="M12 3v18M7 21h10M5 7h14" /><path d="m5 7-3 6a3 3 0 0 0 6 0Z" /><path d="m19 7-3 6a3 3 0 0 0 6 0Z" /></>);
export const ICopyNode = make(<><circle cx="7" cy="6" r="3" /><circle cx="17" cy="18" r="3" stroke-dasharray="2 2" /><path d="M9 8.5 15 15.5" stroke-dasharray="2 2" /></>);
export const IMore = make(<><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>);
