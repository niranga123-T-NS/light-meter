import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';
import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';
import { rpc, supabase } from './supabase';

/** Site radio (walkie-talkie): one channel per execution project's crew. */
export type RadioMessage = {
  id: string;
  exec_project_id: string;
  sender_id: string;
  kind: 'voice' | 'text';
  storage_path: string | null;
  duration_ms: number | null;
  body: string | null;
  urgent: boolean;
  sent_at: string;
};

/** Longest single transmission (the database accepts up to 2 minutes). */
export const RADIO_MAX_MS = 120_000;
/** Shorter presses are taken as a slip of the finger and not sent. */
export const RADIO_MIN_MS = 400;

/** Voice-grade AAC (mono, 22 kHz, 32 kbps): about 4 kB a second, so clips upload fast on site mobile data. */
export const RADIO_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

export async function loadRadio(execId: string, limit = 60): Promise<RadioMessage[]> {
  const { data, error } = await supabase
    .from('radio_messages')
    .select('*')
    .eq('exec_project_id', execId)
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as RadioMessage[];
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Uploads a finished recording to the private "radio" bucket and posts it on the channel. */
export async function sendVoice(execId: string, senderId: string, uri: string, durationMs: number, urgent: boolean) {
  const web = Platform.OS === 'web';
  const bytes = web ? await (await fetch(uri)).arrayBuffer() : await new FsFile(uri).arrayBuffer();
  const path = `${execId}/${senderId}/${Date.now()}-${uuid()}.${web ? 'webm' : 'm4a'}`;
  const up = await supabase.storage.from('radio').upload(path, bytes, { contentType: web ? 'audio/webm' : 'audio/mp4', upsert: false });
  if (up.error) throw new Error(up.error.message);
  try {
    return await rpc<string>('radio_send', { p_exec: execId, p_kind: 'voice', p_path: path, p_duration_ms: Math.round(durationMs), p_urgent: urgent });
  } catch (e) {
    await supabase.storage.from('radio').remove([path]);
    throw e;
  } finally {
    if (!web) {
      try {
        new FsFile(uri).delete();
      } catch {
        // the recorder's temporary file is cleaned up by the OS anyway
      }
    }
  }
}

export function sendText(execId: string, text: string, urgent: boolean) {
  return rpc<string>('radio_send', { p_exec: execId, p_kind: 'text', p_body: text, p_urgent: urgent });
}

// signed URLs are valid for an hour; reuse them for 50 minutes
const urls = new Map<string, { url: string; at: number }>();
export async function clipUrl(path: string): Promise<string> {
  const hit = urls.get(path);
  if (hit && Date.now() - hit.at < 50 * 60_000) return hit.url;
  const { data, error } = await supabase.storage.from('radio').createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'Could not open the voice message');
  urls.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

export const fmtSecs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
