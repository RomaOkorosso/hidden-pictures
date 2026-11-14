// Served only by Vite in the local QA environment. Uses the player's real Auth SDK session.
import { get, ref, set, update } from 'firebase/database';
import { requireFirebase } from '../../src/firebase/app';
export async function read(path: string) { return (await get(ref(requireFirebase().db, path))).val(); }
export async function write(path: string, value: unknown) { await set(ref(requireFirebase().db, path), value); }
export async function patch(path: string, value: Record<string, unknown>) { await update(ref(requireFirebase().db, path), value); }
export function uid() { return requireFirebase().auth.currentUser!.uid; }
export async function disconnect() { const { goOffline } = await import('firebase/database'); goOffline(requireFirebase().db); }
export async function reconnect() { const { goOnline } = await import('firebase/database'); goOnline(requireFirebase().db); }
