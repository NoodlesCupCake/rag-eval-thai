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
import { Layout } from "./components/Layout";
import { DocumentsPage } from "./pages/Documents";
import { QAPage } from "./pages/QA";
import { BenchPage } from "./pages/Bench";
import { RunsPage } from "./pages/Runs";
import { RunDetailPage } from "./pages/RunDetail";
import { SettingsPage } from "./pages/Settings";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/documents" replace /> },
      { path: "documents", element: <DocumentsPage /> },
      { path: "documents/:id", element: <DocumentsPage /> },
      { path: "qa", element: <QAPage /> },
      { path: "bench", element: <BenchPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/:id", element: <RunDetailPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/documents" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StatusProvider>
      <RouterProvider router={router} />
    </StatusProvider>
  </StrictMode>,
);
