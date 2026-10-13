import { Redirect } from 'expo-router';

/** Foreign & local orders: opens on the foreign orders sub-tab */
export default function Orders() {
  return <Redirect href="/orders/foreign" />;
}
