import { createElement, forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { DtIn, DtOut, EngineHandle } from '@/lib/designTools';
import { routeMessage } from './engineBridge';

/** The calculation page in a frame (web portal). The page is passed in as text, so it is never at a public address. */
export const DesignEngine = forwardRef<EngineHandle, { html: string; onMessage: (m: DtOut) => void; height: number }>(function DesignEngine({ html, onMessage, height }, ref) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  useImperativeHandle(ref, () => ({ send: (m: DtIn) => frame?.contentWindow?.postMessage(m, '*') }), [frame]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow || !e.data || typeof e.data.type !== 'string') return;
      routeMessage(e.data as DtOut);
      onMessage(e.data as DtOut);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [frame, onMessage]);
  return createElement('iframe', {
    ref: setFrame,
    srcDoc: html,
    title: 'Design Tools',
    style: { width: '100%', height, border: '1px solid #e3e5ea', borderRadius: 12, background: '#EEF1F0' },
  });
});
