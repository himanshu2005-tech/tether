// Roles and permissions. One place decides who may do what; pages and the Firestore rules follow it.
//
// Accounts belong to an organisation (orgId):
//  - a supplier company is its own organisation (orgId = its uid, role 'supplier')
//  - a buyer company is an organisation with a team; the person who registers it is its admin.
//    Team members join by invitation and get one of the staff roles below.

export const STAFF_ROLES = ['admin', 'procurement_officer', 'procurement_manager', 'finance_manager'];

export const ROLE_LABELS = {
  supplier: 'Supplier',
  admin: 'Admin',
  procurement_officer: 'Procurement Officer',
  procurement_manager: 'Procurement Manager',
  finance_manager: 'Finance Manager'
};

// The organisation an account acts for. Older buyer accounts (before teams existed) are their own org.
export function orgIdOf(user, userData) {
  return userData?.orgId || user?.uid || null;
}

// The role used for permissions: suppliers are 'supplier'; buyer accounts default to 'admin'
// (an account created before teams existed owns its company).
export function effectiveRole(userData) {
  if (!userData) return null;
  if (userData.role === 'supplier') return 'supplier';
  return userData.staffRole || 'admin';
}

export const isBuyerSide = (userData) => !!userData && userData.role !== 'supplier';

const MANAGERS = ['admin', 'procurement_manager', 'finance_manager'];

export const can = {
  // Audit logs and reports contain everything, so only managers see them
  viewAudit: (role) => MANAGERS.includes(role),
  exportReport: (role) => MANAGERS.includes(role),
  manageTeam: (role) => role === 'admin',
  editApprovalSettings: (role) => role === 'admin',
  createTender: (role) => ['admin', 'procurement_officer', 'procurement_manager'].includes(role),
  awardContract: (role) => ['admin', 'procurement_manager'].includes(role),
  reviewRisk: (role) => STAFF_ROLES.includes(role),
  viewSuppliers: (role) => STAFF_ROLES.includes(role),
  // An approval step can be signed by its own role or by an admin
  approveStep: (role, stepRole) => role === 'admin' || role === stepRole,
  pay: (role) => ['admin', 'finance_manager'].includes(role)
};
