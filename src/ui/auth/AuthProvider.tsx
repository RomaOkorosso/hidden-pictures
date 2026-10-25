import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getFirebase, requireFirebase } from "../../firebase/app";
import { loadProfile, saveProfile } from "../../adapters/roomApi";
import { normalizeDisplayName } from "../../domain/clue";
import { isFirebaseConfigured } from "../../firebase/config";

type AuthCtx = {
  ready: boolean;
  configured: boolean;
  user: User | null;
  displayName: string;
  refreshName: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isFirebaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setName] = useState("");

  useEffect(() => {
    const fb = getFirebase();
    if (!fb) {
      setReady(true);
      return;
    }
    return onAuthStateChanged(fb.auth, (next) => {
      setUser(next);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setName("");
      return;
    }
    void loadProfile(user.uid)
      .then((profile) => setName(profile?.displayName || user.displayName || ""))
      .catch(() => setName(user.displayName || ""));
  }, [user]);

  const value = useMemo<AuthCtx>(
    () => ({
      ready,
      configured,
      user,
      displayName,
      async refreshName() {
        if (!user) return;
        const profile = await loadProfile(user.uid);
        setName(profile?.displayName || user.displayName || "");
      },
      async signIn(email, password) {
        const { auth } = requireFirebase();
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      async signUp(email, password, name) {
        const { auth } = requireFirebase();
        const clean = normalizeDisplayName(name);
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: clean });
        await saveProfile(cred.user.uid, clean);
      },
      async signOut() {
        const { auth } = requireFirebase();
        await fbSignOut(auth);
      },
      async resetPassword(email) {
        const { auth } = requireFirebase();
        await sendPasswordResetEmail(auth, email.trim());
      },
      async setDisplayName(name) {
        const { auth } = requireFirebase();
        if (!auth.currentUser) throw new Error("AUTH");
        const clean = normalizeDisplayName(name);
        await updateProfile(auth.currentUser, { displayName: clean });
        await saveProfile(auth.currentUser.uid, clean);
        setName(clean);
      },
    }),
    [configured, displayName, ready, user],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("auth");
  return ctx;
}
