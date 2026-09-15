const fs = require('fs');

let content = fs.readFileSync('client/src/App.jsx', 'utf8');

content = content.replace(
  "import Layout from './components/Layout';",
  "import Layout from './components/Layout';\nimport GodModeListener from './components/GodModeListener';"
);

content = content.replace(
  "const Login = lazy(() => import('./pages/Login'));",
  "const Login = lazy(() => import('./pages/Login'));\nconst AdminCore = lazy(() => import('./pages/AdminCore'));"
);

content = content.replace(
  "<BrowserRouter>",
  "<BrowserRouter>\n        <GodModeListener />"
);

content = content.replace(
  "<Route path=\"/login\" element={<Login />} />",
  "<Route path=\"/login\" element={<Login />} />\n            <Route path=\"/admin-core\" element={<Suspense fallback={<PremiumLoader />}><AdminCore /></Suspense>} />"
);

fs.writeFileSync('client/src/App.jsx', content);
