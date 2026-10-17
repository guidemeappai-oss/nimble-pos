import { t } from '../i18n';
import { Link } from 'react-router-dom';
import './merchant.css';
export function MerchantEntry() {
  return (
    <section className="m-home-entry" aria-label="Counter for merchants">
      <span className="m-label">YOUR PHONE. YOUR COUNTER.
      </span>
      <h2>A little café.
        <br />A big possibility.
      </h2>
      <p>A menu, a team, a smooth daily rhythm. Accept NIM and USDT directly to your wallet.
      </p>
      <Link to="/merchant/demo">Try Maison Café →
      </Link>
      <small>Simulated café · no wallet or real funds
      </small>
      <div className="m-home-links">
        <Link to="/merchant/owner">Create your venue
        </Link>
        <Link to="/merchant/terminal">Open terminal
        </Link>
      </div>
      <Link to="/venues">{t('Order ahead')} →</Link>
      <Link to="/orders">{t('My orders')} →</Link>
      <Link to="/remote/demo">{t('Try remote ordering')} →</Link>
      <Link to="/merchant/scan">Scan an order QR →</Link>
    </section>);
}
