import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./routes/LoginPage";
import { DashboardPage } from "./routes/DashboardPage";
import { SongsLibraryPage } from "./routes/SongsLibraryPage";
import { JinglesLibraryPage } from "./routes/JinglesLibraryPage";
import { AdsLibraryPage } from "./routes/AdsLibraryPage";
import { QueuePage } from "./routes/QueuePage";
import { SchedulePage } from "./routes/SchedulePage";
import { ClockWheelsListPage } from "./routes/ClockWheelsListPage";
import { ClockWheelEditorPage } from "./routes/ClockWheelEditorPage";
import { ExternalStreamsPage } from "./routes/ExternalStreamsPage";
import { SeparationRulesPage } from "./routes/SeparationRulesPage";
import { StationSettingsPage } from "./routes/StationSettingsPage";
import { ScratchPadSettingsPage } from "./routes/ScratchPadSettingsPage";
import { SystemStatusPage } from "./routes/SystemStatusPage";
import { NotFoundPage } from "./routes/NotFoundPage";

export function App() {
  return (
    <BrowserRouter basename="/manage">
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route index element={<DashboardPage />} />
          <Route path="library/songs" element={<SongsLibraryPage />} />
          <Route path="library/jingles" element={<JinglesLibraryPage />} />
          <Route path="library/ads" element={<AdsLibraryPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="clock-wheels" element={<ClockWheelsListPage />} />
          <Route path="clock-wheels/:id" element={<ClockWheelEditorPage />} />
          <Route path="external-streams" element={<ExternalStreamsPage />} />
          <Route path="settings/separation-rules" element={<SeparationRulesPage />} />
          <Route path="settings/station" element={<StationSettingsPage />} />
          <Route path="settings/scratch-pad" element={<ScratchPadSettingsPage />} />
          <Route path="system-status" element={<SystemStatusPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
