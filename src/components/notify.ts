// Important notices: anything the person must know (something dropped, something failed, something they are doing
// wrong) is queued here and shown one at a time by <Notices /> as a round "i" that rises to the bottom centre and
// opens in place into a card. Small helper text that is fine inline stays inline.
import { useStore } from '../store';

export type NoticeTone = 'info' | 'warn' | 'error';
export interface Notice {
  id: string;
  title: string;
  body: string;
  tone?: NoticeTone;
  /** remember "Got it" on this device and never show it again */
  once?: boolean;
  /** label of the closing button (default "Got it") */
  ok?: string;
  /** an optional second button; it runs and then closes the notice */
  action?: { label: string; run: () => void };
}

const SEEN = 'tech-it-notices-seen';
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(SEEN, JSON.stringify([...new Set([...seen(), id])].slice(-200))); } catch { /* storage blocked */ } };

/** Queue a notice. The same id is never queued twice at once; a `once` notice stays gone after "Got it". */
export function notify(n: Notice): void {
  if (n.once && seen().includes(n.id)) return;
  const st = useStore.getState();
  if (st.notices.some((x) => x.id === n.id)) return;
  useStore.setState({ notices: [...st.notices, n] });
}

/** Close a notice (the one on screen by default) and move on to the next. */
export function dismissNotice(id?: string): void {
  const st = useStore.getState();
  const n = id ? st.notices.find((x) => x.id === id) : st.notices[0];
  if (!n) return;
  if (n.once) remember(n.id);
  useStore.setState({ notices: st.notices.filter((x) => x !== n) });
}
