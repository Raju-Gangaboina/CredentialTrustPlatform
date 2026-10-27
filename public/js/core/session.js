// Who is signed in. The server is the source of truth (/api/auth/me); this is a cached copy.
import { api } from './api.js';

export const session = { role: null, name: null };

export function clearSession() {
  session.role = null;
  session.name = null;
}

export async function loadSession() {
  try {
    const me = await api.get('/api/auth/me');
    session.role = me.role || (me.facultyId ? 'faculty' : me.studentId ? 'student' : null);
    session.name = me.name || null;
  } catch {
    clearSession();
  }
}

export async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* session may already be gone */ }
  clearSession();
}

export const homeFor = role => (role === 'admin' ? '/admin/faculty' : role === 'faculty' ? '/faculty/classes' : role === 'student' ? '/student/vault' : '/');
export const loginFor = role => (role === 'admin' ? '/faculty/login' : `/${role}/login`); // admins use the same sign-in form as teachers
