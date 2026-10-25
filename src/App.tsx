import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./ui/shell/Shell";
import { AuthPage } from "./ui/pages/AuthPage";
import { HomePage } from "./ui/pages/HomePage";
import { ProfilePage } from "./ui/pages/ProfilePage";
import { RoomPage } from "./ui/pages/RoomPage";

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
