import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, AppsProvider, ToastProvider, DialogProvider, useAuth } from './lib/context.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';

const page = (loader) => lazy(loader);
const Login = page(() => import('./pages/auth/Login.jsx'));
const Signup = page(() => import('./pages/auth/Signup.jsx'));
const Invite = page(() => import('./pages/auth/Invite.jsx'));
const Home = page(() => import('./pages/Home.jsx'));
const FlowsList = page(() => import('./pages/flows/FlowsList.jsx'));
const FlowEditor = page(() => import('./pages/flows/FlowEditor.jsx'));
const Templates = page(() => import('./pages/Templates.jsx'));
const HistoryList = page(() => import('./pages/history/HistoryList.jsx'));
const RunDetail = page(() => import('./pages/history/RunDetail.jsx'));
const Approvals = page(() => import('./pages/Approvals.jsx'));
const TablesList = page(() => import('./pages/tables/TablesList.jsx'));
const TableView = page(() => import('./pages/tables/TableView.jsx'));
const InterfacesList = page(() => import('./pages/interfaces/InterfacesList.jsx'));
const InterfaceBuilder = page(() => import('./pages/interfaces/InterfaceBuilder.jsx'));
const PublicInterface = page(() => import('./pages/interfaces/PublicInterface.jsx'));
const ChatbotsList = page(() => import('./pages/chatbots/ChatbotsList.jsx'));
const ChatbotBuilder = page(() => import('./pages/chatbots/ChatbotBuilder.jsx'));
const PublicChatbot = page(() => import('./pages/chatbots/PublicChatbot.jsx'));
const CanvasList = page(() => import('./pages/canvas/CanvasList.jsx'));
const CanvasEditor = page(() => import('./pages/canvas/CanvasEditor.jsx'));
const AppsDirectory = page(() => import('./pages/apps/AppsDirectory.jsx'));
const AppDetail = page(() => import('./pages/apps/AppDetail.jsx'));
const Connections = page(() => import('./pages/Connections.jsx'));
const Mcp = page(() => import('./pages/Mcp.jsx'));
const DeveloperList = page(() => import('./pages/developer/DeveloperList.jsx'));
const DeveloperApp = page(() => import('./pages/developer/DeveloperApp.jsx'));
const Inbox = page(() => import('./pages/Inbox.jsx'));
const Settings = page(() => import('./pages/settings/Settings.jsx'));
const NotFound = page(() => import('./pages/NotFound.jsx'));

function RequireAuth({ children }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Loading OneTier…" />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <AppsProvider>{children}</AppsProvider>;
}
function GuestOnly({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  return me ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                {/* public */}
                <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
                <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
                <Route path="/invite/:token" element={<Invite />} />
                <Route path="/p/:slug" element={<PublicInterface />} />
                <Route path="/c/:slug" element={<PublicChatbot />} />
                <Route path="/embed/chatbot/:slug" element={<PublicChatbot embed />} />

                {/* full-screen editors */}
                <Route path="/flows/:id" element={<RequireAuth><FlowEditor /></RequireAuth>} />
                <Route path="/interfaces/:id" element={<RequireAuth><InterfaceBuilder /></RequireAuth>} />
                <Route path="/canvas/:id" element={<RequireAuth><CanvasEditor /></RequireAuth>} />

                {/* app shell */}
                <Route element={<RequireAuth><Layout /></RequireAuth>}>
                  <Route index element={<Home />} />
                  <Route path="flows" element={<FlowsList />} />
                  <Route path="templates" element={<Templates />} />
                  <Route path="history" element={<HistoryList />} />
                  <Route path="history/:id" element={<RunDetail />} />
                  <Route path="approvals" element={<Approvals />} />
                  <Route path="tables" element={<TablesList />} />
                  <Route path="tables/:id" element={<TableView />} />
                  <Route path="interfaces" element={<InterfacesList />} />
                  <Route path="chatbots" element={<ChatbotsList />} />
                  <Route path="chatbots/:id" element={<ChatbotBuilder />} />
                  <Route path="canvas" element={<CanvasList />} />
                  <Route path="apps" element={<AppsDirectory />} />
                  <Route path="apps/:key" element={<AppDetail />} />
                  <Route path="connections" element={<Connections />} />
                  <Route path="mcp" element={<Mcp />} />
                  <Route path="developer" element={<DeveloperList />} />
                  <Route path="developer/:id" element={<DeveloperApp />} />
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="settings/*" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
