import { IDELayout } from "@/components/ide/IDELayout";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ProblemsProvider } from "@/contexts/ProblemsContext";
import { ExtensionProvider } from "@/contexts/ExtensionContext";
import { OnboardingScreen, useOnboarding } from "@/components/ide/OnboardingScreen";
import { useSidecarReady } from "@/hooks/useSidecarReady";

function SidecarLoading() {
  return (
    <div className="flex items-center justify-center h-screen bg-[#0b0b0e] text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-zinc-400">Starting PiPilot IDE...</p>
      </div>
    </div>
  );
}

function AppInner() {
  const { showOnboarding, completeOnboarding } = useOnboarding();
  const sidecarReady = useSidecarReady();

  if (!sidecarReady) {
    return <SidecarLoading />;
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={completeOnboarding} />;
  }

  return <IDELayout />;
}

function App() {
  return (
    <NotificationProvider>
      <ProblemsProvider>
        <ExtensionProvider>
          <ProjectProvider>
            <AppInner />
          </ProjectProvider>
        </ExtensionProvider>
      </ProblemsProvider>
    </NotificationProvider>
  );
}

export default App;
