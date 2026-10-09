import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { orgIdOf, effectiveRole } from '../security/roles';
import { ensureOrgFields, findInvite, inviteId } from '../services/org';
import { setAuditActor, logAudit } from '../services/audit';
import { setNotifySender } from '../services/notify';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function signup(email, password, roleData) {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // A buyer-side invitation turns this account into a member of that organisation
    const invite = roleData.role !== 'supplier' ? await findInvite(email) : null;
    if (roleData.joining && !invite) {
      // Nothing to join: remove the half-created login so the person can try again
      await user.delete().catch(() => null);
      throw new Error(`There is no pending invitation for ${email}. Ask your company admin to invite exactly this address in Team & settings, then try again.`);
    }
    const profile = invite
      ? { email: user.email, role: 'consumer', companyName: invite.orgName, description: roleData.description || '',
          displayName: roleData.displayName || '', orgId: invite.orgId, staffRole: invite.staffRole }
      : { email: user.email, ...withoutJoining(roleData), orgId: user.uid, ...(roleData.role === 'supplier' ? {} : { staffRole: 'admin' }) };

    await setDoc(doc(db, 'users', user.uid), { ...profile, createdAt: new Date().toISOString() });
    if (invite) await updateDoc(doc(db, 'invites', inviteId(email)), { status: 'accepted', acceptedBy: user.uid }).catch(() => null);

    setAuditActor({ uid: user.uid, name: profile.displayName || profile.companyName || user.email, role: effectiveRole(profile), orgId: profile.orgId });
    await logAudit({
      action: invite ? 'TEAM_MEMBER_JOINED' : 'USER_REGISTERED',
      entityType: profile.role === 'supplier' ? 'supplier' : 'user', entityId: user.uid,
      entityLabel: profile.companyName, next: { role: effectiveRole(profile) }
    });
    return { userCredential, joinedOrg: invite?.orgName || null };
  }

  async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    sessionStorageSafe('tether:justLoggedIn', '1');
    return cred;
  }

  // Sign out first; the auth listener below then clears the user and their data together,
  // so pages never see a signed-in user without their profile
  function logout() {
    return signOut(auth);
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      setCurrentUser(user);
      if (user) {
        try {
          // Retry briefly: on a slow connection the first read can time out, and the app must
          // never run without knowing the user's role
          let snap = null;
          for (let attempt = 0; attempt < 3 && !snap; attempt++) {
            try { snap = await getDoc(doc(db, 'users', user.uid)); } catch (err) {
              if (attempt === 2) throw err;
              await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
            }
          }
          setProfileError(null);
          if (!snap.exists()) setProfileError('Your profile could not be found.');
          if (snap.exists()) {
            let data = snap.data();
            const patch = await ensureOrgFields(user.uid, data);
            if (patch) data = { ...data, ...patch };
            setUserData(data);
            setAuditActor({ uid: user.uid, name: data.displayName || data.companyName || user.email, role: effectiveRole(data), orgId: orgIdOf(user, data) });
            setNotifySender(user.uid);
            if (sessionStorageSafe('tether:justLoggedIn') === '1') {
              sessionStorageSafe('tether:justLoggedIn', null);
              logAudit({ action: 'USER_LOGIN', entityType: 'user', entityId: user.uid, entityLabel: data.companyName });
            }
          }
        } catch (err) {
          console.error('Error fetching user data:', err);
          setProfileError('We could not load your account. Check your connection and try again.');
        }
      } else {
        setUserData(null);
        setAuditActor(null);
        setNotifySender(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [reloadKey]);

  const value = {
    currentUser,
    userData,
    setUserData,
    // The organisation this account acts for, and the role used for permissions
    orgId: orgIdOf(currentUser, userData),
    role: effectiveRole(userData),
    login,
    signup,
    logout,
    resetPassword,
    profileError,
    retryProfile: () => { setProfileError(null); setLoading(true); setReloadKey(k => k + 1); }
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

function withoutJoining({ joining, ...rest }) {
  return rest;
}

function sessionStorageSafe(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}
