import type { MerchantOrder } from '@nimble/shared';
import { t } from '../i18n';

/** Display server reservation state only; quote presence is not a stock promise. */
export function StockReservationStatus({ reservation }: { reservation: MerchantOrder['stockReservation'] }) {
  if (!reservation || reservation.status === 'NONE') return null;
  return <p className="m-muted" role="status">
    {reservation.status === 'HELD' && (reservation.expiresAt
      ? <>{t('Stock reserved until')}: <time dateTime={reservation.expiresAt}>{new Date(reservation.expiresAt).toLocaleTimeString()}</time>. {t('The server checks availability again before accepting payment.')}</>
      : t('Stock is held while payment verification or venue acceptance is pending.'))}
    {reservation.status === 'EXPIRED' && t('The stock reservation expired. Request a fresh quote before paying. If you already approved a transfer, check its status. Do not pay again; a late payment may require a refund.')}
    {reservation.status === 'RELEASED' && t('The stock reservation was released. If a payment was sent, check the order or refund status before taking any further action.')}
    {reservation.status === 'CONSUMED' && t('Stock has been deducted for this order.')}
  </p>;
}
