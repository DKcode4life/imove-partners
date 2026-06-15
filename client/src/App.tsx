import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { getSurface } from './lib/surface';

import Login from './pages/Login';
import AuthHandoff from './pages/AuthHandoff';
import AcceptQuote from './pages/AcceptQuote';
import PartnerActivityTracker from './components/PartnerActivityTracker';

// Partner pages
import PartnerDashboard from './pages/partner/Dashboard';
import PartnerLeads from './pages/partner/Leads';
import PartnerSubmitLead from './pages/partner/SubmitLead';
import PartnerLeadDetail from './pages/partner/LeadDetail';
import PartnerCommissions from './pages/partner/Commissions';
import PartnerSettings from './pages/partner/Settings';

// Admin pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminAllLeads from './pages/admin/AllLeads';
import AdminLeadDetail from './pages/admin/LeadDetail';
import AdminPartners from './pages/admin/Partners';
import AdminCRM from './pages/admin/CRM';
import AdminCRMDetail from './pages/admin/CRMDetail';
import AdminCRMCustomers from './pages/admin/CRMCustomers';
import AdminCRMCustomerDetail from './pages/admin/CRMCustomerDetail';
import AdminCRMJobs from './pages/admin/CRMJobs';
import AdminCRMPlanner from './pages/admin/CRMPlanner';
import AdminCRMWages from './pages/admin/CRMWages';
import AdminCRMSettings from './pages/admin/CRMSettings';
import AdminCRMContractJobs from './pages/admin/CRMContractJobs';
import AdminCRMContractor from './pages/admin/CRMContractor';
import AdminCRMContractInvoice from './pages/admin/CRMContractInvoice';

export default function App() {
  // Subdomain-aware route gating:
  //   partners.* → Partner Portal pages + admin partner-management pages
  //   crm.*      → CRM pages only
  //   anything else (localhost, legacy single domain) → everything (dev fallback)
  const surface = getSurface();
  const showPartnerPortal = surface !== 'crm';
  const showCrm = surface !== 'partners';

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/handoff" element={<AuthHandoff />} />

          {/* Public customer-facing quote acceptance — no auth, token-gated */}
          <Route path="/accept/:token" element={<AcceptQuote />} />

          {/* Partner routes */}
          {showPartnerPortal && (
            <Route element={<ProtectedRoute role="partner" />}>
              <Route element={<PartnerActivityTracker />}>
                <Route path="/partner/dashboard" element={<PartnerDashboard />} />
                <Route path="/partner/leads" element={<PartnerLeads />} />
                <Route path="/partner/leads/new" element={<PartnerSubmitLead />} />
                <Route path="/partner/leads/:id" element={<PartnerLeadDetail />} />
                <Route path="/partner/commissions" element={<PartnerCommissions />} />
                <Route path="/partner/settings" element={<PartnerSettings />} />
              </Route>
            </Route>
          )}

          {/* Admin routes — split by surface */}
          <Route element={<ProtectedRoute role="admin" />}>
            {showPartnerPortal && (
              <>
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/leads" element={<AdminAllLeads />} />
                <Route path="/admin/leads/:id" element={<AdminLeadDetail />} />
                <Route path="/admin/partners" element={<AdminPartners />} />
              </>
            )}
            {showCrm && (
              <>
                <Route path="/admin/crm" element={<AdminCRM />} />
                <Route path="/admin/crm/jobs" element={<AdminCRMJobs />} />
                <Route path="/admin/crm/planner" element={<AdminCRMPlanner />} />
                <Route path="/admin/crm/contract-jobs" element={<AdminCRMContractJobs />} />
                <Route path="/admin/crm/contract-jobs/:id" element={<AdminCRMContractor />} />
                <Route path="/admin/crm/contract-jobs/:id/invoices/:invoiceId" element={<AdminCRMContractInvoice />} />
                <Route path="/admin/crm/wages" element={<AdminCRMWages />} />
                <Route path="/admin/crm/customers" element={<AdminCRMCustomers />} />
                <Route path="/admin/crm/customers/:id" element={<AdminCRMCustomerDetail />} />
                <Route path="/admin/crm/settings" element={<AdminCRMSettings />} />
                <Route path="/admin/crm/:id" element={<AdminCRMDetail />} />
              </>
            )}
          </Route>

          {/* Root redirect handled in ProtectedRoute */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
