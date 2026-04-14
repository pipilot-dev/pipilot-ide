import { IDELayout } from "@/components/ide/IDELayout";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ProblemsProvider } from "@/contexts/ProblemsContext";
import { ExtensionProvider } from "@/contexts/ExtensionContext";
import { OnboardingScreen, useOnboarding } from "@/components/ide/OnboardingScreen";

function AppInner() {
  const { showOnboarding, completeOnboarding } = useOnboarding();

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
