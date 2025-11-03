(function(){
  try {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!token || !user) {
      location.replace('/login.html');
      return;
    }

    const path = location.pathname.toLowerCase();
    const role = String(user.role || '').toLowerCase();

    const inAdmin = path.startsWith('/admin/');
    const inCliente = path.startsWith('/cliente/');

    if (inAdmin && !(role === 'admin' || role === 'superadmin')) {
      location.replace('/cliente/');
      return;
    }

    if (inCliente && (role === 'admin' || role === 'superadmin')) {
      location.replace('/admin/');
      return;
    }

  } catch {
    location.replace('/login.html');
  }
})();
