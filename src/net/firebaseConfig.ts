/**
 * THE HANDOFF SLOT — paste the Firebase web-app config here and online
 * bouts light up; leave it null and the menu honestly says "needs
 * Firebase" instead of erroring.
 *
 * What the project needs (see README → "Standing up the Firebase"):
 *  - a REALTIME DATABASE (not Firestore — RTDB's latency is what a pose
 *    stream wants), with the rules from database.rules.json,
 *  - Anonymous Authentication enabled (Build → Authentication →
 *    Sign-in method → Anonymous),
 *  - this config from Project settings → Your apps → Web app. It is
 *    public by design; the database rules are the security boundary,
 *    never this file.
 *
 * Example shape:
 *
 * export const FIREBASE_CONFIG = {
 *   apiKey: '…',
 *   authDomain: 'yourproject.firebaseapp.com',
 *   databaseURL: 'https://yourproject-default-rtdb.firebaseio.com',
 *   projectId: 'yourproject',
 *   storageBucket: 'yourproject.firebasestorage.app',
 *   messagingSenderId: '…',
 *   appId: '…',
 * };
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  /** REQUIRED for the Realtime Database (region-specific URL). */
  databaseURL: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export const FIREBASE_CONFIG: FirebaseWebConfig | null = null;
