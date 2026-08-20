/**
 * THE HANDOFF SLOT — filled. Online bouts are live against this project.
 *
 * The config is public by design; the database rules
 * (database.rules.json, deployed in the Firebase console → Realtime
 * Database → Rules) are the security boundary, never this file.
 *
 * The project also needs Anonymous Authentication enabled
 * (Build → Authentication → Sign-in method → Anonymous) — the rules
 * demand an authenticated writer.
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
  /** Analytics id — unused by the game (we load no analytics SDK). */
  measurementId?: string;
}

export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
  apiKey: 'AIzaSyDvfs2dbrFXLhePUzKdW48rEaRyvFVy09s',
  authDomain: 'blastonpickem.firebaseapp.com',
  databaseURL: 'https://blastonpickem-default-rtdb.firebaseio.com',
  projectId: 'blastonpickem',
  storageBucket: 'blastonpickem.firebasestorage.app',
  messagingSenderId: '1045754652641',
  appId: '1:1045754652641:web:417f45d01e30d4e20bd4a0',
  measurementId: 'G-M03QJJMYFC',
};
