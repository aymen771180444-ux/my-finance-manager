import { useRef } from 'react';
import { useLocation, useNavigationType, type NavigationType } from 'react-router-dom';

const TABS = ['/', '/transactions', '/accounts', '/analytics', '/more'];
const depth = (p: string) => p.split('/').filter(Boolean).length;

function pick(from: string, to: string, nav: NavigationType): string {
  if (TABS.includes(from) && TABS.includes(to)) return 'page-fade';
  if (nav === 'POP' || depth(to) < depth(from)) return 'page-pop';
  return depth(to) > depth(from) ? 'page-push' : 'page-fade';
}

/**
 * Which entrance animation the new screen gets, iOS-style:
 * a deeper screen slides in from the reading-end edge ("push"),
 * going back slides in from the other side ("pop"),
 * switching bottom tabs is a soft cross-fade.
 */
export function usePageTransition(): { key: string; className: string } {
  const location = useLocation();
  const navType = useNavigationType();
  // decided once per screen change and cached, so repeated renders (React dev mode renders twice) agree
  const last = useRef({ path: location.pathname, className: '' });
  if (last.current.path !== location.pathname) {
    last.current = { path: location.pathname, className: pick(last.current.path, location.pathname, navType) };
  }
  return { key: location.pathname, className: last.current.className };
}
