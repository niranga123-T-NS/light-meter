import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import type { DtIn, DtOut, EngineHandle } from '@/lib/designTools';
import { routeMessage } from './engineBridge';

/** The calculation page inside the phone / tablet app (web view) */
export const DesignEngine = forwardRef<EngineHandle, { html: string; onMessage: (m: DtOut) => void; height: number; full?: boolean }>(function DesignEngine({ html, onMessage, height, full }, ref) {
  const web = useRef<WebView>(null);
  const win = useWindowDimensions();
  const ins = useSafeAreaInsets();
  useImperativeHandle(ref, () => ({ send: (m: DtIn) => web.current?.injectJavaScript(`window.dtRecv && window.dtRecv(${JSON.stringify(m)}); true;`) }), []);
  return (
    <View style={full ? { height: win.height - ins.top - ins.bottom, marginTop: ins.top, marginLeft: ins.left, marginRight: ins.right, overflow: 'hidden' } : { height, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e3e5ea' }}>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => <Loading label="Opening Design Tools…" />}
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data) as DtOut;
            routeMessage(m);
            onMessage(m);
          } catch {
            /* not ours */
          }
        }}
      />
    </View>
  );
});
