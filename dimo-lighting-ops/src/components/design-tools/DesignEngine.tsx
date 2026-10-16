import { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Loading } from '@/components/ui';
import type { DtIn, DtOut, EngineHandle } from '@/lib/designTools';
import { routeMessage } from './engineBridge';

/** The calculation page inside the phone / tablet app (web view) */
export const DesignEngine = forwardRef<EngineHandle, { html: string; onMessage: (m: DtOut) => void; height: number }>(function DesignEngine({ html, onMessage, height }, ref) {
  const web = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({ send: (m: DtIn) => web.current?.injectJavaScript(`window.dtRecv && window.dtRecv(${JSON.stringify(m)}); true;`) }), []);
  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e3e5ea' }}>
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
