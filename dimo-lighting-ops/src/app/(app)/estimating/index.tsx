import { Redirect } from 'expo-router';

/** Estimation tab: opens on the Catalog sub-tab */
export default function Estimating() {
  return <Redirect href="/estimating/catalog" />;
}
