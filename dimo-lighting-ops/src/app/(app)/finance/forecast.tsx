import { Redirect } from 'expo-router';

/** The invoicing forecast is a sub-tab of Invoicing – old links open it there. */
export default function ForecastRedirect() {
  return <Redirect href={{ pathname: '/finance/invoicing', params: { view: 'forecast' } }} />;
}
