import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { StatusProvider } from "./status";
import { FeedbackProvider } from "./feedback";
import { Layout } from "./components/Layout";
import { DocumentsPage } from "./pages/Documents";
import { QAPage } from "./pages/QA";
import { BenchPage } from "./pages/Bench";
import { RunsPage } from "./pages/Runs";
import { RunDetailPage } from "./pages/RunDetail";
import { SettingsPage } from "./pages/Settings";
import { ComparePage } from "./pages/Compare";
import { ChatPage } from "./pages/Chat";
import { MethodPage } from "./pages/Method";
import { StartPage, isDismissed, setupSteps } from "./pages/Start";
import { useStatus } from "./status";

/* First visit: go to the setup steps until they are done or dismissed. */
function Home() {
  const { status } = useStatus();
  if (!status) return null;
  const done = setupSteps(status).every((s) => s.done);
  return <Navigate to={done || isDismissed() ? "/documents" : "/start"} replace />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "start", element: <StartPage /> },
      { path: "documents", element: <DocumentsPage /> },
      { path: "documents/:id", element: <DocumentsPage /> },
      { path: "qa", element: <QAPage /> },
      { path: "bench", element: <BenchPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/:id", element: <RunDetailPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "compare", element: <ComparePage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "method", element: <MethodPage /> },
      { path: "*", element: <Navigate to="/documents" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StatusProvider>
      <FeedbackProvider>
        <RouterProvider router={router} />
      </FeedbackProvider>
    </StatusProvider>
  </StrictMode>,
);
