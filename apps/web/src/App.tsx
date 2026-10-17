import { RemoteVenues, RemoteMenu, RemoteOrders, RemoteOrderDetails, RemoteDemo } from './remote/Remote'
import { LoyaltyCards, LoyaltyDemo } from './loyalty/Loyalty'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './AppContext'
import { Approval } from './screens/Approval'
import { Charge } from './screens/Charge'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { NewRemoteCharge } from './screens/NewRemoteCharge'
import { Pay } from './screens/Pay'
import { RemoteCharge } from './screens/RemoteCharge'
import { Receipt } from './screens/Receipt'
import { Refund } from './screens/Refund'
import { Settings } from './screens/Settings'
import { Shift } from './screens/Shift'
import { MerchantWelcome, MerchantDemo, MerchantOwner, MerchantTerminal, MerchantCheckout } from './merchant/Merchant'
import { MerchantScanner } from './merchant/Scanner'
import type { ReactNode } from 'react'

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useApp()
  return token ? <>{children}</> : <Navigate to="/" replace />
}

export function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/venues" element={<RemoteVenues />} />
        <Route path="/venues/:venueId" element={<RemoteMenu />} />
        <Route path="/orders" element={<RemoteOrders />} />
        <Route path="/orders/:orderId" element={<RemoteOrderDetails />} />
        <Route path="/remote/demo" element={<RemoteDemo />} />
        <Route path="/merchant/scan" element={<MerchantScanner />} />
        <Route path="/" element={<Home />} />
        <Route path="/merchant" element={<MerchantWelcome />} />
        <Route path="/merchant/demo" element={<MerchantDemo />} />
        <Route path="/merchant/cards" element={<LoyaltyCards />} />
        <Route path="/merchant/loyalty/demo" element={<LoyaltyDemo />} />
        <Route path="/merchant/owner" element={<MerchantOwner />} />
        <Route path="/merchant/terminal" element={<MerchantTerminal />} />
        <Route path="/merchant/checkout/:token" element={<MerchantCheckout />} />
        <Route path="/pay" element={<RequireAuth><Pay /></RequireAuth>} />
        <Route path="/charge" element={<RequireAuth><Charge /></RequireAuth>} />
        <Route path="/charge/remote" element={<RequireAuth><NewRemoteCharge /></RequireAuth>} />
        {/* Unauthenticated: the payer following a shared link may have no
            account yet — same reasoning as the API route it calls. Login
            happens inline, on accept, not as a route gate. */}
        <Route path="/r/:id" element={<RemoteCharge />} />
        <Route path="/session/:id" element={<RequireAuth><Approval /></RequireAuth>} />
        <Route path="/receipt/:id" element={<RequireAuth><Receipt /></RequireAuth>} />
        <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/shift" element={<RequireAuth><Shift /></RequireAuth>} />
        <Route path="/refund/:chargeId" element={<RequireAuth><Refund /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  )
}
