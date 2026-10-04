import { Redirect } from 'expo-router';

/** The sales meeting now lives in Meetings (with the Estimation and Design meetings); old links land there. */
export default function SalesMeetingRedirect() {
  return <Redirect href="/meetings?team=sales" />;
}
