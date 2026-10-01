import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, Muted, Notice, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { disableWebPush, enableWebPush, webPushStatus, type WebPushStatus } from '@/lib/webpush';

const TEXT: Record<WebPushStatus, string> = {
  'needs-home-screen': 'On iPhone and iPad, notifications work after adding the portal to the Home Screen: tap Share → Add to Home Screen, then open DIMO Ops from the new icon and turn notifications on here.',
  unsupported: 'This browser cannot show notifications. Use Chrome, Edge, Firefox or Safari, or the Android app.',
  blocked: 'Notifications are blocked for this site. Allow them in the browser (or iPhone Settings → Notifications → DIMO Ops), then come back here.',
  off: 'Get a notification on this device when it is your turn – even when the portal is closed.',
  on: 'Notifications are on for this device.',
};

/** Web portal: turn phone / browser notifications on or off for this device. */
export function WebPushCard({ compact = false }: { compact?: boolean }) {
  const dialog = useDialog();
  const [status, setStatus] = useState<WebPushStatus | null>(null);
  const me = useMe();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    webPushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);

  if (Platform.OS !== 'web' || !status) return null;
  if (compact && status !== 'off' && status !== 'needs-home-screen') return null;

  const turnOn = () =>
    dialog.run(async () => {
      await enableWebPush(me.id);
      setStatus(await webPushStatus());
    }, 'Notifications are on for this device');
  const turnOff = () =>
    dialog.run(async () => {
      await disableWebPush();
      setStatus(await webPushStatus());
    }, 'Notifications are off for this device');

  const body = (
    <>
      <Muted>{TEXT[status]}</Muted>
      {status === 'off' ? (
        <Row>
          <Button small title="Turn on notifications" onPress={turnOn} />
        </Row>
      ) : null}
      {status === 'on' && !compact ? (
        <Row>
          <Button small variant="secondary" title="Turn off on this device" onPress={turnOff} />
        </Row>
      ) : null}
    </>
  );
  return compact ? <Notice>{body}</Notice> : <Card style={{ gap: 10 }}>{body}</Card>;
}
