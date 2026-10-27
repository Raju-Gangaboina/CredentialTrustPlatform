// Entry point: register routes, restore the session, start the router.
import { loadSession, logout } from './core/session.js';
import { route, go, startRouter } from './core/router.js';

import { landing } from './views/landing.js';
import { facultyLogin } from './views/facultyLogin.js';
import { studentLogin } from './views/studentLogin.js';
import { classes } from './views/classes.js';
import { newClass } from './views/newClass.js';
import { classDetail } from './views/classDetail.js';
import { issuers } from './views/issuers.js';
import { studentVault } from './views/studentVault.js';
import { adminFaculty } from './views/adminFaculty.js';
import { teaching } from './views/teaching.js';
import { adminTeaching } from './views/adminTeaching.js';
import { initChatBot } from './ui/chatBot.js';

// Signed-out
route('/',               { view: landing,      layout: 'landing', guestOnly: true });
route('/faculty/login',  { view: facultyLogin, layout: 'bare' });
route('/student/login',  { view: studentLogin, layout: 'bare' });

// Faculty
route('/faculty/classes',      { view: classes,     role: 'faculty' });
route('/faculty/classes/new',  { view: newClass,    role: 'faculty' });
route('/faculty/class/:id',      { view: classDetail, role: 'faculty' });
route('/faculty/class/:id/:tab', { view: classDetail, role: 'faculty' });
route('/faculty/issuers',      { view: issuers,     role: 'faculty' });

route('/faculty/teaching',          { view: teaching, role: 'faculty' });
route('/faculty/teaching/:classId', { view: teaching, role: 'faculty' });

// Admin (signs in through the normal faculty sign-in form)
route('/admin',         { redirect: '/admin/faculty' });
route('/admin/faculty', { view: adminFaculty, role: 'admin' });
route('/admin/teaching', { view: adminTeaching, role: 'admin' });

// Student
route('/student/vault', { view: studentVault, role: 'student' });

// Old URL from the previous frontend
route('/faculty/dashboard', { redirect: '/faculty/classes' });

document.addEventListener('app:logout', async () => {
  await logout();
  go('/');
});

await loadSession();
startRouter();
initChatBot();
